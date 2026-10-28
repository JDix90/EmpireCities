/**
 * The BETA tag on a Galactic Age game while the era is an open beta. Tapping
 * it says what that means; nothing opens on its own mid-game.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GalacticBetaTag, { GALACTIC_BETA_WELCOME_NOTE } from './GalacticBetaTag';

describe('GalacticBetaTag', () => {
  it('says what BETA means when tapped, and closes again', () => {
    render(<GalacticBetaTag />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Galactic Age beta/ }));
    expect(screen.getByRole('dialog', { name: 'Galactic Age beta' })).toHaveTextContent(/rules and balance may change/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<GalacticBetaTag />);
    fireEvent.click(screen.getByRole('button', { name: /Galactic Age beta/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers Send feedback only when there is a form to open', () => {
    const { unmount } = render(<GalacticBetaTag />);
    fireEvent.click(screen.getByRole('button', { name: /Galactic Age beta/ }));
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
    unmount();
    const onSendFeedback = vi.fn();
    render(<GalacticBetaTag onSendFeedback={onSendFeedback} />);
    fireEvent.click(screen.getByRole('button', { name: /Galactic Age beta/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(onSendFeedback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("points the first game's welcome at the tag", () => {
    expect(GALACTIC_BETA_WELCOME_NOTE).toMatch(/in beta/);
    expect(GALACTIC_BETA_WELCOME_NOTE).toMatch(/Tap BETA in the top bar/);
  });
});
