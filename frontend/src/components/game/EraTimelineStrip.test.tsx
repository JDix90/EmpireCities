import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EraTimelineStrip from './EraTimelineStrip';
import type { GameState, PlayerState } from '../../store/gameStore';

const CLASSIC_SPINE = [
  { era_id: 'ancient' },
  { era_id: 'medieval' },
  { era_id: 'discovery' },
  { era_id: 'ww2' },
  { era_id: 'coldwar' },
  { era_id: 'modern' },
];

function player(id: string, eraIndex: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: id,
    username: id.toUpperCase(),
    color: '#abcdef',
    is_eliminated: false,
    current_era_index: eraIndex,
    ...overrides,
  } as PlayerState;
}

function state(players: PlayerState[], overrides: Partial<GameState> = {}): GameState {
  return {
    players,
    era_spine: CLASSIC_SPINE,
    settings: { era_advancement_enabled: true },
    ...overrides,
  } as unknown as GameState;
}

describe('EraTimelineStrip', () => {
  it('renders one node per spine step', () => {
    render(<EraTimelineStrip gameState={state([player('me', 0)])} myPlayer={player('me', 0)} />);
    expect(screen.getByTestId('era-timeline')).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      expect(screen.getByTestId(`era-timeline-step-${i}`)).toBeInTheDocument();
    }
    expect(screen.getByText('Ancient')).toBeInTheDocument();
    expect(screen.getByText('Modern')).toBeInTheDocument();
  });

  it('places each player\'s marker under their current era step', () => {
    const me = player('me', 2);
    const rival = player('rival', 5);
    const trailer = player('trailer', 0);
    render(<EraTimelineStrip gameState={state([me, rival, trailer])} myPlayer={me} />);

    const step0 = screen.getByTestId('era-timeline-step-0');
    const step2 = screen.getByTestId('era-timeline-step-2');
    const step5 = screen.getByTestId('era-timeline-step-5');
    expect(step0).toContainElement(screen.getByTestId('era-timeline-marker-trailer'));
    expect(step2).toContainElement(screen.getByTestId('era-timeline-marker-me'));
    expect(step5).toContainElement(screen.getByTestId('era-timeline-marker-rival'));
  });

  it('clamps an over-max era index to the final step', () => {
    const me = player('me', 99);
    render(<EraTimelineStrip gameState={state([me])} myPlayer={me} />);
    expect(screen.getByTestId('era-timeline-step-5')).toContainElement(screen.getByTestId('era-timeline-marker-me'));
  });

  it('omits eliminated players', () => {
    const me = player('me', 0);
    const dead = player('dead', 3, { is_eliminated: true });
    render(<EraTimelineStrip gameState={state([me, dead])} myPlayer={me} />);
    expect(screen.queryByTestId('era-timeline-marker-dead')).toBeNull();
  });

  it('renders nothing when era advancement is off or the spine is trivial', () => {
    const { container: off } = render(
      <EraTimelineStrip gameState={state([player('me', 0)], { settings: { era_advancement_enabled: false } } as Partial<GameState>)} myPlayer={player('me', 0)} />,
    );
    expect(off.querySelector('[data-testid="era-timeline"]')).toBeNull();

    const { container: tiny } = render(
      <EraTimelineStrip gameState={state([player('me', 0)], { era_spine: [{ era_id: 'ancient' }] } as Partial<GameState>)} myPlayer={player('me', 0)} />,
    );
    expect(tiny.querySelector('[data-testid="era-timeline"]')).toBeNull();
  });
});
