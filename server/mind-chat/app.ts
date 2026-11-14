/**
 * HTTP API for AEGIS Mind Companion (Node's built-in http, no framework).
 *
 *   GET    /api/v1/mind-chat/status
 *   GET    /api/v1/mind-chat/conversations
 *   POST   /api/v1/mind-chat/conversations
 *   GET    /api/v1/mind-chat/conversations/:id
 *   POST   /api/v1/mind-chat/conversations/:id/messages
 *   DELETE /api/v1/mind-chat/conversations/:id
 *
 * Only the astronaut who owns a conversation can read, extend or delete it. There
 * is no endpoint that lists other astronauts' conversations, and nothing here is
 * shared with other roles. Errors use the FastAPI shape { "detail": ... }.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Authenticator, Caller } from './auth';
import type { MindChatConfig } from './config';
import { InferenceError, type ChatTurn, type Generate } from './inference';
import {
  contextLine,
  MIND_COMPANION_SYSTEM_PROMPT,
  PROMPT_VERSION,
  URGENT_TURN_INSTRUCTION,
} from './prompt';
import { assessMessage, SUPPORT_NOTICE, validateReply } from './safety';
import type { ConversationStore, Message } from './store';

export const PREFIX = '/api/v1/mind-chat';
const MAX_BODY_BYTES = 64 * 1024;

export interface AppDeps {
  config: MindChatConfig;
  store: ConversationStore;
  /** null = no identity verifier configured: requests are refused with 503. */
  authenticate: Authenticator | null;
  generate: Generate;
  now?: () => string;
  /** Request log line (method, route, status, ms). Never receives bodies. */
  log?: (line: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(typeof detail === 'string' ? detail : 'error');
  }
}

const fieldError = (field: string, msg: string) =>
  new HttpError(422, [{ loc: ['body', field], msg, type: 'value_error' }]);

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(422, [{ loc: ['body'], msg: 'Body must be a JSON object', type: 'json' }]);
  }
}

function missionDay(body: Record<string, unknown>): number | null {
  const v = body.mission_day;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10_000) {
    throw fieldError('mission_day', 'Must be a whole number');
  }
  return v;
}

const PUBLIC_MESSAGE: Record<InferenceError['kind'], string> = {
  not_configured:
    'The Mind Companion model is not configured on the mission server, so no reply could be generated.',
  timeout: 'The Mind Companion model took too long to reply. Your message was saved; try again.',
  unreachable:
    'The Mind Companion model is not reachable right now. Your message was saved; try again later.',
  http_error: 'The Mind Companion model returned an error. Your message was saved; try again.',
  bad_response:
    'The Mind Companion model returned an unreadable reply. Your message was saved; try again.',
};

