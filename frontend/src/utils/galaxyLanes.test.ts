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
  convoysFor,
  describeColonies,
  describeColonyKitChanges,
  describeSchism,
  factionReinforceBonus,
  holdsLaneCrown,
  schismHouseOf,
  schismRivalOf,
  schismWholeWorldOf,
  describeConvoy,
  describeLaneKind,
  laneKindOf,
  laneSovereigntyProgress,
  laneSovereigntyRoundsFor,
  laneSovereigntyRoundsForGame,
  LANE_SOVEREIGNTY_ROUNDS_BY_SIDES,
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
    expect(describeWorldRules({ muster_threshold: 2, muster_every: 5 })).toEqual([
      'Cradle: every 5th round, any system held here with fewer than 2 units musters 1 more',
    ]);
    expect(describeWorldRules({ muster_threshold: 3, muster_units: 2 })).toEqual([
      'Cradle: every round, any system held here with fewer than 3 units musters 2 more',
    ]);
    expect(describeWorldRules({ muster_threshold: 2, muster_every: 2 })[0]).toContain('every 2nd round');
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

  it('lists convoys only when transit is on, and describes them', () => {
    const transits = [
      { id: 'c1', owner_id: 'me', from: 'a', to: 'b', units: 6, turns_remaining: 1 },
      { id: 'c2', owner_id: 'rival', from: 'b', to: 'c', units: 2, turns_remaining: 2 },
    ];
    const on = { settings: { galaxy_transit_enabled: true }, transits } as unknown as GameState;
    expect(convoysFor(on)).toHaveLength(2);
    expect(convoysFor(on, { ownerId: 'me' })).toHaveLength(1);
    expect(convoysFor(on, { touching: 'b' })).toHaveLength(2);
    expect(convoysFor(on, { ownerId: 'me', touching: 'c' })).toHaveLength(0);
    const off = { settings: {}, transits } as unknown as GameState;
    expect(convoysFor(off)).toHaveLength(0);
    const nameOf = (id: string) => id.toUpperCase();
    expect(describeConvoy(transits[0], nameOf)).toBe('6 units from A arrive next turn');
    expect(describeConvoy(transits[1], nameOf)).toBe('2 units from B arrive in 2 turns');
  });
});

