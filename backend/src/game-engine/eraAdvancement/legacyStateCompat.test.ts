/**
 * Back-compat gate for the era advancement spine refactor.
 *
 * `__fixtures__/pre-spine-refactor-state.json` is a frozen game state produced
 * by the PRE-refactor code (generated once via
 * `scripts/captureEraAdvancementFixture.ts` — do not regenerate). It contains
 * the legacy shapes: `medieval_signature_charges`, a flat
 * `era_advancement_tech_echo` (stat -> number), and no `era_spine` snapshot.
 *
 * These tests assert observable behavior, not field names. When the refactor
 * introduces loader normalization (EA-101) and generalized signature charges
 * (EA-102), update the HYDRATE/ACCESSOR helpers below to go through the new
 * loader and accessors — the fixture itself and the behavioral expectations
 * must stay unchanged. If a change here would alter an expected value, an
 * in-flight game would change behavior on deploy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameState, PlayerState } from '../../types';
import { canAdvanceEra, computeAdvanceCost, getAdvanceEraPreview } from './advanceEra';
import { resolvePlayerEraId } from './constants';
import { repairLegacyGameState } from '../state/gameStateManager';
import { getTechEchoBonus, LEGACY_ECHO_KEY } from './techEcho';

// HYDRATE: routed through `repairLegacyGameState` — the same normalization the
// Redis/Postgres load path applies (EA-101 spine synthesis + EA-102 charge migration).
function hydrateFixture(): GameState {
  const raw = readFileSync(join(__dirname, '__fixtures__', 'pre-spine-refactor-state.json'), 'utf-8');
  const state = JSON.parse(raw) as GameState;
  repairLegacyGameState(state);
  return state;
}

// ACCESSOR: EA-102 — legacy `medieval_signature_charges` is migrated into the
// generalized store by the loader.
function getLevyCharges(player: PlayerState): number {
  return player.era_signature_charges?.levy_of_knights ?? 0;
}

// ACCESSOR: EA-103 — the loader wraps the flat echo under the decay-exempt
// `legacy` key; the read path must honor it at full strength.
function getEchoAttackBonus(state: GameState, player: PlayerState): number {
  return getTechEchoBonus(state, player, 'attack_bonus');
}

describe('pre-spine-refactor state compatibility', () => {
  it('resolves each player to the era they were in when captured', () => {
    const state = hydrateFixture();
    const p1 = state.players.find((p) => p.player_id === 'p1')!;
    const p2 = state.players.find((p) => p.player_id === 'p2')!;
    expect(resolvePlayerEraId(state, p1)).toBe('medieval');
    expect(resolvePlayerEraId(state, p2)).toBe('ancient');
  });

  it('preserves the advancer\'s signature charge', () => {
    const state = hydrateFixture();
    const p1 = state.players.find((p) => p.player_id === 'p1')!;
    expect(getLevyCharges(p1)).toBe(1);
  });

  it('honors the legacy flat tech echo at full strength', () => {
    const state = hydrateFixture();
    const p1 = state.players.find((p) => p.player_id === 'p1')!;
    expect(getEchoAttackBonus(state, p1)).toBe(2);
    expect((p1.era_advancement_tech_echo as Record<string, Record<string, number>>)[LEGACY_ECHO_KEY]).toEqual({ attack_bonus: 2 });
  });

  it('keeps the advancer inside the vulnerability window with techs reset', () => {
    const state = hydrateFixture();
    const p1 = state.players.find((p) => p.player_id === 'p1')!;
    expect(p1.era_transition_turns_remaining).toBe(1);
    expect(p1.unlocked_techs ?? []).toHaveLength(0);
  });

  it('blocks the advancer at the captured max era', () => {
    const state = hydrateFixture();
    const result = canAdvanceEra(state, 'p1');
    expect(result.canAdvance).toBe(false);
    expect(result.error).toMatch(/maximum era/i);
  });

  it('prices the trailing player under the Phase 2 formula (income floor + catch-up)', () => {
    const state = hydrateFixture();
    const p2 = state.players.find((p) => p.player_id === 'p2')!;
    // income 6 lifts to floor 8; ×mult 2.0 ×1.5^0(=1) ×catch-up 0.85 (1 era behind p1) = ceil(13.6) = 14.
    expect(computeAdvanceCost(state, p2)).toBe(14);
  });

  it('still gates the trailing player on gold and reports next era', () => {
    const state = hydrateFixture();
    const preview = getAdvanceEraPreview(state, 'p2');
    expect(preview.canAdvance).toBe(false);
    expect(preview.cost).toBe(14);
    expect(preview.nextEraId).toBe('medieval');
  });

  it('synthesizes a spine snapshot for the pre-spine save', () => {
    const state = hydrateFixture();
    expect(state.era_spine?.map((s) => s.era_id)).toEqual(['ancient', 'medieval']);
  });

  it('migrates legacy charges idempotently (repair on every load)', () => {
    const state = hydrateFixture();
    repairLegacyGameState(state);
    repairLegacyGameState(state);
    const p1 = state.players.find((p) => p.player_id === 'p1')!;
    expect(getLevyCharges(p1)).toBe(1);
    expect(p1.medieval_signature_charges).toBeUndefined();
  });
});