export function createMindChatApp(deps: AppDeps) {
  const { config, store, authenticate, generate } = deps;
  const now = deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  /** client_message_ids currently being answered, to refuse concurrent duplicates. */
  const inFlight = new Set<string>();

  async function astronaut(req: IncomingMessage): Promise<Caller & { astronautId: string }> {
    if (!authenticate) {
      // 503, not 401: the caller's session is fine; this service cannot verify it.
      throw new HttpError(
        503,
        'The Mind Companion service has no identity verification configured (demo auth is off).',
        { code: 'auth_not_configured' },
      );
    }
    const caller = await authenticate(req.headers.authorization);
    if (!caller) throw new HttpError(401, 'Not authenticated.');
    if (caller.role !== 'astronaut' || !caller.astronautId) {
      throw new HttpError(403, 'Mind Companion conversations are available to astronauts only.');
    }
    return caller as Caller & { astronautId: string };
  }

  function owned(id: string, caller: { astronautId: string }) {
    const c = store.getConversation(id);
    // Someone else's conversation is reported as missing, not as forbidden.
    if (!c || c.astronaut_id !== caller.astronautId)
      throw new HttpError(404, 'Conversation not found.');
    return c;
  }

  function summary(conversationId: string) {
    const c = store.getConversation(conversationId)!;
    const msgs = store.messages(conversationId);
    const first = msgs.find((m) => m.role === 'user');
    return {
      ...c,
      message_count: msgs.length,
      preview: first ? first.content.slice(0, 80) : null,
    };
  }

  async function answer(
    conversationId: string,
    userMessage: Message,
    caller: Caller,
    day: number | null,
  ): Promise<{ status: number; body: unknown }> {
    const history = store
      .messages(conversationId)
      .filter(
        (m) =>
          m.message_id !== userMessage.message_id &&
          m.generation_status === 'completed' &&
          m.timestamp <= userMessage.timestamp,
      )
      .slice(-config.historyLimit);
    const urgent = userMessage.support_notice;
    const context = contextLine({ missionDay: day, astronautCode: caller.astronautCode });
    const turns: ChatTurn[] = [
      {
        role: 'system',
        content: [MIND_COMPANION_SYSTEM_PROMPT, context, urgent ? URGENT_TURN_INSTRUCTION : '']
          .filter(Boolean)
          .join('\n\n'),
      },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage.content },
    ];

    let generation;
    try {
      generation = await generate(turns);
    } catch (error) {
      await store.updateMessage(userMessage.message_id, { generation_status: 'failed' });
      const failed = { ...userMessage, generation_status: 'failed' as const };
      if (error instanceof InferenceError) {
        throw new HttpError(503, PUBLIC_MESSAGE[error.kind], {
          code: `model_${error.kind}`,
          user_message: failed,
          support_notice: urgent ? SUPPORT_NOTICE : null,
        });
      }
      throw error;
    }

    const checked = validateReply(generation.content);
    const assistant = await store.addMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: checked.ok ? checked.content : '',
      timestamp: now(),
      model_id: generation.model,
      generation_status: checked.ok ? 'completed' : 'withheld',
      client_message_id: null,
      reply_to: userMessage.message_id,
      support_notice: false,
    });
    await store.updateMessage(userMessage.message_id, { generation_status: 'completed' });
    return {
      status: 201,
      body: {
        user_message: { ...userMessage, generation_status: 'completed' },
        assistant_message: assistant,
        support_notice: urgent ? SUPPORT_NOTICE : null,
        prompt_version: PROMPT_VERSION,
      },
    };
  }

  async function route(
    req: IncomingMessage,
    url: URL,
  ): Promise<{ status: number; body?: unknown }> {
    const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (parts.length === 1 && parts[0] === 'status' && method === 'GET') {
      // No private data: lets the UI tell "not configured" from "unreachable".
      return {
        status: 200,
        body: {
          service: 'aegis-mind-companion',
          model_configured: !!config.model.url,
          model: config.model.name,
          model_api: config.model.api,
          demo_auth: config.demoAuth,
          prompt_version: PROMPT_VERSION,
          support_notice: SUPPORT_NOTICE,
        },
      };
    }

    if (parts[0] !== 'conversations') throw new HttpError(404, 'Not found.');
    const caller = await astronaut(req);

    if (parts.length === 1) {
      if (method === 'GET') {
        return {
          status: 200,
          body: store.listConversations(caller.astronautId).map((c) => summary(c.conversation_id)),
        };
      }
      if (method === 'POST') {
        await readJson(req);
        const c = await store.createConversation(caller.astronautId, now());
        return { status: 201, body: summary(c.conversation_id) };
      }
    }

    if (parts.length === 2) {
      const c = owned(parts[1]!, caller);
      if (method === 'GET') {
        return {
          status: 200,
          body: {
            conversation: summary(c.conversation_id),
            messages: store.messages(c.conversation_id),
          },
        };
      }
      if (method === 'DELETE') {
        await store.deleteConversation(c.conversation_id);
        return { status: 204 };
      }
    }

    if (parts.length === 3 && parts[2] === 'messages' && method === 'POST') {
      const c = owned(parts[1]!, caller);
      const body = await readJson(req);
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) throw fieldError('content', 'Message cannot be empty');
      if (content.length > config.maxMessageChars) {
        throw fieldError('content', `Message is longer than ${config.maxMessageChars} characters`);
      }
      const clientId =
        typeof body.client_message_id === 'string' ? body.client_message_id.trim() : '';
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) {
        throw fieldError('client_message_id', 'Required: 8 to 64 letters, digits, - or _');
      }
      const day = missionDay(body);
      const key = `${c.conversation_id}|${clientId}`;
      if (inFlight.has(key)) throw new HttpError(409, 'This message is already being answered.');

      inFlight.add(key);
      try {
        const existing = store.findByClientId(c.conversation_id, clientId);
        if (existing) {
          if (existing.content !== content) {
            throw new HttpError(409, 'client_message_id was already used for a different message.');
          }
          const reply = store.replyTo(existing.message_id);
          // Already answered: return the stored pair instead of creating a duplicate.
          if (reply) {
            return {
              status: 200,
              body: {
                user_message: existing,
                assistant_message: reply,
                support_notice: existing.support_notice ? SUPPORT_NOTICE : null,
                prompt_version: PROMPT_VERSION,
              },
            };
          }
          return await answer(c.conversation_id, existing, caller, day);
        }
        const userMessage = await store.addMessage({
          conversation_id: c.conversation_id,
          role: 'user',
          content,
          timestamp: now(),
          model_id: null,
          generation_status: 'received',
          client_message_id: clientId,
          reply_to: null,
          support_notice: assessMessage(content) === 'urgent',
        });
        return await answer(c.conversation_id, userMessage, caller, day);
      } finally {
        inFlight.delete(key);
      }
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    let status = 500;
    let payload: unknown;
    cors(req, res);
    try {
      if (req.method === 'OPTIONS') {
        status = 204;
      } else if (!url.pathname.startsWith(PREFIX)) {
        throw new HttpError(404, 'Not found.');
      } else {
        const result = await route(req, url);
        status = result.status;
        payload = result.body;
      }
    } catch (error) {
      if (error instanceof HttpError) {
        status = error.status;
        payload = { detail: error.detail, ...error.extra };
      } else {
        status = 500;
        payload = { detail: 'Mind Companion service error.' };
      }
    }
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    if (payload !== undefined && status !== 204) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    } else {
      res.end();
    }
    // Route shape only: ids and message text never reach the log.
    const routeShape = url.pathname.replace(/MCC-[0-9a-f-]+/g, ':id');
    deps.log?.(`${req.method} ${routeShape} ${status} ${Date.now() - started}ms`);
  }

  return { handle, server: (): Server => createServer((req, res) => void handle(req, res)) };
}
