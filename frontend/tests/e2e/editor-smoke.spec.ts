import { expect, test, type Page } from '@playwright/test';

/**
 * The map editor as a signed-in player meets it, against the built app with
 * the API stubbed (this job has no backend) and the real Natural Earth data:
 * the start screen offers the continents, one click builds a draft that
 * passes Map health, and the camera lands on that continent. Two continents straddle the
 * antimeridian in the data (Oceania through Fiji, Kiribati and New Zealand;
 * Europe through Russia), and a box in plain longitudes once sent the camera
 * to the Atlantic for one and the Pacific for the other.
 */

function fakeAccessToken(): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'u-editor', username: 'Cartographer', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

/** A signed-in player and no backend: every API call but the token refresh answers 404. */
async function signIn(page: Page) {
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/auth/refresh') {
      return route.fulfill({ json: { accessToken: fakeAccessToken() } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.addInitScript(() => {
    const user = { user_id: 'u-editor', username: 'Cartographer', level: 3, xp: 400, mmr: 1000, gold: 120 };
    localStorage.setItem('cc-auth', JSON.stringify({ state: { user, isAuthenticated: true }, version: 0 }));
  });
}

/** Where the globe was last asked to look, as the editor's globe root reports it. */
async function cameraCentre(page: Page) {
  const globe = page.getByTestId('editor-globe');
  await expect(globe).toHaveAttribute('data-focus-lng', /-?\d/);
  return {
    lat: Number(await globe.getAttribute('data-focus-lat')),
    lng: Number(await globe.getAttribute('data-focus-lng')),
  };
}

async function startFromContinent(page: Page, continent: string) {
  await page.goto('/editor');
  await expect(page.getByRole('heading', { name: 'Start a map' })).toBeVisible();
  // The continent cards wait for the 3 MB Natural Earth file.
  const card = page.getByRole('button', { name: new RegExp(`^${continent}\\b`) });
  await expect(card).toBeEnabled({ timeout: 20_000 });
  await card.click();
  await expect(page.getByRole('heading', { name: 'Start a map' })).toBeHidden({ timeout: 20_000 });
  // The draft is named after the continent, and a template passes the publish checks as it is.
  await expect(page.getByRole('textbox', { name: 'Map name' })).toHaveValue(continent);
  const health = page.getByTestId('map-health');
  await expect(health).toBeVisible();
  await expect(health.getByText('Ready to publish')).toBeVisible();
}

test.describe('Map editor', () => {
  // The 3 MB Natural Earth file, the globe chunk and a template over real
  // geometry: a minute on a slow runner, well over the default 30 s.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('one click on Oceania makes a draft, and the camera is over the Pacific', async ({ page }) => {
    await startFromContinent(page, 'Oceania');
    const { lat, lng } = await cameraCentre(page);
    // East of 100° E or west of 150° W: the Pacific, not the Atlantic.
    expect(lng > 100 || lng < -150, `camera at lng ${lng}`).toBe(true);
    expect(lat, `camera at lat ${lat}`).toBeLessThan(10);
  });

  test('Europe, whose Russia reaches past the antimeridian, is seen from Europe', async ({ page }) => {
    await startFromContinent(page, 'Europe');
    const { lat, lng } = await cameraCentre(page);
    expect(lng, `camera at lng ${lng}`).toBeGreaterThan(-30);
    expect(lng, `camera at lng ${lng}`).toBeLessThan(60);
    expect(lat, `camera at lat ${lat}`).toBeGreaterThan(35);
  });
});
