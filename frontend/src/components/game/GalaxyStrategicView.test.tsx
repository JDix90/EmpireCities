import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GalaxyStrategicView, { type GalaxyMapDatum } from './GalaxyStrategicView';
import type { GameState } from '../../store/gameStore';

const mapData: GalaxyMapDatum = {
  map_kind: 'galaxy',
  territories: [
    { territory_id: 'sol_a', name: 'Sol A', region_id: 'sol_r', world_id: 'sol', galaxy_position: [0.2, 0.3] },
    { territory_id: 'sol_b', name: 'Sol B', region_id: 'sol_r', world_id: 'sol', galaxy_position: [0.3, 0.4] },
    { territory_id: 'verdan_a', name: 'Verdan A', region_id: 'verdan_r', world_id: 'verdan', galaxy_position: [0.8, 0.2] },
    { territory_id: 'verdan_b', name: 'Verdan B', region_id: 'verdan_r', world_id: 'verdan', galaxy_position: [0.85, 0.35] },
    { territory_id: 'rust_a', name: 'Rust A', region_id: 'rust_r', world_id: 'rust', galaxy_position: [0.5, 0.8] },
    { territory_id: 'rust_b', name: 'Rust B', region_id: 'rust_r', world_id: 'rust', galaxy_position: [0.55, 0.85] },
  ],
  connections: [
    { from: 'sol_a', to: 'verdan_a', type: 'orbit' },
    { from: 'sol_b', to: 'rust_a', type: 'orbit' },
    { from: 'sol_a', to: 'sol_b', type: 'land' },
  ],
  worlds: [
    { world_id: 'sol', display_name: 'Sol III' },
    { world_id: 'verdan', display_name: 'Verdan Reach' },
    { world_id: 'rust', display_name: 'Rust Belt' },
  ],
};

const gameState = {
  players: [
    { player_id: 'me', username: 'Commander', color: '#e24b4a', is_eliminated: false },
    { player_id: 'rival', username: 'Rival', color: '#4a90e2', is_eliminated: false },
  ],
  territories: {
    sol_a: { owner_id: 'me' },
    sol_b: { owner_id: 'rival' },
    verdan_a: { owner_id: 'rival' },
    verdan_b: { owner_id: 'rival' },
    rust_a: { owner_id: 'me' },
    rust_b: { owner_id: 'me' },
  },
} as unknown as GameState;

function renderView(overrides: Partial<React.ComponentProps<typeof GalaxyStrategicView>> = {}) {
  const onTerritoryClick = vi.fn();
  const onTerritoryDoubleClick = vi.fn();
  const utils = render(
    <GalaxyStrategicView
      mapData={mapData}
      gameState={gameState}
      selectedTerritoryId={null}
      onTerritoryClick={onTerritoryClick}
      onTerritoryDoubleClick={onTerritoryDoubleClick}
      width={800}
      height={600}
      ownsTerritory={(id) => gameState.territories[id]?.owner_id === 'me'}
      {...overrides}
    />,
  );
  return { ...utils, onTerritoryClick, onTerritoryDoubleClick };
}

describe('GalaxyStrategicView', () => {
  it('renders one node per world (not per territory), with world labels', () => {
    const { container } = renderView();
    expect(container.querySelectorAll('.bf-world-node')).toHaveLength(3);
    expect(screen.getByText('Sol III')).toBeTruthy();
    expect(screen.getByText('Verdan Reach')).toBeTruthy();
    expect(screen.getByText('Rust Belt')).toBeTruthy();
    // System counts, not 6 territory nodes.
    expect(screen.getAllByText('2 systems')).toHaveLength(3);
  });

  it('draws ownership donut arcs and aggregated hyperspace lanes', () => {
    const { container } = renderView();
    // donut segments use stroke-dasharray; at least one per owned world.
    const dashed = [...container.querySelectorAll('circle')].filter((c) =>
      c.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
    // two orbit connections collapse to two world-pair lanes (sol-verdan, sol-rust).
    const lanes = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke') !== 'transparent',
    );
    expect(lanes.length).toBe(2);
  });

  it('shows the viewer as "You" in the control legend', () => {
    renderView();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Rival')).toBeTruthy();
  });

  it('single-click opens the world detail card with an ownership breakdown', () => {
    const { onTerritoryClick } = renderView();
    const group = screen.getByText('Sol III').closest('.bf-world-node')!;
    fireEvent.click(group);
    // representative drill-in territory is the first sorted id of that world.
    expect(onTerritoryClick).toHaveBeenCalledWith('sol_a');
    expect(screen.getByRole('button', { name: /Enter world/i })).toBeTruthy();
  });

  it('"Enter world" drills into that world (double-click path)', () => {
    const { onTerritoryDoubleClick } = renderView();
    const group = screen.getByText('Verdan Reach').closest('.bf-world-node')!;
    fireEvent.click(group);
    fireEvent.click(screen.getByRole('button', { name: /Enter world/i }));
    expect(onTerritoryDoubleClick).toHaveBeenCalledWith('verdan_a');
  });

  it('double-clicking a world node drills in directly', () => {
    const { onTerritoryDoubleClick } = renderView();
    const group = screen.getByText('Rust Belt').closest('.bf-world-node')!;
    fireEvent.click(group, { detail: 2 });
    expect(onTerritoryDoubleClick).toHaveBeenCalledWith('rust_a');
  });

  it('surfaces the orbit-lock hint when orbit access is gated', () => {
    renderView({ orbitAccessAllowed: false });
    expect(screen.getByText(/need Hyperspace Chart/i)).toBeTruthy();
  });
});
