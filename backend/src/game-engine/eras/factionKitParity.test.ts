import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { executeTechAbility } from '../abilities/executeTechAbility';
import {
  GAME_SCOPED_ABILITIES,
  TARGETED_DRAFT_ABILITIES,
  TERRITORY_ABILITY_DEFS,
} from '../abilities/techAbilities';
import {
  ANCIENT_FACTIONS, MEDIEVAL_FACTIONS, DISCOVERY_FACTIONS, WW2_FACTIONS, COLDWAR_FACTIONS,
  MODERN_FACTIONS, ACW_FACTIONS, RISORGIMENTO_FACTIONS, SPACE_AGE_FACTIONS, GALAXY_AGE_FACTIONS,
} from './index';

const ALL_FACTIONS = [
  ...ANCIENT_FACTIONS, ...MEDIEVAL_FACTIONS, ...DISCOVERY_FACTIONS, ...WW2_FACTIONS,
  ...COLDWAR_FACTIONS, ...MODERN_FACTIONS, ...ACW_FACTIONS, ...RISORGIMENTO_FACTIONS,
  ...SPACE_AGE_FACTIONS, ...GALAXY_AGE_FACTIONS,
];

/**
 * Guard: an AI seat must actually be able to fire every faction draft ability.
 *
 * The Soviet Union's Mass Mobilization was dead in live games for as long as it
 * existed. Both AI call sites — `processAiTurn`'s draft block in gameSocket and
 * `fireFactionAbility` in scripts/simFactionBalance.ts — decided "does this need
 * a target?" from `def.ownPlacement`, but `mass_mobilization` takes a
 * territoryId in executeTechAbility without carrying an `ownPlacement` to say
 * so. It was handed `undefined`, returned `{ success: false, error: 'Provide
 * territoryId' }`, and was dropped by the `if (res.success)` guard with nothing
 * logged. A human in the same seat passes a territory and gets the units, so it
 * only ever failed for bots — the precise parity gap that draft block exists to
 * close. Deleting the ability outright changed not one digit of a 300-game run.
 *
 * Checking the SET would only restate the fix. This mirrors the AI's own target
 * selection and asserts the call succeeds, so any future ability whose
 * implementation wants a territory fails here rather than silently doing
 * nothing for every bot in the game.
 */

function stateWithFaction(factionId: string): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'draft',
    turn_number: 3,
    current_player_index: 0,
    draft_units_remaining: 3,
    players: [{
      player_id: 'p1',
      player_index: 0,
      username: factionId,
      color: '#fff',
      is_ai: true,
      is_eliminated: false,
      territory_count: 2,
      cards: [],
      mmr: 1000,
      capital_territory_id: 't1',
      secret_mission: null,
      faction_id: factionId,
      unlocked_techs: [],
      // Generous but not unlimited: a kit that only works when rich is still a
      // kit, and techCost abilities are measured elsewhere.
      tech_points: 99,
      production_points: 99,
    }],
    territories: {
      t1: { territory_id: 't1', owner_id: 'p1', unit_count: 6, buildings: ['production_farm'], naval_units: 0, region_id: 'r1' },
      t2: { territory_id: 't2', owner_id: 'p1', unit_count: 2, buildings: [], naval_units: 0, region_id: 'r1' },
      t3: { territory_id: 't3', owner_id: 'p2', unit_count: 4, buildings: [], naval_units: 0, region_id: 'r2' },
      // A held Moon tile, so lunar_supply_drop's requiresMoon is satisfiable.
      // Fewer units than t1 on purpose: the AI sorts by garrison, so this only
      // gets picked when the ability's own filter demands it.
      t4: { territory_id: 't4', owner_id: 'p1', unit_count: 1, buildings: [], naval_units: 0, region_id: 'r2', world_id: 'moon' },
    },
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: false,
      diplomacy_enabled: false,
      tech_trees_enabled: true,
      factions_enabled: true,
      economy_enabled: true,
      events_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
    },
  } as unknown as GameState;
}

