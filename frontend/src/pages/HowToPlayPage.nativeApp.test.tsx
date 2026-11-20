/**
 * How to Play inside the native app shows the app's FAQ, and the website
 * still shows its own.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import HowToPlayPage from './HowToPlayPage';

afterEach(() => vi.restoreAllMocks());

const show = () => render(<MemoryRouter><HowToPlayPage /></MemoryRouter>);

describe('How to Play FAQ', () => {
  it('in the app, never calls the game browser-based or says there is nothing to install', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    show();
    expect(screen.getByText('What is Borderfall?')).toBeInTheDocument();
    expect(screen.queryByText(/browser-based/)).toBeNull();
    expect(screen.queryByText(/free in your browser/)).toBeNull();
    expect(screen.queryByText('Do I need to download or install anything?')).toBeNull();
    expect(screen.queryByText('What do I need to play Borderfall?')).toBeNull();
  });

  it('on the website, is the FAQ it always was', () => {
    show();
    expect(screen.getByText(/browser-based turn-based strategy game/)).toBeInTheDocument();
    expect(screen.getByText('Do I need to download or install anything?')).toBeInTheDocument();
    expect(screen.getByText('What do I need to play Borderfall?')).toBeInTheDocument();
  });
});
