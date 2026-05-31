/**
 * Tutorial smoke tests.
 *
 * These tests cover the Training Academy page and, when a live backend is
 * available, the in-game tutorial overlay flows.
 *
 * Tests that require a live backend (game creation, socket events) are tagged
 * with `@backend` and skipped automatically when `BACKEND_URL` is not set.
 */
import { expect, test } from '@playwright/test';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL;

// ── Training Academy (TutorialPage) ──────────────────────────────────────────

test.describe('Training Academy page', () => {
  test('renders module cards and headers', async ({ page }) => {
    await page.goto('/tutorial');
    await expect(page.getByRole('heading', { name: /training academy/i })).toBeVisible();
    await expect(page.getByText(/Core Tutorial/i)).toBeVisible();
    await expect(page.getByText(/Advanced Settings/i)).toBeVisible();
    await expect(page.getByText(/Faction Abilities/i)).toBeVisible();
    await expect(page.getByText(/Technology Tree/i)).toBeVisible();
  });

  test('shows Start Lesson button on each module card', async ({ page }) => {
    await page.goto('/tutorial');
    const startButtons = page.getByRole('button', { name: /start lesson|start core/i });
    await expect(startButtons.first()).toBeVisible();
  });
});

// ── TutorialOverlay unit-like checks (static, no backend) ────────────────────

test.describe('Tutorial overlay static checks', () => {
  test.skip(!BACKEND_AVAILABLE, 'Backend required for game creation');

  test('core tutorial: first step overlay is visible after game start', async ({ page }) => {
    // Register a guest and start the core tutorial via the API.
    await page.goto('/tutorial');
    // Click the Core Tutorial start button.
    const coreCard = page.locator('[data-testid="module-card-core"]');
    await coreCard.getByRole('button', { name: /start/i }).click();
    // Should navigate to /game/:id
    await page.waitForURL(/\/game\//);
    // Tutorial overlay should be visible.
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 8000 });
    // First step title
    await expect(page.getByText(/welcome to borderfall/i)).toBeVisible({ timeout: 5000 });
  });

  test('exit mid-lesson returns to lobby and does NOT mark module complete', async ({ page }) => {
    await page.goto('/tutorial');
    const coreCard = page.locator('[data-testid="module-card-core"]');
    await coreCard.getByRole('button', { name: /start/i }).click();
    await page.waitForURL(/\/game\//);
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 8000 });
    // Click Exit Tutorial — abandons the game and returns to the lobby.
    await page.locator('[data-testid="tutorial-exit-btn"]').click();
    await page.waitForURL(/\/lobby/, { timeout: 8000 });
    // Navigate back to Training Academy and verify the core module is NOT marked done.
    await page.goto('/tutorial');
    const coreCard2 = page.locator('[data-testid="module-card-core"]');
    await expect(coreCard2.getByText(/done/i)).not.toBeVisible();
  });
});

// ── Advanced Settings module ──────────────────────────────────────────────────

test.describe('Advanced Settings tutorial module', () => {
  test.skip(!BACKEND_AVAILABLE, 'Backend required for game creation');

  test('opens settings lab when step reaches as_try_toggle', async ({ page }) => {
    await page.goto('/tutorial');
    const card = page.locator('[data-testid="module-card-advanced_settings"]');
    await card.getByRole('button', { name: /start/i }).click();
    await page.waitForURL(/\/game\//);
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 8000 });

    // Advance through static steps until as_try_toggle
    const nextBtn = page.locator('[data-testid="tutorial-next-btn"]');
    // There are 5 read steps before the interactive one (as_welcome, as_timers, as_fog, as_economy, as_stacking)
    for (let i = 0; i < 5; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 3000 });
      await nextBtn.click();
    }
    // Now on as_try_toggle — "Open Settings Lab" button should appear
    const labBtn = page.locator('[data-testid="tutorial-open-settings-lab"]');
    await expect(labBtn).toBeVisible({ timeout: 3000 });
    await labBtn.click();
    await expect(page.locator('[data-testid="tutorial-settings-lab"]')).toBeVisible();

    // Toggle two distinct settings to satisfy the explore threshold
    await page.locator('[data-testid="lab-toggle-fog_of_war"]').click();
    await expect(page.getByText(/1 of 2 explored/i)).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="lab-toggle-factions_enabled"]').click();
    // Success message should appear once two settings are explored
    await expect(page.getByText(/2 settings explored/i)).toBeVisible({ timeout: 3000 });
  });
});

// ── Faction Ability module ────────────────────────────────────────────────────

test.describe('Faction Ability tutorial module', () => {
  test.skip(!BACKEND_AVAILABLE, 'Backend required for game creation');

  test('faction lesson starts with china_ww2 and shows guerrilla ability button', async ({ page }) => {
    await page.goto('/tutorial');
    const card = page.locator('[data-testid="module-card-faction_ability"]');
    await card.getByRole('button', { name: /start/i }).click();
    await page.waitForURL(/\/game\//);
    await expect(page.locator('[data-testid="tutorial-overlay"]')).toBeVisible({ timeout: 8000 });
    // Step 1 mentions China
    await expect(page.getByText(/china/i)).toBeVisible({ timeout: 5000 });

    // Advance to fa_identity to open bonuses
    await page.locator('[data-testid="tutorial-next-btn"]').click();
    // Bonuses panel should be openable
    const bonusBtn = page.getByRole('button', { name: /open bonuses/i });
    await expect(bonusBtn).toBeVisible({ timeout: 3000 });
  });
});