describe('the Colonies board', () => {
  it('reads a colony lane as charted all game, and outside Lane Sovereignty', () => {
    expect(laneKindOf('galaxy_mode')).toBe('colony');
    expect(laneKindOf('surge_projector')).toBe('surge_projector');
    expect(describeLaneKind('surge_projector')).toMatch(/one crossing, this attack phase only/);
    expect(describeLaneKind('colony')).toMatch(/Colony lane — open all game/);
    expect(describeLaneKind('colony')).toMatch(/Sovereignty counts only the eight charted lanes/);
    const withBridge = {
      ...mapData,
      connections: [...mapData.connections, { from: 'verdan_a', to: 'nexus_a', type: 'orbit' as const, source: 'galaxy_mode' }],
    };
    expect(gatewayLanesFor(withBridge, 'verdan_a').find((l) => l.farId === 'nexus_a')?.kind).toBe('colony');
    // …and the HUD's corridor count never includes it.
    const state = {
      settings: { allowed_victory_conditions: ['lane_sovereignty'] },
      players: [{ player_id: 'me' }, { player_id: 'rival' }, { player_id: 'third' }],
      territories: { verdan_a: { owner_id: 'me' }, nexus_a: { owner_id: 'me' } },
    } as unknown as GameState;
    expect(laneSovereigntyProgress(state, withBridge.connections, 'me').held).toBe(0);
  });

  it('asks a two-player streak for five rounds, and three or four players for three', () => {
    const mk = (seats: number) => ({
      settings: { allowed_victory_conditions: ['lane_sovereignty'] },
      players: Array.from({ length: seats }, (_, i) => ({ player_id: i === 0 ? 'me' : `p${i}` })),
      territories: {},
    }) as unknown as GameState;
    expect(laneSovereigntyProgress(mk(2), mapData.connections, 'me').roundsNeeded).toBe(5);
    expect(laneSovereigntyProgress(mk(3), mapData.connections, 'me').roundsNeeded).toBe(3);
    expect(laneSovereigntyProgress(mk(4), mapData.connections, 'me').roundsNeeded).toBe(3);
    expect([2, 3, 4, 8].map(laneSovereigntyRoundsFor)).toEqual([5, 3, 3, 3]);
  });

  it("reads a kit's reinforcement bonus as the Colonies board sets it", () => {
    const navigators = {
      faction_id: 'helion_navigators', name: 'Helion Navigators',
      reinforce_bonus: 2, colony_reinforce_bonus: { '2': 1 },
    };
    const forge = { faction_id: 'forge_syndicate', name: 'Forge Syndicate', reinforce_bonus: 2 };
    const game = (seats: number, colonies: boolean) => ({
      players: Array.from({ length: seats }, (_, i) => ({ faction_id: [navigators, forge, navigators, forge][i]!.faction_id })),
      galaxy_mode: colonies ? { id: 'colonies' as const, neutral_worlds: ['rust'] } : undefined,
    }) as unknown as GameState;
    expect(factionReinforceBonus(game(2, true), navigators)).toBe(1);
    expect(factionReinforceBonus(game(3, true), navigators)).toBe(2);
    expect(factionReinforceBonus(game(2, false), navigators)).toBe(2);
    expect(factionReinforceBonus(game(2, true), forge)).toBe(2);
    expect(describeColonyKitChanges(game(2, true), [navigators, forge])).toEqual([
      'The Helion Navigators draft +1 a turn in this game, not +2.',
    ]);
    expect(describeColonyKitChanges(game(3, true), [navigators, forge])).toEqual([]);
    expect(describeColonyKitChanges(game(2, false), [navigators, forge])).toEqual([]);
  });

  it('names the colonies for the start briefing', () => {
    expect(describeColonies(undefined)).toBeNull();
    expect(describeColonies({ id: 'colonies', neutral_worlds: ['nexus_station', 'verdan'] }, mapData)).toBe(
      'Nexus Station and Verdan Reach start neutral and garrisoned — colonies for whoever takes them.',
    );
    expect(describeColonies({
      id: 'colonies',
      neutral_worlds: ['nexus_station'],
      lanes: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }],
    }, mapData)).toBe(
      'Nexus Station starts neutral and garrisoned — a colony for whoever takes it. Two extra lanes link every world to every other.',
    );
  });
});

