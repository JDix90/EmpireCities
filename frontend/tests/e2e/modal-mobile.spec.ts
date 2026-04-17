import { expect, test } from '@playwright/test';

test.describe('mobile modal behavior', () => {
  test('shared create modal keeps both actions reachable', async ({ page }) => {
    await page.goto('/__modal-lab?modal=create');

    await expect(page.getByRole('dialog', { name: 'Configure New Game' })).toBeVisible();
    await page.getByRole('button', { name: 'Create & Enter Lobby' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Create & Enter Lobby' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Configure New Game' })).toHaveCount(0);
  });

  test('event modal remains scrollable and dismissible', async ({ page }) => {
    await page.goto('/__modal-lab?modal=event');

    await expect(page.getByText('Spring Floods')).toBeVisible();
    await page.getByRole('button', { name: 'Press locals into repair crews' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Press locals into repair crews' })).toBeVisible();
    await page.getByRole('button', { name: 'Raise temporary defenses' }).click();
    await expect(page.getByText('Spring Floods')).toHaveCount(0);
  });

  test('tech modal can reach lower-tier content and close', async ({ page }) => {
    await page.goto('/__modal-lab?modal=tech');

    await expect(page.getByRole('heading', { name: 'Technology Tree' })).toBeVisible();
    await page.getByTitle('Legendary Generals').scrollIntoViewIfNeeded();
    await expect(page.getByTitle('Legendary Generals')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: 'Technology Tree' })).toHaveCount(0);
  });
});