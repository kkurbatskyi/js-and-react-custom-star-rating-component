import { expect, test } from '@playwright/test';

/**
 * Smoke test: the production build boots, renders into a canvas and throws nothing.
 * Later suites extend this (navigation, deep links, ratings, photo mode…).
 */
test('app boots with a canvas and no uncaught errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Sidereal/);
  await expect(page.locator('canvas').first()).toBeAttached();

  // Give the first frames (shader compilation in SwiftShader) a chance to surface errors.
  await page.waitForTimeout(1_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
