import { expect, test, type Page } from '@playwright/test';

/**
 * Regression guard for mobile territory selection: taps on the map canvas
 * must reach the territory click handler on small touch viewports.
 * Uses the backend-free Map Visual Lab, which records the last clicked
 * territory in a data attribute.
 */

const LAST_CLICK = '[data-testid="lab-map-wrap"]';

async function tapGridUntilTerritoryClicked(page: Page): Promise<string | null> {
  const wrap = page.getByTestId('lab-map-wrap');
  const box = await wrap.boundingBox();
  if (!box) return null;

  // Sweep a grid of positions — territory layouts differ between the 2D
  // canvas and the globe projection, so we don't aim at exact polygons.
  for (const fx of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    for (const fy of [0.25, 0.35, 0.45, 0.55, 0.65]) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      if (test.info().project.use.hasTouch) {
        await page.touchscreen.tap(x, y);
      } else {
        await page.mouse.click(x, y);
      }
      await page.waitForTimeout(150);
      const clicked = await page.locator(LAST_CLICK).getAttribute('data-last-territory-click');
      if (clicked) return clicked;
    }
  }
  return null;
}

test.describe('Mobile territory tap', () => {
  test('tap selects a territory on the 2D map', async ({ page }) => {
    await page.goto('/__map-visual-lab');
    await expect(page.getByRole('heading', { name: 'Map Visual Lab' })).toBeVisible();
    const clicked = await tapGridUntilTerritoryClicked(page);
    expect(clicked, '2D map tap should reach onTerritoryClick').toBeTruthy();
  });

  test('tap selects a territory on the globe', async ({ page }) => {
    await page.goto('/__map-visual-lab');
    await expect(page.getByRole('heading', { name: 'Map Visual Lab' })).toBeVisible();
    await page.getByRole('button', { name: 'Globe', exact: true }).click();
    await expect(page.getByTestId('globe-map-root')).toBeVisible({ timeout: 15_000 });
    // Give the globe a moment to finish its initial camera setup.
    await page.waitForTimeout(2_000);
    const clicked = await tapGridUntilTerritoryClicked(page);
    expect(clicked, 'globe tap should reach onTerritoryClick').toBeTruthy();
  });
});
