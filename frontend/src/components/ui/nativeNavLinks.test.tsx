/**
 * The lobby's navigation offers the website's landing page ("Home", "Landing").
 * In the native app `/` is the lobby itself, so those entries are left out.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import TopNavBar from './TopNavBar';
import MobileTabBar from './MobileTabBar';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  // The tab bar asks whether the phone is on its side.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTopBar() {
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <TopNavBar user={{ username: 'Commander' }} onLogout={() => {}} />
    </MemoryRouter>,
  );
}

describe('TopNavBar', () => {
  it('links to the landing page on the website', () => {
    renderTopBar();
    expect(screen.getByTitle('Landing page')).toHaveAttribute('href', '/');
  });

  it('leaves the landing page out of the native app, and keeps the rest', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    renderTopBar();
    expect(screen.queryByTitle('Landing page')).toBeNull();
    expect(screen.getByTitle('Leaderboards')).toBeInTheDocument();
  });
});

describe('MobileTabBar', () => {
  function openMore() {
    render(
      <MemoryRouter initialEntries={['/lobby']}>
        <MobileTabBar isGuest={false} onCreateGame={() => {}} onLogout={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
  }

  it('offers the landing page under More on the website', () => {
    openMore();
    expect(screen.getByRole('link', { name: 'Landing' })).toHaveAttribute('href', '/');
  });

  it('leaves it out of the native app, and keeps Privacy and Terms', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    openMore();
    expect(screen.queryByRole('link', { name: 'Landing' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms' })).toBeInTheDocument();
  });
});