describe('the Schism board', () => {
  // Two worlds of an eight-seat board: every world has two houses.
  const houses = [
    { player_id: 'me', world_id: 'sol', half: 0 as const, name: 'Western Mandate' },
    { player_id: 'rival', world_id: 'sol', half: 1 as const, name: 'Eastern Mandate' },
    { player_id: 'far', world_id: 'verdan', half: 0 as const, name: 'Dawnrim Navigators' },
    { player_id: 'farther', world_id: 'verdan', half: 1 as const, name: 'Duskrim Navigators' },
  ];
  const schism = (relations: 'concord' | 'civil_war' | 'allied', owners: Record<string, string> = {}) => ({
    players: [
      { player_id: 'me', username: 'Commander' },
      { player_id: 'rival', username: 'Rival' },
      { player_id: 'far', username: 'Far' },
    ],
    territories: Object.fromEntries(Object.entries(owners).map(([id, owner]) => [id, { owner_id: owner }])),
    galaxy_mode: {
      id: 'schism' as const,
      relations,
      concord_rounds: relations === 'concord' ? 3 : 0,
      lane_crown_bonus: relations === 'allied' ? 0 : 2,
      houses,
      crown_gateways: { sol: ['sol_a', 'sol_b'], verdan: ['verdan_a'] },
    },
  }) as unknown as GameState;

  it("finds a player's house and the rival on their world", () => {
    const state = schism('concord');
    expect(schismHouseOf(state, 'me')?.name).toBe('Western Mandate');
    expect(schismRivalOf(state, 'me')?.player_id).toBe('rival');
    expect(schismRivalOf(state, 'rival')?.player_id).toBe('me');
    expect(schismHouseOf(state, 'nobody')).toBeNull();
    expect(schismHouseOf({ galaxy_mode: { id: 'colonies', neutral_worlds: [] } } as unknown as GameState, 'me')).toBeNull();
  });

  it("wears the Lane Crown with every gateway of the house's own world, and no other", () => {
    expect(holdsLaneCrown(schism('concord', { sol_a: 'me', sol_b: 'rival' }), 'me')).toBe(false);
    expect(holdsLaneCrown(schism('concord', { sol_a: 'me', sol_b: 'me' }), 'me')).toBe(true);
    expect(holdsLaneCrown(schism('concord', { verdan_a: 'me' }), 'me')).toBe(false);
    expect(holdsLaneCrown(mkState({ owners: { sol_a: 'me', sol_b: 'me' } }), 'me')).toBe(false);
  });

  it('briefs a house on its rival, the Concord and the Crown', () => {
    expect(describeSchism(schism('concord'), 'me', mapData)).toEqual([
      'You are the Western Mandate. The Eastern Mandate (Rival) holds the rest of Sol III, with the same kit.',
      'The Concord: you and the Eastern Mandate are under a truce for the first 3 rounds. Attacking them before it ends breaks it: they defend that attack with an extra die, and get an extra die for their next attack on you.',
      "The Lane Crown: hold all four of Sol III's gateways, your two and theirs, and you draft +2 reinforcements a turn.",
    ]);
    expect(describeSchism(schism('civil_war'), 'me', mapData)[1]).toBe(
      'Civil War: the Eastern Mandate is your enemy from the first turn.',
    );
  });

  it("names a house's own bonus, from either side of the world", () => {
    const withBonus = (bonus: number, holder: 'me' | 'rival') => {
      const state = schism('concord');
      const mode = state.galaxy_mode as { houses: Array<{ player_id: string; reinforce_bonus?: number }> };
      mode.houses = mode.houses.map((h) => (h.player_id === holder ? { ...h, reinforce_bonus: bonus } : h));
      return state;
    };
    expect(describeSchism(withBonus(2, 'me'), 'me', mapData)[1]).toBe(
      'Your half is the harder ground: the Western Mandate drafts +2 a turn on top of the kit.',
    );
    expect(describeSchism(withBonus(1, 'rival'), 'me', mapData)[1]).toBe(
      'Their half is the harder ground: the Eastern Mandate drafts +1 a turn on top of the kit.',
    );
    expect(describeSchism(withBonus(-1, 'me'), 'me', mapData)[1]).toBe(
      'Your half is the richer ground: the Western Mandate drafts 1 fewer a turn than the kit.',
    );
    expect(describeSchism(schism('concord'), 'me', mapData)).toHaveLength(3);
  });

  it('briefs an Allied house on its partner, with no Crown to fight over', () => {
    expect(describeSchism(schism('allied'), 'me', mapData)).toEqual([
      'You are the Western Mandate. The Eastern Mandate (Rival) holds the rest of Sol III, with the same kit.',
      'Allied: the Eastern Mandate is your ally, not your rival.',
    ]);
    expect(describeSchism(schism('allied'), null, mapData)).toEqual([
      expect.stringMatching(/^Eight houses, two to every world/),
      "Allied: each world's two houses are one side.",
    ]);
  });

  it('briefs a spectator on the board, and says nothing on any other board', () => {
    const lines = describeSchism(schism('concord'), null, mapData);
    expect(lines[0]).toMatch(/^Eight houses, two to every world/);
    expect(lines[1]).toBe("The Concord: each world's two houses start under a truce for the first 3 rounds.");
    expect(describeSchism(mkState(), 'me', mapData)).toEqual([]);
  });
});

