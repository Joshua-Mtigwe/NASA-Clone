import { expect, test } from '@playwright/test';
import { completeSession, playUntil, signIn, signOut } from './helpers';

test('(a) astronaut completes a preflight session and a Mission Mind session, then sees the comparison', async ({
  page,
}) => {
  await signIn(page, 'Astronaut');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Mission Mind' })
    .click();
  await expect(page.getByTestId('session-status')).toHaveText('0 of 3 complete');

  // Mission Mind: Command Switch is one of today's two games.
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Command Switch' }) })
    .getByRole('link', { name: 'Play' })
    .click();
  await completeSession(page, 'f');
  const done = page.getByTestId('completion');
  await expect(done).toContainText('Accuracy');
  await expect(done).not.toContainText(/overall|grade/i);
  await done.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('session-status')).toHaveText('1 of 3 complete');

  // Preflight: System Scanner (Stroop), condition "Before physical work".
  await page.getByRole('link', { name: 'Preflight sessions' }).click();
  const row = page
    .getByTestId('due-session')
    .filter({ has: page.getByRole('heading', { name: 'System Scanner' }) });
  await expect(row.getByTestId('condition-tag')).toHaveText('Before physical work');
  await row.getByRole('link', { name: 'Start' }).click();
  await completeSession(page, 'r');
  await expect(page.getByTestId('completion')).toContainText('Accuracy');

  // The comparison against the preflight reference.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Cognitive Trends' })
    .click();
  await expect(page.getByRole('figure', { name: /Vigilance over time/ })).toContainText('n = ');
  await expect(page.getByTestId('detail-row').first()).toBeVisible();
});

test('(b) leader generates, overrides and approves a schedule, and the astronaut sees it', async ({
  page,
}) => {
  await signIn(page, 'Mission Planning Leader');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Crew Schedule' })
    .click();
  await expect(page.getByTestId('task-bar').first()).toBeVisible();

  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByLabel('Schedule version')).toHaveValue(/SV-SET-025-2/, {
    timeout: 30_000,
  });
  await expect(page.getByText('Draft, not approved')).toBeVisible();

  await page.getByTestId('task-bar').first().click();
  const form = page.getByRole('form', { name: 'Manual override' });
  await form.getByLabel('Start (UTC)').fill('07:30');
  await form.getByLabel(/Reason for override/).fill('Crew request');
  await form.getByRole('button', { name: 'Apply override' }).click();
  await expect(page.locator('[data-testid="task-bar"][aria-label*="07:30–"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Approve and publish' }).click();
  await expect(page.getByText('Approved and published')).toBeVisible();

  await signOut(page);
  await signIn(page, 'Astronaut');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'My Schedule' })
    .click();
  const tasks = page.getByTestId('schedule-item').filter({ hasText: /^Task/ });
  await expect(tasks.first()).toBeVisible();
  await expect(tasks.filter({ hasText: 'Draft, not approved' })).toHaveCount(0);
});

test('(c) researcher runs an analysis and reads the report', async ({ page }) => {
  await signIn(page, 'Medical Researcher');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Analyses' })
    .click();
  const form = page.getByRole('form', { name: 'Analysis builder' });
  await form.getByLabel('Research question').fill('Sleep and vigilance');
  await form.getByRole('button', { name: 'Run analysis' }).click();

  await expect(page.getByTestId('chart-scatter')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('figure').first()).toContainText(/Association r = .* \(95% CI/);
  const report = page.getByRole('region', { name: 'Report' });
  await expect(report).toContainText('AI-drafted from computed results');
  await expect(report).toContainText('This exploratory analysis of synthetic demonstration data');
  await expect(report).toContainText('not evidence of cause');
});

test('(d) offline: complete a game with the network off, reconnect, and see it sync', async ({
  page,
  context,
}) => {
  await signIn(page, 'Astronaut');
  await page.goto('/astronaut/mission-mind');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Command Switch' }) })
    .getByRole('link', { name: 'Play' })
    .click();

  await completeSession(page, 'j', async () => {
    await playUntil(page, 'j', /Test · trial 4 of/);
    await context.setOffline(true);
  });
  const done = page.getByTestId('completion');
  await expect(done).toContainText('Saved on this device');
  await expect(page.getByRole('status', { name: 'Connection: Offline' })).toBeVisible();

  await context.setOffline(false);
  await expect(done).toContainText('Accuracy', { timeout: 30_000 });
  await expect(page.getByRole('status', { name: /Connection: (Synced|Syncing)/ })).toBeVisible();
});
