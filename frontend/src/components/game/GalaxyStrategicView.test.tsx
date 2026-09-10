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
    { territory_id: 'nexus_a', name: 'Nexus A', region_id: 'nexus_r', world_id: 'nexus_station', galaxy_position: [0.2, 0.8] },
  ],
  connections: [
    // Two physical lanes on the sol–verdan hop, one each on sol–rust and rust–nexus.
    { from: 'sol_a', to: 'verdan_a', type: 'orbit' },
    { from: 'sol_b', to: 'verdan_b', type: 'orbit' },
    { from: 'sol_b', to: 'rust_a', type: 'orbit' },
    { from: 'rust_b', to: 'nexus_a', type: 'orbit' },
    { from: 'sol_a', to: 'sol_b', type: 'land' },
  ],
  worlds: [
    { world_id: 'sol', display_name: 'Sol III' },
    { world_id: 'verdan', display_name: 'Verdan Reach' },
    { world_id: 'rust', display_name: 'Rust Belt' },
    { world_id: 'nexus_station', display_name: 'Nexus Station' },
  ],
};

function mkGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    settings: { galaxy_corridors_enabled: true, tech_trees_enabled: true },
    players: [
      { player_id: 'me', username: 'Commander', color: '#e24b4a', is_eliminated: false, unlocked_techs: [] },
      { player_id: 'rival', username: 'Rival', color: '#4a90e2', is_eliminated: false, unlocked_techs: [] },
    ],
    territories: {
      sol_a: { owner_id: 'me' },
      sol_b: { owner_id: 'me' },
      verdan_a: { owner_id: 'rival' },
      verdan_b: { owner_id: 'rival' },
      rust_a: { owner_id: 'me' },
      rust_b: { owner_id: 'me' },
      nexus_a: { owner_id: 'rival' },
    },
    ...overrides,
  } as unknown as GameState;
}

const gameState = mkGameState();

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
      viewerPlayerId="me"
      ownsTerritory={(id) => gameState.territories[id]?.owner_id === 'me'}
      {...overrides}
    />,
  );
  return { ...utils, onTerritoryClick, onTerritoryDoubleClick };
}

function laneGroups(container: HTMLElement) {
  return [...container.querySelectorAll('g.bf-lane')] as SVGGElement[];
}

