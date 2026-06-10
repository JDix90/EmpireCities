import { expect, test } from '@playwright/test';

test.describe('CI smoke', () => {
  test('landing page loads with primary hero content', async ({ page }) => {
    await page.goto('/');
    // The navbar collapses the wordmark to "BF" at mobile widths.
    await expect(page.getByRole('link', { name: /^(BORDERFALL|BF)$/ })).toBeVisible();
    await expect(page.getByTestId('hero-tagline')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose Your Era' })).toBeVisible();
  });

  test('legal pages load', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('article').getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await page.goto('/terms');
    await expect(page.locator('article').getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });
});
