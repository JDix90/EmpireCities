import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpaceProgramTracker from './SpaceProgramTracker';
import type { FrontendMapData } from '../../utils/orbitAccess';
import type { GameState } from '../../store/gameStore';

/**
 * The Moon gate used to be visible only as a banner on a selected Moon tile,
 * and the socket error handler clears the selection before toasting the
 * rejection — so the one surface naming the requirements disappeared exactly
 * when the player needed it. This tracker is the always-on replacement.
 */

const mapData = {
  map_id: 'era_space_age',
  territories: [
    { territory_id: 'na_launch_base', name: 'Cape Canaveral Hub', region_id: 'north_america_2100' },
    { territory_id: 'la_pampas', name: 'Pampas Republic', region_id: 'latin_america_2100' },
    { territory_id: 'moon_near_side_north', name: 'Mare Frigoris', region_id: 'lunar_surface', globe_id: 'moon' },
  ],
  connections: [
    { from: 'la_pampas', to: 'na_launch_base', type: 'land' as const },
    { from: 'na_launch_base', to: 'moon_near_side_north', type: 'orbit' as const },
  ],
} satisfies FrontendMapData;

function state(player: Record<string, unknown>, territories: Record<string, unknown> = {}): GameState {
  return {
    era: 'space_age',
    players: [{ player_id: 'p1', ...player }],
    territories: {
      la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: [] },
      ...territories,
    },
  } as unknown as GameState;
}

