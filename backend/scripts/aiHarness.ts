/**
 * What the headless harnesses that play whole games through the shared bot
 * turn (planAiTurn and playAiTurn, src/game-engine/ai/runAiTurn.ts) share:
 * the live AI flags and per-side overrides of them, a level's profile
 * overrides, and the parts of processAiTurn that sit around the turn itself.
 * Used by simAiArena.ts and simCampaignStages.ts, so a flag added to the bot
 * turn reaches both harnesses from one place.
 */
import type { AiDifficulty, GameMap, GameState } from '../src/types';
import { advanceToNextPlayer } from '../src/game-engine/state/gameStateManager';
import { AI_PROFILES, type AiLevel, type AiProfile } from '../src/game-engine/ai/aiProfiles';
import type { AiTurnFlags } from '../src/game-engine/ai/runAiTurn';
import { resolveEventChoice } from '../src/game-engine/events/eventCardManager';
import { syncLaneWeatherLanes } from '../src/game-engine/state/laneWeather';
import { syncSurgeProjectorLanes } from '../src/game-engine/state/surgeProjector';
import { featureFlags } from '../src/config/featureFlags';

/** The flags a live bot turn reads today, from the process's flag defaults. */
export function liveAiTurnFlags(): AiTurnFlags {
  return {
    captureOddsScoring: featureFlags.aiCaptureOddsEnabled,
    attackGrind: featureFlags.aiAttackGrindEnabled,
    decidedGamePress: featureFlags.aiDecidedGamePressEnabled,
    oddsPress: featureFlags.aiOddsPressEnabled,
    plannedDraft: featureFlags.aiPlannedReinforcementsEnabled,
    endingPlay: featureFlags.aiEndingPlayEnabled,
  };
}

/**
 * The live flags with `raw`'s overrides: `name=0|1` pairs, comma-separated,
 * e.g. `oddsPress=1,plannedDraft=1`. `name` is the setting being read, for
 * the error.
 */
export function parseAiTurnFlags(name: string, raw: string | undefined): AiTurnFlags {
  const out = liveAiTurnFlags();
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (!key || !(key in out) || (value !== '0' && value !== '1')) {
      throw new Error(`${name}: "${part}" is not name=0|1 for one of ${Object.keys(out).join(', ')}`);
    }
    out[key as keyof AiTurnFlags] = value === '1';
  }
  return out;
}

/** The flags that are on, for a run's header. */
export function describeAiTurnFlags(flags: AiTurnFlags): string {
  const on = Object.entries(flags).filter(([, v]) => v).map(([k]) => k);
  return on.length ? on.join(', ') : 'no AI flags';
}

/**
 * A side's level: its difficulty, or with overrides a profile over that
 * difficulty's row. A field the table lacks, or a value of the wrong type, is
 * refused rather than ignored.
 */
export function parseAiLevel(name: string, d: AiDifficulty, raw: string | undefined): AiLevel {
  if (!raw?.trim()) return d;
  const overrides = JSON.parse(raw) as Record<string, unknown>;
  const base = AI_PROFILES[d];
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in base) || key === 'difficulty') throw new Error(`${name}: ${key} is not an AiProfile setting`);
    if (typeof value !== typeof base[key as keyof AiProfile]) {
      throw new Error(`${name}: ${key} should be a ${typeof base[key as keyof AiProfile]}`);
    }
  }
  return { ...base, ...overrides } as AiProfile;
}

/** The settings a level changes from its difficulty's row, as `key=value`. */
export function aiLevelChanges(d: AiDifficulty, level: AiLevel): string[] {
  const base = AI_PROFILES[d];
  return typeof level === 'object'
    ? Object.entries(level).filter(([k, v]) => base[k as keyof AiProfile] !== v).map(([k, v]) => `${k}=${String(v)}`)
    : [];
}

/**
 * processAiTurn opens by answering a choice card the turn drew, taking the
 * first choice (resolveChoiceCardForAi).
 */
export function resolveChoiceCard(state: GameState): void {
  const card = state.active_event;
  const choice = card?.choices?.[0];
  if (card && choice) resolveEventChoice(state, card.card_id, choice.choice_id);
}

/**
 * processAiTurn's end of turn, less what only tells the room: the hand-off,
 * the lanes weather and an expired Surge Projector change, the transit
 * arrivals marker, and an instant event card the hand-off already applied
 * (broadcastEventCard clears it).
 */
export function handOff(state: GameState, map: GameMap): void {
  advanceToNextPlayer(state, map);
  syncLaneWeatherLanes(map, state);
  syncSurgeProjectorLanes(map, state);
  state.last_transit_arrivals = undefined;
  if (state.active_event) {
    state.active_event_result = undefined;
    if (!state.active_event.choices?.length) state.active_event = undefined;
  }
}
