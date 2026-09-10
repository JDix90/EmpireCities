import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import {
  describeLaneDice,
  describeLaneSeal,
  describeLaneState,
  describeWorldModifiers,
  describeWorldRules,
  gatewayLanesFor,
  gatewayTerritoryIds,
  isLaneSealedForPlayer,
  laneAttackDiceCap,
  laneSealFor,
  laneStateFor,
  laneSovereigntyProgress,
  laneTouchesSealWorld,
  orbitLaneId,
  prettyRegionId,
  vaultViews,
  viewerHoldsVaultSeal,
  worldDisplayName,
} from './galaxyLanes';

const mapData = {
  map_kind: 'galaxy' as const,
  worlds: [
    { world_id: 'sol', display_name: 'Sol III' },
    { world_id: 'verdan', display_name: 'Verdan Reach' },
    { world_id: 'nexus_station', display_name: 'Nexus Station' },
  ],
  territories: [
    { territory_id: 'sol_a', name: 'Columbia Reach', region_id: 'r', world_id: 'sol' },
    { territory_id: 'sol_b', name: 'Cathay', region_id: 'r', world_id: 'sol' },
    { territory_id: 'verdan_a', name: 'Sporefields', region_id: 'r', world_id: 'verdan' },
    { territory_id: 'nexus_a', name: 'Gate Ring', region_id: 'r', world_id: 'nexus_station' },
  ],
  connections: [
    { from: 'sol_a', to: 'verdan_a', type: 'orbit' as const },
    { from: 'sol_b', to: 'nexus_a', type: 'orbit' as const },
    { from: 'sol_a', to: 'sol_b', type: 'land' as const },
  ],
};

function mkState(opts: {
  owners?: Record<string, string>;
  seals?: GameState['lane_blockades'];
  corridors?: boolean;
  techs?: string[];
  anchor?: boolean;
} = {}): GameState {
  const owners = opts.owners ?? { sol_a: 'me', sol_b: 'me', verdan_a: 'rival', nexus_a: 'rival' };
  return {
    settings: { galaxy_corridors_enabled: opts.corridors ?? true, tech_trees_enabled: true },
    players: [
      { player_id: 'me', username: 'Commander', unlocked_techs: opts.techs ?? [] },
      { player_id: 'rival', username: 'Rival', unlocked_techs: [] },
    ],
    lane_blockades: opts.seals,
    territories: Object.fromEntries(
      Object.entries(owners).map(([id, owner]) => [
        id,
        { owner_id: owner, buildings: opts.anchor && id === 'sol_a' ? ['wonder_hyperlane_anchor'] : [] },
      ]),
    ),
  } as unknown as GameState;
}

