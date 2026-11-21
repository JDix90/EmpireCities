/**
 * The Terms of Service say what the App Store asks of an app with chat: no
 * tolerance for objectionable content or abusive players, how to report it,
 * and that reports are acted on. How to report follows chat_safety_enabled,
 * as the Privacy Policy does: without it there is no menu in chat.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsPage from './TermsPage';
import { LEGAL_LAST_UPDATED, SUPPORT_EMAIL } from '../constants/brand';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const setChatSafety = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, chat_safety_enabled: on } }));

// Before each test, not after: the page is still mounted when an afterEach runs.
beforeEach(() => setChatSafety(false));

function conduct() {
  render(<MemoryRouter><TermsPage /></MemoryRouter>);
  return screen.getByTestId('terms-conduct');
}

describe('TermsPage: chat, player content and reports', () => {
  it('says there is no tolerance for objectionable content or abusive players, anywhere in the game', () => {
    const section = conduct();
    expect(section).toHaveTextContent(/no tolerance for objectionable content or abusive players/);
    expect(section).toHaveTextContent(/in chat, in your username, in a custom map, or anywhere else/);
    expect(section).toHaveTextContent(/Do not bully, abuse, or impersonate other players/);
  });

  it('says every report is reviewed within 24 hours and what happens to the player who posted it', () => {
    const section = conduct();
    expect(section).toHaveTextContent(/We review every report within 24 hours/);
    expect(section).toHaveTextContent(/we remove it and act against the player who posted it, from a warning to a permanent ban/);
  });

  it('points to the chat\'s Report and Block with chat safety on', () => {
    setChatSafety(true);
    const section = conduct();
    expect(section).toHaveTextContent(/tap ⋯ beside a chat message and choose Report message/);
    expect(section).toHaveTextContent(/block a player from the same menu/);
    expect(within(section).getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  it('points to email only with chat safety off, since chat has no menu then', () => {
    const section = conduct();
    expect(section).not.toHaveTextContent(/Report message|block a player/);
    expect(section).toHaveTextContent(/report it by emailing us at/);
    expect(within(section).getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  it('says Colorado law governs and disputes go to individual arbitration, with an opt-out', () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    const section = screen.getByTestId('terms-disputes');
    expect(section).toHaveTextContent(/governed by the laws of the State of Colorado, USA/);
    expect(section).toHaveTextContent(/binding arbitration administered by the American Arbitration Association under its Consumer Arbitration Rules/);
    expect(section).toHaveTextContent(/small claims court/);
    expect(section).toHaveTextContent(/No class actions/);
    // Existing players get the same 30 days, counted from the day arbitration was added.
    expect(section).toHaveTextContent(/subject “Arbitration opt-out” within 30 days of first accepting these Terms \(if you joined before November 21, 2026, within 30 days of that date\)/);
    expect(section).toHaveTextContent(/European Economic Area, the United Kingdom/);
    for (const link of within(section).getAllByRole('link', { name: SUPPORT_EMAIL })) {
      expect(link).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
    }
  });

  it('carries the date of this change', () => {
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    expect(LEGAL_LAST_UPDATED).toBe('November 21, 2026');
    expect(screen.getByText(`Last updated: ${LEGAL_LAST_UPDATED}`)).toBeInTheDocument();
  });
});
