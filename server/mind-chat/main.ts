/**
 * Starts the AEGIS Mind Companion service:  npm run mind-chat
 * See server/mind-chat/README.md for configuration.
 */
import { createMindChatApp } from './app';
import { createDemoAuthenticator } from './auth';
import { loadConfig } from './config';
import { createGenerator } from './inference';
import { ConversationStore } from './store';

const config = loadConfig();
const store = await ConversationStore.open(config.storePath);
// Production: replace null with a verifier for the backend's real access tokens.
const authenticate = config.demoAuth ? await createDemoAuthenticator(config.csvDir) : null;
const app = createMindChatApp({
  config,
  store,
  authenticate,
  generate: createGenerator(config.model),
  log: (line) => console.log(`[mind-chat] ${line}`),
});

app.server().listen(config.port, config.host, () => {
  console.log(`[mind-chat] listening on http://${config.host}:${config.port}`);
  console.log(
    config.model.url
      ? `[mind-chat] model ${config.model.name} via ${config.model.api} at ${config.model.url}`
      : '[mind-chat] WARNING: MIND_CHAT_MODEL_URL is not set; messages will be refused with "model not configured".',
  );
  if (config.demoAuth) {
    console.log('[mind-chat] DEMONSTRATION auth: demo tokens accepted. Not for production.');
  } else {
    console.log(
      '[mind-chat] Demo auth is off and no production verifier is wired: conversation requests get 503.',
    );
  }
});
