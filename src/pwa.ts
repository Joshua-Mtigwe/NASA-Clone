/**
 * Service worker registration for offline use (app-shell caching). Live mode only:
 * mock mode runs the MSW worker on the same scope.
 */
export function shouldRegisterPwa(mode: string | undefined, hasServiceWorker: boolean): boolean {
  return mode === 'live' && hasServiceWorker;
}

export async function registerPwa(): Promise<void> {
  if (!shouldRegisterPwa(import.meta.env.VITE_API_MODE, 'serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}
