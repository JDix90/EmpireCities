/**
 * A guest's day in the lobby (comeback_hook_enabled): their streak while it
 * lives, and today's Daily Challenge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuestDayCard from './GuestDayCard';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../services/api', () => ({ api: { get: apiGet, post: apiPost } }));

const renderCard = (summary: Parameters<typeof GuestDayCard>[0]['dailySummary']) =>
  render(<MemoryRouter><GuestDayCard dailySummary={summary} /></MemoryRouter>);

describe('GuestDayCard', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockClear();
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, funnel_events_v2_enabled: true } }));
  });

  it('names a live streak and whether today already counts', async () => {
    apiGet.mockResolvedValue({ data: { daily_streak: 2, played_today: false, streak_alive: true } });
    renderCard({ era_id: 'medieval', title: 'The Ottoman Gates', completed: false });
    expect(await screen.findByText('2-day play streak.')).toBeInTheDocument();
    expect(screen.getByTestId('guest-day-streak')).toHaveTextContent('Finish a game today to keep it.');
    expect(screen.getByTestId('guest-day-daily')).toHaveTextContent("Today's Daily Challenge: The Ottoman Gates");
    expect(screen.getByTestId('guest-day-daily')).toHaveTextContent('Medieval Era · One puzzle');
  });

  it('does not show a streak that has lapsed', async () => {
    apiGet.mockResolvedValue({ data: { daily_streak: 6, played_today: false, streak_alive: false } });
    renderCard(null);
    await screen.findByTestId('guest-day-card');
    await Promise.resolve();
    expect(screen.queryByText(/6-day/)).toBeNull();
    expect(screen.getByTestId('guest-day-streak')).toHaveTextContent('Finish a game today to start a play streak.');
  });

  it('says when today\'s is done, and records a press on the daily link', async () => {
    apiGet.mockResolvedValue({ data: { daily_streak: 1, played_today: true, streak_alive: true } });
    renderCard({ era_id: 'ww2', title: 'Bridgehead', completed: true });
    expect(await screen.findByText(/Today counts already/)).toBeInTheDocument();
    expect(screen.getByTestId('guest-day-daily')).toHaveTextContent('Done. A new one opens at midnight UTC.');
    fireEvent.click(screen.getByTestId('guest-day-daily'));
    expect(apiPost).toHaveBeenCalledWith('/analytics/ui-event', { event: 'daily_link_clicked', properties: { surface: 'lobby', place: 'guest_card' } });
  });
});