describe('the Partial Schism board', () => {
  // Five seats: Sol shared by two houses, Verdan and Nexus with one seat each.
  const partial = (relations: 'concord' | 'civil_war' | 'allied') => ({
    players: [
      { player_id: 'me', username: 'Commander' },
      { player_id: 'rival', username: 'Rival' },
      { player_id: 'far', username: 'Far' },
      { player_id: 'near', username: 'Near' },
    ],
    territories: {},
    galaxy_mode: {
      id: 'schism' as const,
      relations,
      concord_rounds: relations === 'concord' ? 3 : 0,
      lane_crown_bonus: relations === 'allied' ? 0 : 2,
      houses: [
        { player_id: 'me', world_id: 'sol', half: 0 as const, name: 'Western Mandate' },
        { player_id: 'rival', world_id: 'sol', half: 1 as const, name: 'Eastern Mandate' },
        ...(relations === 'allied' ? [] : [
          { player_id: 'far', world_id: 'verdan', half: 1 as const, name: 'Duskrim Navigators' },
          { player_id: 'near', world_id: 'nexus_station', half: 0 as const, name: 'Ward Custodians', reinforce_bonus: 1 },
        ]),
      ],
      ...(relations === 'allied'
        ? { whole_worlds: [
          { player_id: 'far', world_id: 'verdan' },
          { player_id: 'near', world_id: 'nexus_station', reinforce_bonus: 2 },
        ] }
        : { unclaimed_garrison: { gateway: 9, interior: 11 } }),
      crown_gateways: {},
    },
  }) as unknown as GameState;

  it("briefs a house alone on its world on the unclaimed half, and the Crown it can win", () => {
    expect(describeSchism(partial('concord'), 'far', mapData)).toEqual([
      'You are the Duskrim Navigators, alone on Verdan Reach: its other half starts unclaimed, with 9 units on each gateway and 11 inland. Take it and the world is yours.',
      'Sol III is shared by two rival houses. The Concord: the two houses on Sol III start under a truce for the first 3 rounds.',
      "The Lane Crown: hold all four of Verdan Reach's gateways, your two and the unclaimed half's, and you draft +2 reinforcements a turn.",
    ]);
    expect(describeSchism(partial('civil_war'), 'near', mapData).slice(1, 3)).toEqual([
      'Your half is the harder ground: the Ward Custodians drafts +1 a turn on top of the kit.',
      'Sol III is shared by two rival houses. Civil War: the two houses on Sol III are enemies from the first turn.',
    ]);
    expect(schismRivalOf(partial('concord'), 'far')).toBeNull();
  });

  it('briefs an Allied seat on its whole world, and the number it drafts', () => {
    expect(describeSchism(partial('allied'), 'near', mapData)).toEqual([
      'You hold all of Nexus Station, a side of your own. Sol III is shared by two Allied houses, a side together.',
      'Alone against sides of two, you draft +2 a turn on top of the kit.',
    ]);
    expect(describeSchism(partial('allied'), 'far', mapData)).toHaveLength(1);
    expect(schismWholeWorldOf(partial('allied'), 'near')).toMatchObject({ world_id: 'nexus_station' });
    expect(schismWholeWorldOf(partial('concord'), 'near')).toBeNull();
  });

  it('briefs a spectator on which worlds are shared, and a house with a rival as at eight seats', () => {
    expect(describeSchism(partial('concord'), null, mapData)).toEqual([
      'Sol III is shared by two houses, who split the world and share its kit. Every other world has one house on half of it: the other half starts unclaimed, with 9 units on each gateway and 11 inland.',
      'The Concord: the two houses on Sol III start under a truce for the first 3 rounds.',
      "The Lane Crown: a house that holds all four of its world's gateways drafts +2 reinforcements a turn.",
    ]);
    expect(describeSchism(partial('allied'), null, mapData)).toEqual([
      'Sol III is shared by two houses, who split the world and share its kit; every other world is held whole by one player.',
      'Allied: every world is one side — its two houses, or the one player holding it.',
    ]);
    expect(describeSchism(partial('concord'), 'me', mapData)[0]).toBe(
      'You are the Western Mandate. The Eastern Mandate (Rival) holds the rest of Sol III, with the same kit.',
    );
  });
});

