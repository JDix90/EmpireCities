/**
 * Garrison doctrines in the battle report (docs/GALACTIC_AGE_BUILDINGS.md §5):
 * a side that rolled d8s shows them as different dice and the report says
 * which doctrine did it. A result without doctrines renders exactly as before.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CombatResultView } from './ActionModal';
import type { CombatResult } from '../../store/gameStore';

vi.mock('../../services/socket', () => ({
  getSocket: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));
vi.mock('../../services/api', () => ({ api: { get: () => Promise.resolve({ data: {} }), post: () => Promise.resolve({ data: {} }) } }));
vi.mock('../../utils/userPreferences', async (orig) => ({
  ...(await orig<object>()),
  getFastCombatPreference: () => true,
}));

const plain: CombatResult = {
  attacker_rolls: [6, 4],
  defender_rolls: [5],
  attacker_losses: 0,
  defender_losses: 1,
  territory_captured: true,
};

describe('the battle report under garrison doctrines', () => {
  it('marks d8 dice and names the doctrine behind them', () => {
    render(
      <CombatResultView
        result={{ ...plain, attacker_rolls: [8, 7], attacker_die_faces: 8, attacker_doctrine: 'forward', defender_rolls: [7], defender_die_faces: 8, defender_doctrine: 'hardened' }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getAllByTestId('die-d8')).toHaveLength(3);
    const callout = screen.getByTestId('doctrine-callout');
    expect(callout).toHaveTextContent(/Forward garrison: the attack rolled d8s/);
    expect(callout).toHaveTextContent(/Hardened garrison: the defence rolled d8s/);
  });

  it('shows plain dice and no callout without doctrines', () => {
    render(<CombatResultView result={plain} onDismiss={() => {}} />);
    expect(screen.queryAllByTestId('die-d8')).toHaveLength(0);
    expect(screen.queryByTestId('doctrine-callout')).toBeNull();
  });
});