const map = {
  map_id: 'm1',
  name: 'probe',
  territories: [
    { territory_id: 't1', name: 'T1', region_id: 'r1' },
    { territory_id: 't2', name: 'T2', region_id: 'r1' },
    { territory_id: 't3', name: 'T3', region_id: 'r2' },
  ],
  connections: [
    { from: 't1', to: 't3', type: 'land' as const },
    { from: 't1', to: 't2', type: 'land' as const },
  ],
  regions: [
    { region_id: 'r1', name: 'R1', bonus: 2 },
    { region_id: 'r2', name: 'R2', bonus: 2 },
  ],
} as unknown as GameMap;

/**
 * The AI's own target choice, mirroring gameSocket's draft-ability block —
 * including every `ownPlacement` precondition it filters on. Copying the whole
 * filter is the point: a kit that the AI can never find a legal target for is
 * as dead as one it never calls, and only the full filter catches that.
 */
function aiTarget(state: GameState, map_: GameMap, abilityId: string): string | undefined {
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  const needsTarget = !!def?.ownPlacement || TARGETED_DRAFT_ABILITIES.has(abilityId);
  if (!needsTarget) return undefined;
  const requiresMoon = def?.ownPlacement?.requiresMoon ?? false;
  const requiresProduction = def?.ownPlacement?.requiresProductionBuilding ?? false;
  const requiresEnemyAdjacent = def?.ownPlacement?.requiresEnemyAdjacent ?? false;
  const enemyAdjacent = new Set(
    (map_.connections ?? [])
      .flatMap((c) => [[c.from, c.to], [c.to, c.from]] as const)
      .filter(([, other]) => {
        const t = state.territories[other];
        return !!t && t.owner_id != null && t.owner_id !== 'p1';
      })
      .map(([own]) => own),
  );
  return Object.values(state.territories)
    .filter((t) => t.owner_id === 'p1'
      && (!requiresMoon || (t as { world_id?: string }).world_id === 'moon'
        || (t as { globe_id?: string }).globe_id === 'moon')
      && (!requiresProduction || (t.buildings ?? []).some((b) => b.startsWith('production')))
      && (!requiresEnemyAdjacent || enemyAdjacent.has(t.territory_id)))
    .sort((a, b) => b.unit_count - a.unit_count)[0]?.territory_id;
}

const DRAFT_KITS = ALL_FACTIONS
  .filter((f) => {
    const def = f.ability_id ? TERRITORY_ABILITY_DEFS[f.ability_id] : undefined;
    return !!def && def.phase === 'draft';
  });

describe('every faction draft ability fires on the AI path', () => {
  it('finds draft kits to check (a vacuous sweep is not a passing one)', () => {
    expect(DRAFT_KITS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(DRAFT_KITS.map((f) => [f.faction_id, f.ability_id!] as const))(
    '%s / %s succeeds with the target the AI would pick',
    (factionId, abilityId) => {
      const state = stateWithFaction(factionId);
      const res = executeTechAbility({
        state,
        map,
        playerId: 'p1',
        abilityId,
        territoryId: aiTarget(state, map, abilityId),
      });
      expect(res.success, `${factionId}/${abilityId}: ${res.error ?? ''}`).toBe(true);
    },
  );

  it('a game-scoped draft kit is recorded as used, so it cannot fire twice', () => {
    const gameScoped = DRAFT_KITS.filter((f) => GAME_SCOPED_ABILITIES.has(f.ability_id!));
    expect(gameScoped.length).toBeGreaterThan(0);
    for (const f of gameScoped) {
      const state = stateWithFaction(f.faction_id);
      executeTechAbility({
        state, map, playerId: 'p1', abilityId: f.ability_id!, territoryId: aiTarget(state, map, f.ability_id!),
      });
      expect(state.players[0]!.used_game_abilities ?? [], f.faction_id).toContain(f.ability_id);
    }
  });
});
