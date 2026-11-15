import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const native = vi.hoisted(() => ({ on: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? 'ios' : 'web') },
}));
const app = vi.hoisted(() => ({
  listener: null as null | ((e: { url: string }) => void),
  launchUrl: undefined as string | undefined,
  removed: 0,
  listened: 0,
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, cb: (e: { url: string }) => void) => {
      app.listened += 1;
      app.listener = cb;
      return { remove: async () => { app.removed += 1; } };
    },
    getLaunchUrl: async () => (app.launchUrl ? { url: app.launchUrl } : undefined),
  },
}));
// The site the app was built against (utils/publicOrigin.ts).
vi.mock('../../utils/publicOrigin', () => ({ publicSiteOrigin: () => 'https://borderfall.gg' }));

import AppLinkHandler from './AppLinkHandler';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.search}</p>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppLinkHandler />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const open = (url: string) => act(() => { app.listener?.({ url }); });

beforeEach(() => {
  native.on = true;
  app.listener = null;
  app.launchUrl = undefined;
  app.removed = 0;
  app.listened = 0;
});

describe('AppLinkHandler', () => {
  it('does nothing on the website', async () => {
    native.on = false;
    renderApp();
    await new Promise((r) => setTimeout(r, 20));
    expect(app.listened).toBe(0);
    expect(where()).toBe('/');
  });

  it('follows an emailed sign-in link that opened the running app', async () => {
    renderApp();
    await waitFor(() => expect(app.listener).not.toBeNull());
    open('https://borderfall.gg/sign-in-link?token=abc123');
    expect(where()).toBe('/sign-in-link?token=abc123');
  });

  it('follows the link that started the app', async () => {
    app.launchUrl = 'https://borderfall.gg/join/ABC123';
    renderApp();
    await waitFor(() => expect(where()).toBe('/join/ABC123'));
  });

  // A cold start can report the same link both ways, and a sign-in link works once.
  it('follows a link once when the launch and the listener both report it', async () => {
    app.launchUrl = 'https://borderfall.gg/replay/g1?source=share';
    renderApp();
    await waitFor(() => expect(where()).toBe('/replay/g1?source=share'));
    open('https://borderfall.gg/game/g2');
    expect(where()).toBe('/game/g2');
    // The launch link again, late: already followed, so the player is not moved back.
    open('https://borderfall.gg/game/g2');
    expect(where()).toBe('/game/g2');
  });

  it('ignores a link to somewhere else, or to a page that is not the app\'s', async () => {
    renderApp();
    await waitFor(() => expect(app.listener).not.toBeNull());
    open('https://evil.test/sign-in-link?token=abc');
    open('https://borderfall.gg/admin');
    open('https://borderfall.gg/answers/is-borderfall-free');
    expect(where()).toBe('/');
  });

  it('stops listening when it goes away', async () => {
    const { unmount } = renderApp();
    await waitFor(() => expect(app.listener).not.toBeNull());
    unmount();
    await waitFor(() => expect(app.removed).toBe(1));
  });
});
