/**
 * The path selection screen: each card says how hard the path is and how long
 * its opening stage can run, one is marked as the place to start, and the
 * Classic campaign is no longer offered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CampaignPage, { pathMetaLine } from './CampaignPage';
import { useAuthStore } from '../store/authStore';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const PATHS = [
  { path_id: 'blood_empire', name: 'Blood & Empire', tagline: 't', description: 'd', signature_carry_key: 'prestige_bonus', signature_carry_label: 'Prestige', signature_carry_max: 12, era_count: 6, difficulty: 'standard', recommended_start: true, first_stage_max_turns: 25 },
  { path_id: 'last_defenders', name: 'The Last Defenders', tagline: 't', description: 'd', signature_carry_key: 'survivor_bonus', signature_carry_label: 'Survivor Bonus', signature_carry_max: 8, era_count: 6, difficulty: 'hardest', recommended_start: false, first_stage_max_turns: 30 },
];

describe('campaign path selection', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation((url: string) =>
      url === '/campaign/list' ? Promise.resolve({ data: { campaigns: [] } }) : Promise.resolve({ data: PATHS }),
    );
    useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: false } as never });
  });

  it('says how hard each path is and how long its opening stage runs, and marks one to start with', async () => {
    render(<MemoryRouter><CampaignPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /Blood & Empire/ });
    expect(screen.getAllByTestId('campaign-path-meta').map((el) => el.textContent)).toEqual([
      'Standard · 6 eras · Opening stage: up to 25 rounds',
      'Hardest · 6 eras · Opening stage: up to 30 rounds',
    ]);
    expect(screen.getAllByTestId('campaign-path-start-here')).toHaveLength(1);
  });

  it('does not offer the Classic campaign', async () => {
    render(<MemoryRouter><CampaignPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /Blood & Empire/ });
    expect(screen.queryByText(/Classic Campaign/)).toBeNull();
  });

  it('writes the meta line from what an older server sends, down to nothing', () => {
    expect(pathMetaLine({ era_count: 6 })).toBe('6 eras');
    expect(pathMetaLine({ era_count: 0 })).toBe('');
  });
});