describe('galaxyLanes', () => {
  it('lane ids are order-independent and match the backend shape', () => {
    expect(orbitLaneId('b', 'a')).toBe('a::b');
    expect(orbitLaneId('a', 'b')).toBe(orbitLaneId('b', 'a'));
  });

  it('reads corridor / open / closed from the two gateways', () => {
    const state = mkState({ owners: { sol_a: 'me', verdan_a: 'me', sol_b: 'me', nexus_a: 'rival' } });
    expect(laneStateFor(state, 'sol_a', 'verdan_a', 'me')).toBe('corridor');
    expect(laneStateFor(state, 'sol_a', 'verdan_a', 'rival')).toBe('closed');
    expect(laneStateFor(state, 'sol_b', 'nexus_a', 'me')).toBe('open');
    expect(laneStateFor(state, 'sol_b', 'nexus_a', 'rival')).toBe('open');
    expect(laneStateFor(state, 'sol_b', 'nexus_a', null)).toBe('closed');
  });

  it('reports an active seal, and lets the sealer cross their own', () => {
    const seals = { [orbitLaneId('sol_b', 'nexus_a')]: { owner_id: 'rival', turns_remaining: 1 } };
    const state = mkState({ seals });
    expect(laneSealFor(state, 'nexus_a', 'sol_b')).toEqual({ owner_id: 'rival', turns_remaining: 1 });
    expect(isLaneSealedForPlayer(state, 'sol_b', 'nexus_a', 'me')).toBe(true);
    expect(isLaneSealedForPlayer(state, 'sol_b', 'nexus_a', 'rival')).toBe(false);
    const expired = mkState({ seals: { [orbitLaneId('sol_b', 'nexus_a')]: { owner_id: 'rival', turns_remaining: 0 } } });
    expect(laneSealFor(expired, 'sol_b', 'nexus_a')).toBeNull();
  });

  it('caps lane attacks at 2 dice, 3 with Lane Charts, uncapped for the Anchor owner or with corridors off', () => {
    expect(laneAttackDiceCap(mkState(), 'me')).toBe(2);
    expect(laneAttackDiceCap(mkState({ techs: ['ga_hyperspace_chart'] }), 'me')).toBe(3);
    expect(laneAttackDiceCap(mkState({ anchor: true }), 'me')).toBeUndefined();
    expect(laneAttackDiceCap(mkState({ corridors: false }), 'me')).toBeUndefined();
  });

  it('lists the lanes leaving a gateway with the far world named', () => {
    expect(gatewayLanesFor(mapData, 'sol_a')).toEqual([
      {
        nearId: 'sol_a', farId: 'verdan_a', farName: 'Sporefields',
        farWorldId: 'verdan', farWorldName: 'Verdan Reach', kind: 'authored',
      },
    ]);
    // Engine-added lanes are listed too, labelled for what they are.
    const withGate = {
      ...mapData,
      connections: [...mapData.connections, { from: 'sol_a', to: 'nexus_a', type: 'orbit' as const, source: 'jump_gate' }],
    };
    expect(gatewayLanesFor(withGate, 'sol_a').map((l) => l.kind)).toEqual(['authored', 'jump_gate']);
    expect(gatewayLanesFor(mapData, 'verdan_a')[0].farWorldName).toBe('Sol III');
    expect(gatewayLanesFor(mapData, 'nope')).toEqual([]);
    expect([...gatewayTerritoryIds(mapData)].sort()).toEqual(['nexus_a', 'sol_a', 'sol_b', 'verdan_a']);
  });

  it('falls back to lore names for worlds the map does not label', () => {
    expect(worldDisplayName({ ...mapData, worlds: undefined }, 'rust')).toBe('Rust Belt');
    expect(worldDisplayName(mapData, 'unknown')).toBe('unknown');
  });

  it('knows which lanes the Emergency Seal can close', () => {
    expect(laneTouchesSealWorld(mapData, 'sol_b', 'nexus_a')).toBe(true);
    expect(laneTouchesSealWorld(mapData, 'sol_a', 'verdan_a')).toBe(false);
  });

  it('describes states, seals, dice and world modifiers in plain words', () => {
    expect(describeLaneState('corridor')).toMatch(/both gateways/);
    expect(describeLaneState('open')).toMatch(/this end/);
    expect(describeLaneState('closed')).toMatch(/neither/);
    const name = (id: string) => (id === 'rival' ? 'Rival' : id);
    expect(describeLaneSeal({ owner_id: 'rival', turns_remaining: 1 }, name, 'me')).toBe('Sealed by Rival · 1 round left');
    expect(describeLaneSeal({ owner_id: 'me', turns_remaining: 2 }, name, 'me')).toBe('Sealed by you · 2 rounds left');
    expect(describeLaneSeal(null, name, 'me')).toBeNull();
    expect(describeLaneDice(2)).toBe('Lane attacks roll 2 dice (3 with Lane Charts)');
    expect(describeLaneDice(3)).toBe('Lane attacks roll 3 dice');
    expect(describeLaneDice(undefined)).toBeNull();
    expect(describeWorldModifiers({ production_bonus: 0.3, stability_bonus: 1 })).toEqual([
      '+0.3 production per system you hold',
      '+1 stability recovery per system you hold',
    ]);
    expect(describeWorldModifiers({ tech_bonus: 0.0625, build_cost_mult: 0.8 })).toEqual([
      '+0.063 tech per system you hold',
      'Buildings cost 20% less',
    ]);
    expect(describeWorldModifiers(undefined)).toEqual([]);
  });

  it('describes world rules in plain words', () => {
    expect(describeWorldRules({ deploy_cap_bonus: 2, population_growth_mult: 2 })).toEqual([
      'Cradle: place up to 2 more units per system each draft, even at low stability',
      'Population grows 2× as fast',
    ]);
    expect(describeWorldRules({ storm_threshold: 12 })).toEqual([
      'Storms: at round start any system above 12 units loses 1 to the weather',
    ]);
    expect(describeWorldRules({ defense_building_bonus_dice: 1 })).toEqual([
      'Forge: a system with a defence building rolls +1 extra defence die',
    ]);
    expect(describeWorldRules({ vault: { region_id: 'nexus_gate_ring', neutral_garrison: 6, tech_income: 2, emergency_seal: true } })).toEqual([
      'The Vault: Nexus Gate Ring starts neutral (garrison 6); hold all of it for +2 tech per turn and one Emergency Seal per turn on any lane',
    ]);
    // The home-unit compensation is off the shipped map but still described.
    expect(describeWorldRules({ vault: { region_id: 'r', neutral_garrison: 6, tech_income: 1, home_unit_bonus: 1 } })).toHaveLength(2);
    expect(describeWorldRules(undefined)).toEqual([]);
    expect(prettyRegionId('nexus_gate_ring')).toBe('Nexus Gate Ring');
  });

  it('reads the Vault holder from the map regions and the territory owners', () => {
    const territories = [
      { territory_id: 'ring_a', region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
      { territory_id: 'ring_b', region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
      { territory_id: 'nexus_x', region_id: 'nexus_vault_ward', world_id: 'nexus_station' },
    ];
    const rules = { nexus_station: { vault: { region_id: 'nexus_gate_ring', neutral_garrison: 6, tech_income: 2, emergency_seal: true } } };
    const unheld = {
      settings: { world_rules: rules },
      territories: { ring_a: { owner_id: 'me' }, ring_b: { owner_id: null }, nexus_x: { owner_id: 'rival' } },
    } as unknown as GameState;
    expect(vaultViews(unheld, territories, 'me')).toEqual([
      { world_id: 'nexus_station', region_id: 'nexus_gate_ring', holder_id: null, tiles: 2, viewer_held: 1, tech_income: 2, emergency_seal: true },
    ]);
    expect(viewerHoldsVaultSeal(unheld, territories, 'me')).toBe(false);
    const held = { ...unheld, territories: { ...unheld.territories, ring_b: { owner_id: 'me' } } } as unknown as GameState;
    expect(vaultViews(held, territories, 'me')[0].holder_id).toBe('me');
    expect(viewerHoldsVaultSeal(held, territories, 'me')).toBe(true);
    expect(viewerHoldsVaultSeal(held, territories, 'rival')).toBe(false);
    expect(vaultViews({ settings: {}, territories: {} } as unknown as GameState, territories)).toEqual([]);
  });

  it('tracks Lane Sovereignty from the authored lanes and the server streak', () => {
    const connections = [
      { from: 'a1', to: 'b1', type: 'orbit' },
      { from: 'a2', to: 'b2', type: 'orbit' },
      { from: 'a3', to: 'b3', type: 'orbit' },
      // Engine-added: a player joining two tiles they already hold must not count.
      { from: 'a4', to: 'b4', type: 'orbit', source: 'jump_gate' },
      { from: 'a1', to: 'a2', type: 'land' },
    ];
    const mk = (owners: Record<string, string | null>, allowed: string[], streak = 0) => ({
      settings: { allowed_victory_conditions: allowed },
      players: [{ player_id: 'me', lane_sovereignty_streak: streak }],
      territories: Object.fromEntries(Object.entries(owners).map(([k, v]) => [k, { owner_id: v }])),
    }) as unknown as GameState;

    const mine = { a1: 'me', b1: 'me', a2: 'me', b2: 'rival', a3: 'me', b3: 'me', a4: 'me', b4: 'me' };
    const on = laneSovereigntyProgress(mk(mine, ['domination', 'lane_sovereignty'], 2), connections, 'me');
    // Two authored corridors; the gate lane is ignored even though both ends are held.
    expect(on).toEqual({ applicable: true, held: 2, needed: 3, streak: 2, roundsNeeded: 3 });

    const off = laneSovereigntyProgress(mk(mine, ['domination'], 2), connections, 'me');
    expect(off.applicable).toBe(false);
    expect(off.held).toBe(0);
    expect(laneSovereigntyProgress(null, connections, 'me').applicable).toBe(false);
    expect(laneSovereigntyProgress(mk(mine, ['lane_sovereignty']), [], 'me').applicable).toBe(false);
  });
});
