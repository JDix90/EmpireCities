import { expect, test } from '@playwright/test';

test.describe('Map visual lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/__map-visual-lab');
    await expect(page.getByRole('heading', { name: 'Map Visual Lab' })).toBeVisible();
  });

  test('reinforce sets data-last-kind on 2D canvas', async ({ page }) => {
    await page.getByTestId('lab-trigger-reinforce').click();
    await expect(page.getByTestId('map-visual-canvas')).toHaveAttribute('data-last-kind', 'reinforce', {
      timeout: 2000,
    });
  });

  test('combat sets data-last-kind on 2D canvas', async ({ page }) => {
    await page.getByTestId('lab-trigger-combat').click();
    await expect(page.getByTestId('map-visual-canvas')).toHaveAttribute('data-last-kind', 'combat', {
      timeout: 2000,
    });
  });

  test('capture sets data-last-kind on 2D canvas', async ({ page }) => {
    await page.getByTestId('lab-trigger-capture').click();
    await expect(page.getByTestId('map-visual-canvas')).toHaveAttribute('data-last-kind', 'capture', {
      timeout: 2000,
    });
  });

  test('event sets data-last-kind on 2D canvas', async ({ page }) => {
    await page.getByTestId('lab-trigger-event').click();
    await expect(page.getByTestId('map-visual-canvas')).toHaveAttribute('data-last-kind', 'event', {
      timeout: 2000,
    });
  });

  test('globe reinforce enqueues animation', async ({ page }) => {
    await page.getByRole('button', { name: 'Globe' }).click();
    await page.getByTestId('lab-trigger-reinforce').click();
    const globe = page.getByTestId('globe-map-root');
    await expect(globe).toHaveAttribute('data-globe-playing', 'true', { timeout: 5000 });
  });

  test('reduced motion strike skips full-screen overlay but keeps map flash', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/__map-visual-lab?action=strike');
    await expect(page.getByTestId('atom-bomb-overlay')).toHaveCount(0);
    await expect(page.getByTestId('map-visual-canvas')).toHaveAttribute('data-map-strike-flash-active', 'true', {
      timeout: 2000,
    });
  });
});
