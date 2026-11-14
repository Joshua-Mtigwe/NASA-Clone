// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * End-to-end tests of the Mind Companion service over real HTTP. The model is a
 * local stand-in inference server speaking the Ollama /api/chat protocol, so the
 * service's real inference client, safety layer and persistence are exercised.
 * It does NOT test a real Gemma model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMindChatApp } from './app';
import { createDemoAuthenticator } from './auth';
import { loadConfig } from './config';
import { createGenerator } from './inference';
import { MIND_COMPANION_SYSTEM_PROMPT } from './prompt';
import { ConversationStore } from './store';

interface Received {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

let dir: string;
let modelServer: Server | null;
let api: Server;
let base: string;
let received: Received[];
let reply: (req: Received) => { status: number; body: unknown } | 'hang';
const logs: string[] = [];

const ASTRO_1 = 'Bearer mock-token.USR-001'; // crew1 -> AST-001
const ASTRO_2 = 'Bearer mock-token.USR-002'; // crew2 -> AST-002
const OFFICER = 'Bearer mock-token.USR-008'; // medical_officer

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

async function startModel() {
  modelServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Received;
      received.push(body);
      const out = reply(body);
      if (out === 'hang') return;
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  return listen(modelServer);
}

async function startApi(modelUrl: string | null, timeoutMs = 5000) {
  const config = loadConfig(
    {
      MIND_CHAT_STORE: path.join(dir, 'store.json'),
      MIND_CHAT_DEMO_AUTH: 'true',
      MIND_CHAT_MODEL_URL: modelUrl ?? '',
      MIND_CHAT_MODEL: 'gemma3:4b',
      MIND_CHAT_TIMEOUT_MS: String(timeoutMs),
    },
    path.resolve(__dirname, '../..'),
  );
  const store = await ConversationStore.open(config.storePath);
  const app = createMindChatApp({
    config,
    store,
    authenticate: await createDemoAuthenticator(config.csvDir),
    generate: createGenerator(config.model),
    log: (l) => logs.push(l),
  });
  api = app.server();
  base = `${await listen(api)}/api/v1/mind-chat`;
  return store;
}

async function call(method: string, p: string, auth: string | null, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

const send = (id: string, content: string, clientId: string, auth = ASTRO_1) =>
  call('POST', `/conversations/${id}/messages`, auth, {
    content,
    client_message_id: clientId,
    mission_day: 25,
  });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mind-chat-'));
  received = [];
  logs.length = 0;
  modelServer = null;
  reply = (req) => ({
    status: 200,
    body: {
      model: 'gemma3:4b',
      message: { role: 'assistant', content: `Reply ${req.messages.length}` },
    },
  });
});

afterEach(async () => {
  await new Promise((r) => api?.close(r));
  if (modelServer) {
    modelServer.closeAllConnections();
    await new Promise((r) => modelServer!.close(r));
  }
  await rm(dir, { recursive: true, force: true });
});

