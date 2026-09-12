import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import { applyStabilityTick } from './stabilityManager';
import type { GameMap, GameSettings, GameState } from '../../types';

/**
 * The opening position and the per-turn stability rolls accept an injectable
 * RNG so balance sweeps replay identically (scripts/simEraBalance.ts). These
 * tests pin both halves of that contract: seeded callers are reproducible, and
 * callers that pass nothing still get the CSPRNG.
 */

function loadMap(): GameMap {
  return JSON.parse(
    readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf8'),
  ) as GameMap;
}

function settings(): GameSettings {
  return {
    fog_of_war: false,
    victory_type: 'domination',
    allowed_victory_conditions: ['domination'],
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    stability_enabled: true,
  } as GameSettings;
}

function players() {
  return [0, 1, 2].map((i) => ({
    player_id: `p${i}`,
    player_index: i,
    username: `P${i}`,
    color: '#000',
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
  }));
}

/** Deterministic `randomInt(min, max)`-shaped source: a 32-bit LCG. */
function seededRng(seed: number): (min: number, max: number) => number {
  let s = seed >>> 0;
  return (min, max) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return min + (s % Math.max(1, max - min));
  };
}

function ownershipFingerprint(state: GameState): string {
  return Object.keys(state.territories)
    .sort()
    .map((tid) => `${tid}:${state.territories[tid].owner_id ?? '-'}`)
    .join('|');
}

describe('seeded game initialization', () => {
  it('replays the same opening position for the same seed', () => {
    const map = loadMap();
    const a = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
      rng: seededRng(12345),
    });
    const b = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
      rng: seededRng(12345),
    });

    expect(ownershipFingerprint(a)).toBe(ownershipFingerprint(b));
    expect(a.card_deck.map((c) => c.territory_id)).toEqual(b.card_deck.map((c) => c.territory_id));
  });

  it('produces a different opening position for a different seed', () => {
    const map = loadMap();
    const a = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
      rng: seededRng(1),
    });
    const b = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
      rng: seededRng(999),
    });

    // Guards against the seam being accepted but ignored.
    expect(ownershipFingerprint(a)).not.toBe(ownershipFingerprint(b));
  });

  it('still deals every territory without an rng (production path)', () => {
    const map = loadMap();
    const state = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
    });
    const owners = Object.values(state.territories).filter((t) => t.owner_id).length;
    expect(owners).toBe(Object.keys(state.territories).length);
  });
});

describe('seeded stability tick', () => {
  /** A territory low enough to be eligible for the rebellion roll. */
  function rebellionReady(): GameState {
    const map = loadMap();
    const state = initializeGameState('g', 'ancient', map, players(), settings(), {
      forceStartingPlayerIndex: 0,
      rng: seededRng(7),
    });
    for (const t of Object.values(state.territories)) {
      if (t.owner_id === 'p0') { t.stability = 5; t.unit_count = 4; }
    }
    return state;
  }

  it('rebels identically for the same seeded roll source', () => {
    const rolls = () => {
      const next = seededRng(42);
      return () => next(0, 1_000_000) / 1_000_000;
    };
    const a = applyStabilityTick(rebellionReady(), 'p0', rolls());
    const b = applyStabilityTick(rebellionReady(), 'p0', rolls());
    expect(a).toEqual(b);
  });

  it('never rebels when the roll source always returns 1, and always does at 0', () => {
    expect(applyStabilityTick(rebellionReady(), 'p0', () => 1)).toEqual([]);
    expect(applyStabilityTick(rebellionReady(), 'p0', () => 0).length).toBeGreaterThan(0);
  });

  it('advanceToNextPlayer forwards its rng into the tick', () => {
    const state = rebellionReady();
    state.current_player_index = state.players.length - 1; // next up is p0
    const before = Object.values(state.territories)
      .filter((t) => t.owner_id === 'p0')
      .reduce((sum, t) => sum + t.unit_count, 0);
    // Roll 0 => every eligible territory rebels and loses a unit.
    advanceToNextPlayer(state, loadMap(), { rng: () => 0 });
    const after = Object.values(state.territories)
      .filter((t) => t.owner_id === 'p0')
      .reduce((sum, t) => sum + t.unit_count, 0);
    expect(after).toBeLessThan(before);
  });
});
