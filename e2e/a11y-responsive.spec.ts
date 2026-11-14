import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, type DemoRole } from './helpers';

const PAGES: Array<{ role: DemoRole; path: string; ready: RegExp }> = [
  { role: 'Astronaut', path: '/astronaut', ready: /Daily readiness summary/ },
  { role: 'Astronaut', path: '/astronaut/health', ready: /Health Monitoring/ },
  { role: 'Astronaut', path: '/astronaut/mission-mind', ready: /Games/ },
  { role: 'Mission Planning Leader', path: '/planner/schedule', ready: /Duty limits/ },
  {
    role: 'Medical Researcher',
    path: '/research/analyses',
    ready: /Analysis builder|Run analysis/,
  },
  { role: 'Medical Officer', path: '/medical/programmes', ready: /Conditions and the tests/ },
  { role: 'Mission Control Administrator', path: '/control', ready: /Demo story/ },
];

async function open(page: Page, role: DemoRole, path: string, ready: RegExp) {
  await signIn(page, role);
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
}

test('login page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await expect(
    page.getByRole('region', { name: 'Demo accounts' }).getByRole('button').first(),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

for (const p of PAGES) {
  test(`${p.path} (${p.role}): WCAG AA checks and no horizontal scroll at 375/768/1280/1920`, async ({
    page,
  }) => {
    await open(page, p.role, p.path, p.ready);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      );
    expect(serious).toEqual([]);

    for (const width of [375, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `horizontal scroll at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