describe('lanes in a team game', () => {
  // me and pal are one side, rival the other.
  const teams = [
    { team_id: 'team_1', name: 'Us', player_ids: ['me', 'pal'] },
    { team_id: 'team_2', name: 'Them', player_ids: ['rival'] },
  ];
  const withTeams = (state: GameState, on = true) => ({ ...state, teams: on ? teams : undefined }) as GameState;

  it("make a lane the side's corridor when an ally holds the far end", () => {
    const owners = { sol_a: 'me', verdan_a: 'pal', sol_b: 'me', nexus_a: 'rival' };
    expect(laneStateFor(withTeams(mkState({ owners })), 'sol_a', 'verdan_a', 'me')).toBe('corridor');
    expect(laneStateFor(withTeams(mkState({ owners })), 'sol_a', 'verdan_a', 'pal')).toBe('corridor');
    expect(laneStateFor(withTeams(mkState({ owners })), 'sol_b', 'nexus_a', 'me')).toBe('open');
    expect(laneStateFor(withTeams(mkState({ owners }), false), 'sol_a', 'verdan_a', 'me')).toBe('open');
  });

  it("let the sealer's allies through its seal, and nobody else", () => {
    const seals = { [orbitLaneId('sol_b', 'nexus_a')]: { owner_id: 'pal', turns_remaining: 1 } };
    expect(isLaneSealedForPlayer(withTeams(mkState({ seals })), 'sol_b', 'nexus_a', 'me')).toBe(false);
    expect(isLaneSealedForPlayer(withTeams(mkState({ seals })), 'sol_b', 'nexus_a', 'rival')).toBe(true);
    expect(isLaneSealedForPlayer(withTeams(mkState({ seals }), false), 'sol_b', 'nexus_a', 'me')).toBe(true);
  });

  it('count Lane Sovereignty corridors the side holds together, over rounds set by the sides', () => {
    const connections = [
      { from: 'a1', to: 'b1', type: 'orbit' },
      { from: 'a2', to: 'b2', type: 'orbit' },
      { from: 'a3', to: 'b3', type: 'orbit' },
    ];
    const mk = (sides?: typeof teams) => ({
      settings: { allowed_victory_conditions: ['lane_sovereignty'] },
      players: ['me', 'rival', 'pal', 'foe'].map((player_id) => ({ player_id, lane_sovereignty_streak: player_id === 'me' ? 1 : 0 })),
      territories: Object.fromEntries(
        Object.entries({ a1: 'me', b1: 'pal', a2: 'pal', b2: 'pal', a3: 'me', b3: 'rival' }).map(([k, v]) => [k, { owner_id: v }]),
      ),
      teams: sides,
    }) as unknown as GameState;

    // a1–b1 is shared with an ally, a2–b2 is the ally's own; a3–b3 is a front.
    expect(laneSovereigntyProgress(mk(teams), connections, 'me')).toEqual(
      { applicable: true, held: 2, needed: 3, streak: 1, roundsNeeded: LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[2] },
    );
    // Four seats but two sides: the streak runs the two-sided count.
    expect(laneSovereigntyRoundsForGame(mk(teams))).toBe(5);
    const fourSides = [
      { team_id: 'team_1', name: 'A', player_ids: ['me'] },
      { team_id: 'team_2', name: 'B', player_ids: ['rival'] },
      { team_id: 'team_3', name: 'C', player_ids: ['pal'] },
      { team_id: 'team_4', name: 'D', player_ids: ['foe'] },
    ];
    expect(laneSovereigntyRoundsForGame(mk(fourSides))).toBe(3);
    // Without teams: the ally's gateway is someone else's, and the seats set the rounds.
    expect(laneSovereigntyProgress(mk(), connections, 'me')).toMatchObject({ held: 0, roundsNeeded: 3 });
    expect(laneSovereigntyRoundsForGame(null)).toBe(3);
  });
});
