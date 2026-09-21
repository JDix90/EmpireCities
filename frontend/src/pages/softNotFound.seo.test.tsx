/**
 * Every "this does not exist" state must carry `noindex`.
 *
 * A pure SPA answers HTTP 200 with the app shell for every URL, so a route
 * that renders error copy still looks like a successful page to a crawler.
 * Google renders JS, sees the error copy under a 200, and files a **soft
 * 404** — which is exactly what Search Console reported for borderfall.gg on
 * 2026-09-20. NotFoundPage had the fix; these two states did not, because each
 * one grew its own not-found branch.
 *
 * The test is per-state rather than per-hook on purpose: the hook has its own
 * unit tests, and what regressed here was a page forgetting to call it. A new
 * page with a not-found branch should get a case here too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AnswerPage from './AnswerPage';
import DailyArchivePage from './DailyArchivePage';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a) },
}));

const isNoindexed = () => !!document.head.querySelector('meta[name="robots"][content*="noindex"]');

beforeEach(() => getMock.mockReset());
afterEach(() => {
  cleanup();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

describe('soft-404 states are not indexable', () => {
  it('/answers/:slug with an unknown slug', async () => {
    render(
      <MemoryRouter initialEntries={['/answers/no-such-slug']}>
        <Routes><Route path="/answers/:slug" element={<AnswerPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no such question/i)).toBeTruthy();
    expect(isNoindexed()).toBe(true);
  });

  it('/daily/:date with nothing archived', async () => {
    // ...Once, not a persistent rejection: a standing rejected implementation
    // leaves a rejected promise parked in the spy's recorded results, which
    // the runner reports as an unhandled error even though the component
    // catches it. The page makes exactly one request, so once is enough.
    getMock.mockRejectedValueOnce(new Error('no such day'));
    render(
      <MemoryRouter initialEntries={['/daily/not-a-date']}>
        <Routes><Route path="/daily/:date" element={<DailyArchivePage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no archived challenge/i)).toBeTruthy();
    expect(isNoindexed()).toBe(true);
  });

  it('a real archived day stays indexable', async () => {
    getMock.mockResolvedValue({
      data: {
        challenge_date: '2026-09-19',
        kind: 'daily',
        spec: {
          archetype: 'conquest', title: 'All Roads', intro: 'An intro.', goal: 'A goal.',
          era_id: 'classical', era_label: 'Classical', map_id: 'world',
          player_count: 4, max_turns: 20, par_turns: 12, ai_difficulty: 'normal',
        },
        results: {
          attempts: 0, wins: 0, win_rate: null, best_score: null,
          median_winning_turns: null, leaderboard: [],
        },
      },
    });
    render(
      <MemoryRouter initialEntries={['/daily/2026-09-19']}>
        <Routes><Route path="/daily/:date" element={<DailyArchivePage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/all roads/i)).toBeTruthy();
    // The regression that would hurt most: a blanket noindex on real content.
    expect(isNoindexed()).toBe(false);
  });
});
