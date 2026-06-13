import { describe, it, expect } from 'vitest';
import type { EraId, GameState, PlayerState, TerritoryState } from '../../types';
import { ERA_ADVANCEMENT_SPINES } from '../eraAdvancement/spines';
import { executeAdvanceEra } from '../eraAdvancement/advanceEra';
import { getEraFactions } from './index';
import { applyLineageOnAdvance, findFactionByLineage, getPlayerFaction, migrateAdvancedFactions } from './factionLineage';

const CLASSIC_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'];
const LINEAGES = ['imperial', 'expansionist', 'maritime', 'mercantile', 'bastion', 'insurgent'];

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    era: 'ancient',
    players: [],
    territories: {},
    era_spine: ERA_ADVANCEMENT_SPINES.classic.steps,
    settings: { era_advancement_enabled: true, factions_enabled: true },
    ...overrides,
  } as GameState;
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p', faction_id: 'rome', current_era_index: 0, ...overrides } as PlayerState;
}

describe('lineage grid', () => {
  it('every classic era defines exactly one faction per lineage, with no faction left untagged', () => {
    for (const era of CLASSIC_ERAS) {
      const factions = getEraFactions(era);
      for (const lineage of LINEAGES) {
        expect(factions.filter((f) => f.lineage_id === lineage), `${era}:${lineage}`).toHaveLength(1);
      }
      expect(factions.every((f) => !!f.lineage_id), `${era} fully tagged`).toBe(true);
    }
  });

  it('every lineage resolves in every classic era (resolution invariant)', () => {
    for (const lineage of LINEAGES) {
      for (const era of CLASSIC_ERAS) {
        expect(findFactionByLineage(era, lineage), `${lineage}@${era}`).toBeDefined();
      }
    }
  });
});

describe('getPlayerFaction', () => {
  it('resolves a faction by the player\'s CURRENT era, not the game era', () => {
    const s = state();
    expect(getPlayerFaction(s, player({ faction_id: 'rome', current_era_index: 0 }))?.faction_id).toBe('rome');
    // a player advanced to medieval holds the medieval lineage faction id
    expect(getPlayerFaction(s, player({ faction_id: 'hre', current_era_index: 1 }))?.faction_id).toBe('hre');
  });

  it('collapses to the game era when era advancement is off', () => {
    const s = state({ settings: { factions_enabled: true, era_advancement_enabled: false } } as Partial<GameState>);
    // current_era_index is ignored without era advancement
    expect(getPlayerFaction(s, player({ faction_id: 'rome', current_era_index: 3 }))?.faction_id).toBe('rome');
  });

  it('returns undefined for a player without a faction', () => {
    expect(getPlayerFaction(state(), player({ faction_id: undefined }))).toBeUndefined();
  });
});

describe('applyLineageOnAdvance', () => {
  it('remaps a faction along its lineage across the full classic spine', () => {
    const s = state();
    const p = player({ faction_id: 'rome' });
    const expected = ['hre', 'spain', 'germany', 'ussr', 'eastern_bloc'];
    for (let i = 0; i < 5; i++) {
      applyLineageOnAdvance(s, p, CLASSIC_ERAS[i], CLASSIC_ERAS[i + 1]);
      expect(p.faction_id, `step ${i}`).toBe(expected[i]);
      expect(p.faction_lineage_id).toBe('imperial');
    }
  });

  it('carries each lineage to its own next-era faction (one step)', () => {
    const cases: Array<[string, string]> = [
      ['maurya', 'mongol_empire'], // expansionist
      ['carthage', 'england'], // maritime
      ['han', 'caliphate'], // mercantile
      ['parthia', 'byzantine'], // bastion
      ['germanic_tribes', 'france'], // insurgent
    ];
    for (const [from, to] of cases) {
      const p = player({ faction_id: from });
      applyLineageOnAdvance(state(), p, 'ancient', 'medieval');
      expect(p.faction_id, from).toBe(to);
    }
  });

  it('no-ops when factions are disabled', () => {
    const s = state({ settings: { factions_enabled: false, era_advancement_enabled: true } } as Partial<GameState>);
    const p = player({ faction_id: 'rome' });
    applyLineageOnAdvance(s, p, 'ancient', 'medieval');
    expect(p.faction_id).toBe('rome');
  });
});

describe('migrateAdvancedFactions (back-compat)', () => {
  it('remaps a stale base-era faction_id on an advanced player', () => {
    const p = player({ faction_id: 'carthage', current_era_index: 3 }); // maritime, sitting in ww2
    migrateAdvancedFactions(state({ players: [p] }));
    expect(p.faction_id).toBe('uk'); // ww2 maritime
    expect(p.faction_lineage_id).toBe('maritime');
  });

  it('leaves a valid current-era faction untouched but backfills its lineage', () => {
    const p = player({ faction_id: 'uk', current_era_index: 3 });
    migrateAdvancedFactions(state({ players: [p] }));
    expect(p.faction_id).toBe('uk');
    expect(p.faction_lineage_id).toBe('maritime');
  });

  it('no-ops when era advancement or factions are off', () => {
    const p = player({ faction_id: 'carthage', current_era_index: 3 });
    migrateAdvancedFactions(state({ players: [p], settings: { factions_enabled: false, era_advancement_enabled: true } } as Partial<GameState>));
    expect(p.faction_id).toBe('carthage');
  });
});

describe('executeAdvanceEra integration', () => {
  function terr(id: string, extra: Partial<TerritoryState> = {}): TerritoryState {
    return { territory_id: id, owner_id: 'p', unit_count: 5, unit_type: 'infantry', ...extra } as TerritoryState;
  }

  it('evolves the faction when a faction player advances', () => {
    const p = player({
      faction_id: 'carthage', // maritime
      current_era_index: 0,
      special_resource: 100,
      last_turn_production_income: 10,
      unlocked_techs: ['ancient_iron_weapons', 'ancient_stone_walls', 'ancient_granaries', 'ancient_siege_engines'],
    });
    const s = state({
      players: [p],
      territories: { cap: terr('cap', { buildings: ['production_1'] }), b: terr('b') },
      settings: {
        era_advancement_enabled: true,
        factions_enabled: true,
        economy_enabled: true,
        tech_trees_enabled: true,
        stability_enabled: false,
        era_advancement_spine_id: 'classic',
      },
    } as Partial<GameState>);

    const result = executeAdvanceEra(s, 'p');
    expect(result.success).toBe(true);
    expect(p.current_era_index).toBe(1);
    expect(p.faction_id).toBe('england'); // medieval maritime
    expect(p.faction_lineage_id).toBe('maritime');
    expect(getPlayerFaction(s, p)?.faction_id).toBe('england');
  });
});