describe('GalaxyStrategicView', () => {
  it('renders one node per world (not per territory), with world labels', () => {
    const { container } = renderView();
    expect(container.querySelectorAll('.bf-world-node')).toHaveLength(4);
    expect(screen.getByText('Sol III')).toBeTruthy();
    expect(screen.getByText('Verdan Reach')).toBeTruthy();
    expect(screen.getByText('Rust Belt')).toBeTruthy();
    // System counts, not 7 territory nodes.
    expect(screen.getAllByText('2 systems')).toHaveLength(3);
  });

  it('draws ownership donut arcs and one line per PHYSICAL hyperspace lane', () => {
    const { container } = renderView();
    // donut segments use stroke-dasharray; at least one per owned world.
    const dashed = [...container.querySelectorAll('circle')].filter((c) =>
      c.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
    // Four orbit connections → four lanes (the sol–verdan hop keeps both of its lanes).
    expect(laneGroups(container)).toHaveLength(4);
    const visible = [...container.querySelectorAll('line')].filter(
      (l) => l.getAttribute('stroke') !== 'transparent',
    );
    expect(visible).toHaveLength(4);
  });

  it('colours each lane by what it is to the viewer: corridor, open, closed', () => {
    const { container } = renderView();
    const byId = Object.fromEntries(laneGroups(container).map((g) => [g.dataset.laneId, g]));
    // sol_b–rust_a: I hold both ends → corridor, drawn in my colour.
    expect(byId['rust_a::sol_b'].dataset.laneState).toBe('corridor');
    expect(byId['rust_a::sol_b'].querySelector('line.bf-lane-line')!.getAttribute('stroke')).toBe('#e24b4a');
    // sol_a–verdan_a: I hold sol_a only → open.
    expect(byId['sol_a::verdan_a'].dataset.laneState).toBe('open');
    // rust_b–nexus_a: rust_b is mine → open; a lane I hold neither end of is closed.
    expect(byId['nexus_a::rust_b'].dataset.laneState).toBe('open');
    const rivalView = renderView({ viewerPlayerId: 'rival', ownsTerritory: () => false });
    const rivalLanes = Object.fromEntries(laneGroups(rivalView.container).map((g) => [g.dataset.laneId, g]));
    expect(rivalLanes['rust_a::sol_b'].dataset.laneState).toBe('closed');
  });

  it('marks a sealed lane and names the sealer and rounds left in its tooltip', () => {
    const sealed = mkGameState({
      lane_blockades: { 'nexus_a::rust_b': { owner_id: 'rival', turns_remaining: 1 } },
    });
    const { container } = renderView({ gameState: sealed });
    const lane = laneGroups(container).find((g) => g.dataset.laneId === 'nexus_a::rust_b')!;
    expect(lane.dataset.laneSealed).toBe('true');
    expect(lane.querySelector('title')!.textContent).toContain('Sealed by Rival · 1 round left');
    // The lane copy names the dice an assault across it rolls.
    expect(lane.querySelector('title')!.textContent).toContain('roll 2 dice');
  });

  it('shows a lane legend for the viewer', () => {
    renderView();
    expect(screen.getByTestId('lane-legend').textContent).toMatch(/Corridor.*Open.*Closed.*Sealed/s);
  });

  it('shows the viewer as "You" in the control legend', () => {
    renderView();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Rival')).toBeTruthy();
  });

  it('single-click opens the world detail card with an ownership breakdown and gateway count', () => {
    const { onTerritoryClick } = renderView();
    const group = screen.getByText('Sol III').closest('.bf-world-node')!;
    fireEvent.click(group);
    // representative drill-in territory is the first sorted id of that world.
    expect(onTerritoryClick).toHaveBeenCalledWith('sol_a');
    expect(screen.getByRole('button', { name: /Enter world/i })).toBeTruthy();
    expect(screen.getByTestId('world-gateways').textContent).toContain('you hold 2 of 2');
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

  it('lets a Custodian seal only lanes touching Nexus Station', () => {
    const onSealLane = vi.fn();
    const { container } = renderView({ lanesContestableEnabled: true, onSealLane });
    const hit = (laneId: string) =>
      laneGroups(container).find((g) => g.dataset.laneId === laneId)!.querySelector('line[stroke="transparent"]')!;
    fireEvent.click(hit('sol_a::verdan_a'));
    expect(onSealLane).not.toHaveBeenCalled();
    fireEvent.click(hit('nexus_a::rust_b'));
    expect(onSealLane).toHaveBeenCalledTimes(1);
    const [a, b] = onSealLane.mock.calls[0] as [string, string];
    expect([a, b].sort()).toEqual(['nexus_a', 'rust_b']);
    expect(screen.getByText(/click a lane touching Nexus Station/i)).toBeTruthy();
  });

  it('surfaces the orbit-lock hint when the corridors kill switch gates access', () => {
    renderView({ orbitAccessAllowed: false });
    expect(screen.getByText(/need Lane Charts/i)).toBeTruthy();
  });

  it('draws engine-built lanes as their own kind, and never offers one to seal', () => {
    const withGate: GalaxyMapDatum = {
      ...mapData,
      connections: [
        ...mapData.connections,
        // A Jump Gate lane between two Sol/Rust tiles the viewer holds, and a
        // surge lane. Neither is the authored ring.
        { from: 'sol_a', to: 'rust_b', type: 'orbit', source: 'jump_gate' },
        { from: 'sol_b', to: 'nexus_a', type: 'orbit', source: 'lane_surge' },
      ],
    };
    const onSealLane = vi.fn();
    const { container } = renderView({
      mapData: withGate,
      lanesContestableEnabled: true,
      sealAnyLane: true,
      onSealLane,
    });
    const byId = Object.fromEntries(laneGroups(container).map((g) => [g.dataset.laneId, g]));
    expect(byId['rust_b::sol_a'].dataset.laneKind).toBe('jump_gate');
    expect(byId['nexus_a::sol_b'].dataset.laneKind).toBe('lane_surge');
    expect(byId['sol_a::verdan_a'].dataset.laneKind).toBe('authored');
    expect(byId['rust_b::sol_a'].querySelector('title')!.textContent).toContain('no attacks');
    expect(byId['nexus_a::sol_b'].querySelector('title')!.textContent).toContain('blows over');

    // The Vault holder may seal any AUTHORED lane, but not an engine-built one.
    const hit = (laneId: string) =>
      byId[laneId].querySelector('line[stroke="transparent"]')!;
    fireEvent.click(hit('rust_b::sol_a'));
    fireEvent.click(hit('nexus_a::sol_b'));
    expect(onSealLane).not.toHaveBeenCalled();
    fireEvent.click(hit('sol_a::verdan_a'));
    expect(onSealLane).toHaveBeenCalledTimes(1);
  });
});
