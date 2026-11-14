import { expect, type Page } from '@playwright/test';

export type DemoRole =
  | 'Astronaut'
  | 'Mission Planning Leader'
  | 'Medical Researcher'
  | 'Medical Officer'
  | 'Mission Control Administrator';

/** Sign in with a mock-mode demo card. */
export async function signIn(page: Page, role: DemoRole) {
  // A full reload resets the in-browser mock data, so only navigate when needed
  // (after signOut the app is already on /login).
  if (!new URL(page.url(), 'http://x').pathname.endsWith('/login')) await page.goto('/login');
  const cards = page.getByRole('region', { name: 'Demo accounts' });
  const card = cards.getByRole('button', { name: new RegExp(`^${role}`) });
  // A cold dev server optimises dependencies on first load and reloads the page,
  // which can cut the first request short. Reload until the cards are there.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ready = await card
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (ready) break;
    await page.goto('/login').catch(() => undefined);
  }
  await card.click();
  await expect(page.getByRole('banner', { name: 'Mission status' })).toBeVisible();
}

/** Sign out through the header (keeps the in-page mock data: no reload). */
export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'AEGIS Mission Console' })).toBeVisible();
}

/**
 * Play the running test phase by pressing `key` until `until` appears. Responses
 * during a foreperiod are ignored by the engine (these tests have no false starts).
 */
export async function playUntil(page: Page, key: string, until: RegExp, stepMs = 120) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await page.getByText(until).first().isVisible()) return;
    await page.keyboard.press(key);
    await page.waitForTimeout(stepMs);
  }
  throw new Error(`Timed out waiting for ${until}`);
}

/** Practice then test for one session, ending on the completion screen. */
export async function completeSession(
  page: Page,
  key: string,
  afterPractice?: () => Promise<void>,
) {
  await page.getByRole('button', { name: 'Start practice' }).click();
  await playUntil(page, key, /Practice complete/);
  await page.getByRole('button', { name: 'Start test' }).click();
  await afterPractice?.();
  await playUntil(page, key, /Session complete/);
}
