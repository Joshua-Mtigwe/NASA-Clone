/** Isolated live test services; never reset a developer's working database. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const temporary = mkdtempSync(path.join(tmpdir(), 'aegis-live-e2e-'));
const python = process.env.AEGIS_PYTHON ?? 'python';
const environment = {
  ...process.env,
  AEGIS_DATABASE_PATH: path.join(temporary, 'mission.db'),
  AEGIS_AUTH_MODE: 'open',
  AEGIS_BACKEND_PORT: '8011',
  AEGIS_BACKEND_URL: 'http://127.0.0.1:8011',
  AEGIS_FRONTEND_PORT: '5175',
  VITE_API_MODE: 'live',
  VITE_DEMO_MODE: 'true',
  VITE_API_BASE_URL: '',
  VITE_MIND_CHAT_URL: '',
  MIND_CHAT_PORT: '8788',
  MIND_CHAT_PROXY_TARGET: 'http://127.0.0.1:8788',
  MIND_CHAT_STORE: path.join(temporary, 'conversations.json'),
  MIND_CHAT_DEMO_AUTH: 'true',
  MIND_CHAT_MODEL_URL: '',
};
for (const args of [
  ['aegis_backend/scripts/import_csvs.py'],
  ['scripts/demo-clock.py', '--day', '25', '--hour', '9'],
]) {
  const result = spawnSync(python, args, { env: environment, stdio: 'inherit' });
  if (result.status !== 0) {
    rmSync(temporary, { recursive: true, force: true });
    process.exit(result.status ?? 1);
  }
}
const application = spawn(process.execPath, ['scripts/dev-integrated.mjs'], {
  env: environment,
  stdio: 'inherit',
});
application.on('error', (error) => {
  console.error(error.message);
  rmSync(temporary, { recursive: true, force: true });
  process.exitCode = 1;
});
application.on('exit', (code) => {
  rmSync(temporary, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => application.kill(signal));
