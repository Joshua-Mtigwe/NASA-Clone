/**
 * Gemma inference client. Talks to an Ollama server (`/api/chat`) or any
 * OpenAI-compatible server (`/v1/chat/completions`, e.g. llama.cpp or vLLM) that
 * serves a Gemma model, typically on the mission's onboard hardware, so it works
 * without an internet connection.
 */
import type { ModelConfig } from './config';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Generation {
  content: string;
  /** Model id reported by the server (falls back to the configured name). */
  model: string;
  latencyMs: number;
}

export type InferenceErrorKind =
  'not_configured' | 'timeout' | 'unreachable' | 'http_error' | 'bad_response';

export class InferenceError extends Error {
  constructor(
    readonly kind: InferenceErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type Generate = (turns: ChatTurn[]) => Promise<Generation>;

export function createGenerator(cfg: ModelConfig, fetchImpl: typeof fetch = fetch): Generate {
  return async (turns) => {
    if (!cfg.url) {
      throw new InferenceError(
        'not_configured',
        'No model endpoint is configured (set MIND_CHAT_MODEL_URL on the Mind Companion service).',
      );
    }
    const endpoint =
      cfg.api === 'ollama' ? `${cfg.url}/api/chat` : `${cfg.url}/v1/chat/completions`;
    const body =
      cfg.api === 'ollama'
        ? {
            model: cfg.name,
            messages: turns,
            stream: false,
            options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
          }
        : {
            model: cfg.name,
            messages: turns,
            stream: false,
            temperature: cfg.temperature,
            max_tokens: cfg.maxTokens,
          };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new InferenceError(
          'timeout',
          `The model did not respond within ${cfg.timeoutMs} ms.`,
        );
      }
      throw new InferenceError(
        'unreachable',
        `The model server at ${cfg.url} could not be reached${error instanceof Error ? ` (${error.message})` : ''}.`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const hint = response.status === 404 ? ` Is the model "${cfg.name}" installed?` : '';
      throw new InferenceError(
        'http_error',
        `The model server returned HTTP ${response.status}.${hint}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InferenceError(
        'bad_response',
        'The model server returned a response that is not JSON.',
      );
    }
    const p = payload as {
      model?: string;
      message?: { content?: unknown };
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = cfg.api === 'ollama' ? p.message?.content : p.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new InferenceError('bad_response', 'The model server response contained no message.');
    }
    return { content, model: p.model ?? cfg.name, latencyMs: Date.now() - started };
  };
}
