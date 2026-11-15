import { spawn } from 'node:child_process';
const python = process.env.AEGIS_PYTHON ?? 'python';
const port = process.env.AEGIS_BACKEND_PORT ?? '8010';
const children = [
  spawn(
    python,
    [
      '-m',
      'uvicorn',
      'app.main:app',
      '--app-dir',
      'aegis_backend',
      '--host',
      '127.0.0.1',
      '--port',
      port,
    ],
    { stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      '--mode',
      'live',
      '--port',
      process.env.AEGIS_FRONTEND_PORT ?? '5173',
      '--strictPort',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        AEGIS_BACKEND_URL: process.env.AEGIS_BACKEND_URL ?? `http://127.0.0.1:${port}`,
      },
    },
  ),
  spawn(process.execPath, ['--import', 'tsx', 'server/mind-chat/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, MIND_CHAT_DEMO_AUTH: process.env.MIND_CHAT_DEMO_AUTH ?? 'true' },
  }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
