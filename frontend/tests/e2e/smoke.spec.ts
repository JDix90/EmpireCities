import { expect, test, type Page } from '@playwright/test';

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

/**
 * No page may be wider than the screen it is on. A page that is gets a
 * sideways scroll on a desktop and, on a phone or tablet, is zoomed out to
 * fit: the lobby's top bar ran 1,150px wide on every screen from 768px to
 * 1,024px, and an iPad showed the whole lobby shrunk. The API is stubbed (this
 * job has no backend): pages render their empty and error states, which still
 * carry every bar, header and form row a player sees.
 */
const SCREENS = [
  { name: 'small phone', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet on its side', width: 1024, height: 768 },
];
const PUBLIC_PAGES = ['/', '/how-to-play', '/eras', '/eras/ww2', '/game-maps', '/answers', '/codex', '/about', '/login', '/register'];
const PLAYER_PAGES = ['/lobby', '/profile', '/friends', '/settings', '/store', '/leaderboards', '/daily'];

function fakeAccessToken(): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'u-smoke', username: 'Smoke', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

async function stubApi(page: Page, signedIn: boolean) {
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => {
    if (signedIn && new URL(route.request().url()).pathname === '/api/auth/refresh') {
      return route.fulfill({ json: { accessToken: fakeAccessToken() } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  if (signedIn) {
    await page.addInitScript(() => {
      const user = { user_id: 'u-smoke', username: 'Smoke', level: 3, xp: 400, mmr: 1000, gold: 120 };
      localStorage.setItem('cc-auth', JSON.stringify({ state: { user, isAuthenticated: true }, version: 0 }));
    });
  }
}

/** How far the page runs past the screen's right edge, and what does it. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const by = document.documentElement.scrollWidth - width;
    const culprits = by <= 0 ? [] : [...document.body.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.right <= width + 1 || r.width === 0) return false;
        const parent = el.parentElement?.getBoundingClientRect();
        return !parent || parent.right <= width + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    return { by, culprits };
  });
}

for (const [signedIn, pages] of [[false, PUBLIC_PAGES], [true, PLAYER_PAGES]] as const) {
  test.describe(`${signedIn ? 'Player' : 'Public'} pages fit phone and tablet screens`, () => {
    for (const path of pages) {
      test(path, async ({ page }) => {
        await stubApi(page, signedIn);
        for (const screen of SCREENS) {
          await page.setViewportSize({ width: screen.width, height: screen.height });
          await page.goto(path);
          await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
          const { by, culprits } = await overflow(page);
          expect(by, `${path} on a ${screen.name} (${screen.width}px) is ${by}px wider than the screen: ${culprits.join('; ')}`).toBeLessThanOrEqual(0);
        }
      });
    }
  });
}
