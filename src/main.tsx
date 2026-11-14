import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bindApiClient } from './features/auth/bindApiClient';
import './index.css';
import { registerPwa } from './pwa';

bindApiClient();

async function enableMocking(): Promise<void> {
  // Statically replaced by Vite, so live builds drop the mock layer and its fixtures.
  if (import.meta.env.VITE_API_MODE === 'live') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

void enableMocking().then(() => {
  void registerPwa();
  const root = document.getElementById('root');
  if (!root) throw new Error('Root element #root not found');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
