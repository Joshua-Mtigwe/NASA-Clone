/**
 * AEGIS Mind Companion service configuration. Everything comes from environment
 * variables so model endpoints and credentials never reach the frontend.
 */
import path from 'node:path';

export type ModelApi = 'ollama' | 'openai';

export interface ModelConfig {
  /** Base URL of the inference server, e.g. http://127.0.0.1:11434. null = not configured. */
  url: string | null;
  /** `ollama`: POST /api/chat. `openai`: POST /v1/chat/completions (llama.cpp, vLLM, ...). */
  api: ModelApi;
  name: string;
  /** Optional bearer token for the inference server. Never logged. */
  apiKey: string | null;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
}

export interface MindChatConfig {
  host: string;
  port: number;
  /** JSON file holding conversations and messages. */
  storePath: string;
  /** data/csv, used in demonstration mode to map demo tokens to astronauts. */
  csvDir: string;
  /**
   * Demonstration mode accepts the mock API's demo tokens (`mock-token.<user_id>`).
   * It is NOT secure authentication. Off unless MIND_CHAT_DEMO_AUTH=true.
   */
  demoAuth: boolean;
  /** Browser origins allowed by CORS (live deployments serving the UI elsewhere). */
  allowedOrigins: string[];
  /** Earlier messages sent to the model as context, newest last. */
  historyLimit: number;
  maxMessageChars: number;
  model: ModelConfig;
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  root = process.cwd(),
): MindChatConfig {
  const api = (env.MIND_CHAT_MODEL_API ?? 'ollama').trim().toLowerCase();
  if (api !== 'ollama' && api !== 'openai') {
    throw new Error(`MIND_CHAT_MODEL_API must be "ollama" or "openai", not "${api}".`);
  }
  const url = env.MIND_CHAT_MODEL_URL?.trim().replace(/\/+$/, '') || null;
  return {
    host: env.MIND_CHAT_HOST?.trim() || '127.0.0.1',
    port: int(env.MIND_CHAT_PORT, 8787, 1, 65535),
    storePath: path.resolve(
      root,
      env.MIND_CHAT_STORE ?? 'server/mind-chat/data/conversations.json',
    ),
    csvDir: path.resolve(root, env.MIND_CHAT_CSV_DIR ?? 'data/csv'),
    demoAuth: env.MIND_CHAT_DEMO_AUTH?.trim().toLowerCase() === 'true',
    allowedOrigins: (env.MIND_CHAT_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    historyLimit: int(env.MIND_CHAT_HISTORY, 20, 0, 100),
    maxMessageChars: int(env.MIND_CHAT_MAX_MESSAGE_CHARS, 4000, 100, 20000),
    model: {
      url,
      api,
      name: env.MIND_CHAT_MODEL?.trim() || 'gemma3:4b',
      apiKey: env.MIND_CHAT_MODEL_API_KEY?.trim() || null,
      timeoutMs: int(env.MIND_CHAT_TIMEOUT_MS, 60_000, 1_000, 600_000),
      temperature: num(env.MIND_CHAT_TEMPERATURE, 0.6, 0, 2),
      maxTokens: int(env.MIND_CHAT_MAX_TOKENS, 512, 16, 8192),
    },
  };
}