describe('SpaceProgramTracker', () => {
  it('renders nothing outside the Space Age', () => {
    const modern = { ...state({}), era: 'modern' } as GameState;
    const { container } = render(
      <SpaceProgramTracker gameState={modern} mapData={mapData} playerId="p1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists all five rungs undone at the start of a game', () => {
    render(<SpaceProgramTracker gameState={state({ unlocked_techs: [] })} mapData={mapData} playerId="p1" />);
    expect(screen.getByTestId('space-program-tracker')).toBeInTheDocument();
    expect(screen.getByText('0/5')).toBeInTheDocument();
    expect(screen.getByText('Research Spaceport Infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Build a Launch Pad')).toBeInTheDocument();
    expect(screen.getByText('Research Lunar Expansion')).toBeInTheDocument();
    // The three-spaceport rule was invisible everywhere before this.
    expect(screen.getByText(/Cape Canaveral, Kourou and Gobi/)).toBeInTheDocument();
  });

  it('counts progress and names the lane a built pad opened', () => {
    const s = state(
      { unlocked_techs: ['sa_launch_pad_tech'] },
      { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['launch_pad'] } },
    );
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(screen.getByText('Pampas Republic → Mare Frigoris')).toBeInTheDocument();
  });

  it('says how to launch once the station tech and a pad are in hand', () => {
    const s = state(
      { unlocked_techs: ['sa_launch_pad_tech', 'sa_space_station'] },
      { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['launch_pad'] } },
    );
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText(/use the Launch Space Station button during draft or fortify/)).toBeInTheDocument();
  });

  it('says a pad is needed first when the station tech is in but no pad is built', () => {
    const s = state({ unlocked_techs: ['sa_launch_pad_tech', 'sa_space_station'] });
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText('Needs a Launch Pad first')).toBeInTheDocument();
  });

  it('collapses to a single line once access is unlocked', () => {
    const s = state(
      { unlocked_techs: ['sa_lunar_expansion'], space_station_launched: true },
      { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['launch_pad'] } },
    );
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.queryByTestId('space-program-tracker')).not.toBeInTheDocument();
    expect(screen.getByText(/Moon access unlocked/)).toBeInTheDocument();
  });

  it('tells a stranded player what they can still do', () => {
    // Launched and researched, but the pad territory was captured.
    const s = state({ unlocked_techs: ['sa_lunar_expansion'], space_station_launched: true });
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText(/You keep your Moon territories/)).toBeInTheDocument();
  });

  it('tells an Elevator builder with no pad that the wonder did not replace it', () => {
    // A mobile tester built the Space Elevator, read its old description as
    // "grants Moon access", and was still locked out. The wonder replaces the
    // Space Station LAUNCH, not the Launch Pad — and the stranded banner used
    // to say the pad was "gone", which is wrong for someone who never had one.
    const s = state(
      { unlocked_techs: ['sa_lunar_expansion'] },
      { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['wonder_space_elevator'] } },
    );
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText(/you still need a pad/)).toBeInTheDocument();
    expect(screen.queryByText(/Launch Pad is gone/)).not.toBeInTheDocument();
    // And the ladder still names the missing rung.
    expect(screen.getByText('Build a Launch Pad')).toBeInTheDocument();
  });

  it('still says the pad is gone for someone who launched and then lost it', () => {
    const s = state({ unlocked_techs: ['sa_lunar_expansion'], space_station_launched: true });
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText(/Launch Pad is gone/)).toBeInTheDocument();
  });

  it('unlocks with the Elevator once a pad is up, without any launch', () => {
    const s = state(
      { unlocked_techs: ['sa_lunar_expansion'] },
      { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['wonder_space_elevator', 'launch_pad'] } },
    );
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.getByText(/Moon access unlocked/)).toBeInTheDocument();
  });

  it('gives Lunar Pioneers their own line rather than a ladder', () => {
    const s = state({ faction_id: 'lunar_pioneers', space_station_launched: true });
    render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
    expect(screen.queryByTestId('space-program-tracker')).not.toBeInTheDocument();
    expect(screen.getByText(/your colonists never left/)).toBeInTheDocument();
  });

  describe('once a rival has landed', () => {
    // The contest rule: in a game the Lunar Hegemony can win, a rival on the
    // Moon drops everyone else's requirement to the first two rungs.
    const contested = (player: Record<string, unknown>, territories: Record<string, unknown> = {}) => ({
      ...state(
        { ...player },
        {
          moon_near_side_north: { territory_id: 'moon_near_side_north', owner_id: 'p2', unit_count: 2, buildings: [] },
          ...territories,
        },
      ),
      players: [{ player_id: 'p1', ...player }, { player_id: 'p2' }],
      settings: {
        space_age_moon_hegemony_enabled: true,
        allowed_victory_conditions: ['domination', 'lunar_hegemony'],
      },
    }) as unknown as GameState;

    it('says why the checklist got shorter', () => {
      render(
        <SpaceProgramTracker gameState={contested({ unlocked_techs: [] })} mapData={mapData} playerId="p1" />,
      );
      expect(screen.getByTestId('space-program-contested')).toHaveTextContent(/A rival has landed/);
      expect(screen.getByText('0/2')).toBeInTheDocument();
      expect(screen.queryByText('Research Lunar Expansion')).not.toBeInTheDocument();
    });

    it('opens on the tech and a pad alone', () => {
      const s = contested(
        { unlocked_techs: ['sa_launch_pad_tech'] },
        { la_pampas: { territory_id: 'la_pampas', owner_id: 'p1', unit_count: 3, buildings: ['launch_pad'] } },
      );
      render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
      expect(screen.queryByTestId('space-program-tracker')).not.toBeInTheDocument();
      expect(screen.getByText(/The Moon is contested and your Launch Pad is enough/)).toBeInTheDocument();
    });

    it('keeps the full ladder in a game the Hegemony cannot win', () => {
      const s = contested({ unlocked_techs: [] });
      s.settings = { ...s.settings, allowed_victory_conditions: ['domination'] };
      render(<SpaceProgramTracker gameState={s} mapData={mapData} playerId="p1" />);
      expect(screen.queryByTestId('space-program-contested')).not.toBeInTheDocument();
      expect(screen.getByText('0/5')).toBeInTheDocument();
    });
  });
});
