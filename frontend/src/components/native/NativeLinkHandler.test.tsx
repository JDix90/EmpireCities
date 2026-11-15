import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

const browserOpen = vi.fn();
vi.mock('@capacitor/browser', () => ({ Browser: { open: (...a: unknown[]) => browserOpen(...a) } }));

import NativeLinkHandler from './NativeLinkHandler';
import WebOnlyRoute from './WebOnlyRoute';

/** jsdom serves the test from http://localhost:3000, so that is "our" origin here. */
function renderApp(start = '/') {
  const onMenuLink = vi.fn();
  render(
    <MemoryRouter initialEntries={[start]}>
      <NativeLinkHandler />
      <Routes>
        <Route
          path="/"
          element={(
            <div>
              <p>home</p>
              <a href="https://www.reddit.com/r/borderfall" target="_blank" rel="noopener noreferrer">Reddit</a>
              <a href="https://example.com/page"><span>Nested</span></a>
              <a href="mailto:support@borderfall.gg">Mail</a>
              <Link to="/help" target="_blank" onClick={onMenuLink}>Help in a new tab</Link>
              <Link to="/help">Help</Link>
              <a href="blob:http://localhost:3000/abc" download="clip.gif">Download</a>
            </div>
          )}
        />
        <Route path="/help" element={<p>help page</p>} />
        <Route path="/answers" element={<WebOnlyRoute><p>answers page</p></WebOnlyRoute>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onMenuLink };
}

/** Whether the browser was left to follow the link itself. */
function clickAndSeeIfFollowed(el: HTMLElement): boolean {
  return fireEvent.click(el);
}

afterEach(() => {
  vi.restoreAllMocks();
  browserOpen.mockReset();
});

describe('NativeLinkHandler', () => {
  it('does nothing on the website: every link is left to the browser', () => {
    renderApp();
    expect(clickAndSeeIfFollowed(screen.getByText('Reddit'))).toBe(true);
    expect(clickAndSeeIfFollowed(screen.getByText('Help in a new tab'))).toBe(true);
    expect(browserOpen).not.toHaveBeenCalled();
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  describe('in the native app', () => {
    const native = () => {
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
      browserOpen.mockResolvedValue(undefined);
    };

    it('opens another site in the in-app browser instead of leaving the game', async () => {
      native();
      renderApp();
      expect(clickAndSeeIfFollowed(screen.getByText('Reddit'))).toBe(false);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: 'https://www.reddit.com/r/borderfall' }));
      // A tap that lands on something inside the link still counts.
      expect(clickAndSeeIfFollowed(screen.getByText('Nested'))).toBe(false);
      await waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: 'https://example.com/page' }));
      expect(screen.getByText('home')).toBeInTheDocument();
    });

    it('opens one of our own pages in place when the link asked for a new tab', () => {
      native();
      const { onMenuLink } = renderApp();
      expect(clickAndSeeIfFollowed(screen.getByText('Help in a new tab'))).toBe(false);
      expect(screen.getByText('help page')).toBeInTheDocument();
      // The link's own handler ran first.
      expect(onMenuLink).toHaveBeenCalledTimes(1);
      expect(browserOpen).not.toHaveBeenCalled();
    });

    it('leaves in-app links, mail links and downloads alone', () => {
      native();
      renderApp();
      expect(clickAndSeeIfFollowed(screen.getByText('Mail'))).toBe(true);
      expect(clickAndSeeIfFollowed(screen.getByText('Download'))).toBe(true);
      fireEvent.click(screen.getByText('Help'));
      expect(screen.getByText('help page')).toBeInTheDocument();
      expect(browserOpen).not.toHaveBeenCalled();
    });
  });
});

describe('WebOnlyRoute', () => {
  it('shows the page on the website', () => {
    renderApp('/answers');
    expect(screen.getByText('answers page')).toBeInTheDocument();
  });

  it('sends the native app to its home instead', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    renderApp('/answers');
    expect(screen.queryByText('answers page')).toBeNull();
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
