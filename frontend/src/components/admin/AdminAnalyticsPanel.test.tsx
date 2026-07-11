import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminAnalyticsPanel, { type AnalyticsReport } from './AdminAnalyticsPanel';

const report: AnalyticsReport = {
  window_days: 30,
  total_events: 250,
  funnel: { signups: 100, created_game: 70, started_game: 65, map_rendered: 60, first_attack: 52, first_capture: 44, finished_game: 40, upgraded: 12 },
  retention: { d1_cohort: 90, d1: 27, d7_cohort: 60, d7: 9 },
  completion: { finishes: 40, wins: 18, tutorial_finishes: 14, avg_minutes: 22.4, avg_turns: 31 },
  volume: [
    { event: 'game_started', n: 65 },
    { event: 'guest_created', n: 80 },
  ],
};

describe('AdminAnalyticsPanel', () => {
  it('shows a loading hint when data is null', () => {
    render(<AdminAnalyticsPanel data={null} />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it('hides the visitor funnel when absent/empty, shows it when populated', () => {
    const { unmount } = render(<AdminAnalyticsPanel data={report} />);
    expect(screen.queryByText('Visitor funnel')).toBeNull();
    unmount();
    render(
      <AdminAnalyticsPanel
        data={{ ...report, visitors: { landed: 40, clicked_play: 15, signed_up: 9 } }}
      />,
    );
    expect(screen.getByText('Visitor funnel')).toBeTruthy();
    expect(screen.getByText('Clicked Play')).toBeTruthy();
    expect(screen.getByText('Signed up ★')).toBeTruthy();
  });

  it('shows an enable hint when nothing has been recorded yet', () => {
    render(<AdminAnalyticsPanel data={{ ...report, total_events: 0 }} />);
    expect(screen.getByText(/No analytics events yet/i)).toBeTruthy();
    expect(screen.getByText(/ANALYTICS_EVENTS_ENABLED/)).toBeTruthy();
  });

  it('renders funnel, retention, completion and volume from the report', () => {
    render(<AdminAnalyticsPanel data={report} />);
    // funnel
    expect(screen.getByText('Activation funnel')).toBeTruthy();
    expect(screen.getByText('Signed up')).toBeTruthy();
    expect(screen.getByText('Created a game')).toBeTruthy();
    // First-session activation steps
    expect(screen.getByText('Reached the map')).toBeTruthy();
    expect(screen.getByText('Made first attack')).toBeTruthy();
    expect(screen.getByText('Captured a territory')).toBeTruthy();
    expect(screen.getByText('Finished a game ★')).toBeTruthy();
    expect(screen.getByText(/Guest → account: 12/)).toBeTruthy();
    // retention
    expect(screen.getByText('D1 retention')).toBeTruthy();
    expect(screen.getByText('27/90 returned')).toBeTruthy();
    expect(screen.getByText('D7 retention')).toBeTruthy();
    // completion
    expect(screen.getByText('22.4m')).toBeTruthy();
    expect(screen.getByText('31 turns')).toBeTruthy();
    // event volume
    expect(screen.getByText('game_started')).toBeTruthy();
    expect(screen.getByText('guest_created')).toBeTruthy();
  });
});
