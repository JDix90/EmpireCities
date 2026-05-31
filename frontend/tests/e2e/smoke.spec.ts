import { expect, test } from '@playwright/test';

test.describe('CI smoke', () => {
  test('landing page loads with primary hero content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'BORDERFALL' })).toBeVisible();
    await expect(page.getByText('Every border is temporary.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose Your Era' })).toBeVisible();
  });
});