describe('Mind Companion service', () => {
  it('sends the conversation to the model with the server-side system prompt and keeps context', async () => {
    await startApi(await startModel());
    const created = await call('POST', '/conversations', ASTRO_1, {});
    expect(created.status).toBe(201);
    const id = created.body!.conversation_id as string;

    const first = await send(id, 'I feel homesick today.', 'client-0001');
    expect(first.status).toBe(201);
    expect(first.body!.assistant_message).toMatchObject({
      role: 'assistant',
      content: 'Reply 2',
      model_id: 'gemma3:4b',
      generation_status: 'completed',
    });

    await send(id, 'It is hard to focus.', 'client-0002');
    const turns = received[1]!.messages;
    expect(received[1]!.model).toBe('gemma3:4b');
    expect(turns[0]!.role).toBe('system');
    expect(turns[0]!.content).toContain(MIND_COMPANION_SYSTEM_PROMPT);
    expect(turns[0]!.content).toContain('mission day 25');
    // Follow-up carries the earlier exchange as context.
    expect(turns.slice(1).map((t) => t.content)).toEqual([
      'I feel homesick today.',
      'Reply 2',
      'It is hard to focus.',
    ]);
    // Only the mission day and crew code are shared, no health or readiness data.
    expect(turns[0]!.content.replace(MIND_COMPANION_SYSTEM_PROMPT, '')).not.toMatch(
      /heart|readiness|sleep|cognitive|baseline|\d+\s*(bpm|ms|%)/i,
    );
  });

  it('persists conversations across a restart and keeps astronauts apart', async () => {
    let store = await startApi(await startModel());
    const id = (await call('POST', '/conversations', ASTRO_1, {})).body!.conversation_id as string;
    await send(id, 'Hello', 'client-0003');
    await store.flush();
    await new Promise((r) => api.close(r));

    store = await startApi(await listen(createServer()));
    const reopened = await call('GET', `/conversations/${id}`, ASTRO_1);
    expect(reopened.body!.messages.map((m: { content: string }) => m.content)).toEqual([
      'Hello',
      'Reply 2',
    ]);
    expect((await call('GET', '/conversations', ASTRO_1)).body).toHaveLength(1);

    // Another astronaut can neither list, read, write to nor delete it.
    expect((await call('GET', '/conversations', ASTRO_2)).body).toEqual([]);
    expect((await call('GET', `/conversations/${id}`, ASTRO_2)).status).toBe(404);
    expect((await send(id, 'x', 'client-0004', ASTRO_2)).status).toBe(404);
    expect((await call('DELETE', `/conversations/${id}`, ASTRO_2)).status).toBe(404);
    // Other roles (including the medical officer) have no access at all.
    expect((await call('GET', '/conversations', OFFICER)).status).toBe(403);
    expect((await call('GET', '/conversations', null)).status).toBe(401);
  });

  it('reports a missing model configuration instead of inventing a reply', async () => {
    await startApi(null);
    const status = await call('GET', '/status', null);
    expect(status.body).toMatchObject({ model_configured: false });
    const id = (await call('POST', '/conversations', ASTRO_1, {})).body!.conversation_id as string;
    const res = await send(id, 'Are you there?', 'client-0005');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'model_not_configured' });
    expect(res.body!.user_message.generation_status).toBe('failed');
    const stored = await call('GET', `/conversations/${id}`, ASTRO_1);
    expect(stored.body!.messages).toHaveLength(1);
    expect(stored.body!.messages[0].role).toBe('user');
  });

  it('reports an unreachable model and a timeout, and a retry does not duplicate the message', async () => {
    const modelUrl = await startModel();
    await startApi(modelUrl, 1000);
    const id = (await call('POST', '/conversations', ASTRO_1, {})).body!.conversation_id as string;

    reply = () => 'hang';
    const slow = await send(id, 'Long day.', 'client-0006');
    expect(slow.status).toBe(503);
    expect(slow.body!.code).toBe('model_timeout');

    reply = (req) => ({ status: 200, body: { message: { content: `ok ${req.messages.length}` } } });
    const retried = await send(id, 'Long day.', 'client-0006');
    expect(retried.status).toBe(201);
    const again = await send(id, 'Long day.', 'client-0006');
    expect(again.status).toBe(200);
    expect(again.body!.assistant_message.message_id).toBe(
      retried.body!.assistant_message.message_id,
    );
    const stored = await call('GET', `/conversations/${id}`, ASTRO_1);
    expect(stored.body!.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);

    modelServer!.closeAllConnections();
    await new Promise((r) => modelServer!.close(r));
    modelServer = null;
    const down = await send(id, 'Still there?', 'client-0007');
    expect(down.status).toBe(503);
    expect(down.body!.code).toBe('model_unreachable');
  });

  it('withholds replies that claim to be a therapist and flags urgent disclosures', async () => {
    await startApi(await startModel());
    const id = (await call('POST', '/conversations', ASTRO_1, {})).body!.conversation_id as string;

    reply = () => ({
      status: 200,
      body: { message: { content: "I'm a licensed therapist and you have clinical depression." } },
    });
    const blocked = await send(id, 'What is wrong with me?', 'client-0008');
    expect(blocked.body!.assistant_message).toMatchObject({
      generation_status: 'withheld',
      content: '',
    });

    reply = () => ({ status: 200, body: { message: { content: 'I hear you. You matter.' } } });
    const urgent = await send(id, 'Sometimes I want to die up here.', 'client-0009');
    expect(urgent.body!.support_notice).toMatch(/flight surgeon/);
    expect(urgent.body!.support_notice).toMatch(/does not alert anyone automatically/);
    expect(received.at(-1)!.messages[0]!.content).toMatch(/Prioritise safety/);
    expect(urgent.body!.assistant_message.content).toBe('I hear you. You matter.');
  });

  it('validates input and never logs message text', async () => {
    await startApi(await startModel());
    const id = (await call('POST', '/conversations', ASTRO_1, {})).body!.conversation_id as string;
    expect((await send(id, '   ', 'client-0010')).status).toBe(422);
    expect((await send(id, 'hi', 'bad id')).status).toBe(422);
    await send(id, 'my secret worry', 'client-0011');
    expect(logs.join('\n')).not.toContain('secret');
    expect(logs.join('\n')).not.toContain(id);

    expect((await call('DELETE', `/conversations/${id}`, ASTRO_1)).status).toBe(204);
    expect((await call('GET', `/conversations/${id}`, ASTRO_1)).status).toBe(404);
  });
});
