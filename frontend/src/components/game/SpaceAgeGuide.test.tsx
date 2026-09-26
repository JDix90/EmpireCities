import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpaceAgeGuideModal from './SpaceAgeGuide';
import type { GameState } from '../../store/gameStore';

const spaceAge = {
  era: 'space_age',
  players: [{ player_id: 'me' }],
  settings: {
    economy_enabled: true,
    allowed_victory_conditions: ['domination', 'lunar_hegemony'],
    space_age_moon_helium3_enabled: true,
    space_age_moon_hegemony_enabled: true,
  },
} as unknown as GameState;

describe('SpaceAgeGuideModal', () => {
  it('opens the guide written from this game, and closes on Got it', () => {
    const onClose = vi.fn();
    render(<SpaceAgeGuideModal open onClose={onClose} gameState={spaceAge} viewerPlayerId="me" moonTiles={9} />);
    expect(screen.getByText('How the Space Age works')).toBeInTheDocument();
    expect(screen.getByTestId('space-age-guide-helium3')).toBeInTheDocument();
    expect(screen.getByTestId('space-age-guide-hegemony')).toHaveTextContent(/7 of your own turns/);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing on a board without a Moon', () => {
    const { container } = render(
      <SpaceAgeGuideModal open onClose={() => {}} gameState={spaceAge} viewerPlayerId="me" moonTiles={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
