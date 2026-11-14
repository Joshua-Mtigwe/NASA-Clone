import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('the 3D body map renders a WebGL canvas and selects regions', async ({ page }) => {
  await signIn(page, 'Astronaut');
  await page.goto('/astronaut/body-map');
  await page.getByRole('radio', { name: '3D' }).click();
  const canvas = page.getByTestId('body-map-3d').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(200);
  await page.getByRole('radio', { name: 'Chest' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Chest' })).toBeVisible();
});

test('Mission Mind draws the game stage with PixiJS', async ({ page }) => {
  await signIn(page, 'Astronaut');
  await page.goto('/astronaut/mission-mind');
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Signal Response' }) })
    .getByRole('link', { name: 'Play' })
    .click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByTestId('pixi-stage').locator('canvas')).toBeVisible({ timeout: 30_000 });
});
