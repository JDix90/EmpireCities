import type { EraId, GameSettings, VictoryType } from '../../types';
import { featureFlags, type MoonRacePhaseFlags, type MoonRacePhaseKey } from '../../config/featureFlags';
import { normalizeGameSettings } from '../../game-engine/state/gameSettings';
import { DEFAULT_CARD_SET_BONUS_CAP } from '../../game-engine/combat/combatResolver';
import { reachesSpaceAge } from '../../game-engine/eraAdvancement/spines';
import { ASCENSION_GALAXY_MAP_ID } from '../../game-engine/lobby/lobbyMapChange';
import { evaluateEraMapCompatibility } from '../../game-engine/lobby/lobbyEraMapCompatibility';

/**
 * The settings a new game is created with: what the lobby chose, plus what the
 * server bakes in for the era and map at the create boundary. The waiting
 * room's votes run the same rules, so a lobby that changes theater or a
 * setting before it starts ends up as if it had been created that way.
 *
 * Kept apart from games.routes.ts because the socket layer needs it, and the
 * route imports the socket layer.
 */

type Theater = { era_id: string; map_id: string };

const isGalacticAgeTheater = (t: Theater) => t.era_id === 'galaxy_age' || t.map_id === 'era_galaxy';
const isSpaceAgeTheater = (t: Theater) => t.era_id === 'space_age' || t.map_id === 'era_space_age';
/**
 * Boards whose hyperspace lanes follow Galactic Age rules: the lane dice cap,
 * world rules and convoys. Space to Stars has lanes from turn one (Earth to
 * Moon) and the ring to the far worlds once somebody ascends.
 */
const isGalaxyRulesTheater = (t: Theater) => isGalacticAgeTheater(t) || t.map_id === ASCENSION_GALAXY_MAP_ID;

/**
 * Orbit-gated eras (Galactic Age, standalone Space Age) can't finish by
 * domination alone: a large share of the board sits behind an orbit gate — the
 * neutral Moon, or the three hyperspace-locked galaxy worlds — so "hold every
 * tile" is effectively unreachable and, with no turn cap, the game never ends.
 * Sims: galaxy ~16% decisive at medium in 90 turns; Space Age ~93% of medium
 * games hit the 80-turn cap and domination NEVER fired in 120 games. So an
 * orbit-gated create that picked no victory conditions gets threshold 60%
 * alongside domination — reachable on the home board WITHOUT the gated tiles
 * (galaxy ⌈64·0.6⌉=39; Space Age ⌈55·0.6⌉=33 ≤ 46 reachable Earth tiles) — and
 * any such create without an explicit cap gets the max_turns 90 leader-wins
 * backstop. `checkVictory` reads live territory count, so the threshold target
 * self-adjusts if Space Age frontiers are seeded (63 tiles). Explicit caller
 * choices always win over the backstop. The Lunar Hegemony is the exception:
 * it is part of the Moon Race rather than a lobby choice, so it joins whatever
 * list the caller sent whenever its phase is baked. Exported for tests.
 */
export const ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD = 60;
export const ORBIT_GATED_DEFAULT_MAX_TURNS = 90;
export function applyOrbitGatedVictoryDefaults<
  T extends { allowed_victory_conditions?: VictoryType[]; victory_threshold?: number; max_turns?: number | null },
>(
  settings: T,
  opts: {
    isOrbitGated: boolean;
    callerChoseVictory: boolean;
    /** The Hegemony phase is baked AND the board has a Moon to hold. */
    lunarHegemony?: boolean;
    isGalacticAge?: boolean;
    /** False when the game has no lanes worth holding (Home Worlds off). */
    laneSovereignty?: boolean;
  },
): T {
  // Nothing to apply off an orbit-gated era unless the Hegemony is in play:
  // return the caller's own object so a non-Space-Age create is untouched, by
  // identity and not merely by value.
  if (!opts.isOrbitGated && !opts.lunarHegemony) return settings;
  const out = { ...settings };
  const add: VictoryType[] = [];
  // The headcount backstop only ever fills a blank list; an explicit lobby
  // choice of how the match ends wins.
  if (!opts.callerChoseVictory && opts.isOrbitGated) add.push('threshold');
  // Space Age Moon Race, Phase 3: the Hegemony is a decisive route of its own,
  // and it rides with the phase rather than with the lobby's list. It used to
  // fill a blank list only, but the lobby and Quick Match always send a list,
  // so it was never added: the clock and the contest rule stayed dark in every
  // ordinary game. Like the rest of the Moon Race it has no player-facing
  // opt-out (see resolveMoonRacePhases); the phase flag is the operator's kill
  // switch. Deliberately NOT conditioned on `isOrbitGated`: whether there is a
  // Moon to hold is the caller's question, and a game that is not orbit-gated
  // from turn one must not pick up the backstop below with it.
  if (opts.lunarHegemony) add.push('lunar_hegemony');
  // Lane Sovereignty is the galaxy's own way to win — hold the corridors, not
  // the tiles — and ships ON beside the headcount backstop. It is meaningless
  // off a lane map, so it is never added elsewhere, and like the backstop it
  // only fills a blank list.
  if (!opts.callerChoseVictory && opts.isGalacticAge && opts.laneSovereignty !== false) add.push('lane_sovereignty');
  if (add.length > 0) {
    out.allowed_victory_conditions = [...new Set([...(out.allowed_victory_conditions ?? []), ...add])];
  }
  // The threshold-60 / 90-turn backstop exists for a game that is orbit-gated
  // from turn ONE and would otherwise never end (a large share of the board
  // sits behind an orbit gate, so domination is unreachable). An era-advancement
  // climb is not that game: capping a marathon at 90 turns would be a different
  // game entirely, so this stays scoped to the start era.
  if (!opts.isOrbitGated) return out;
  if (!opts.callerChoseVictory && typeof out.victory_threshold !== 'number') {
    out.victory_threshold = ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD;
  }
  if (typeof out.max_turns !== 'number') out.max_turns = ORBIT_GATED_DEFAULT_MAX_TURNS;
  return out;
}

/**
 * Galactic Age with Home Worlds off: no faction kits (factions off, which also
 * makes the engine deal a scattered start), lanes that fight like any border
 * (`galaxy_plain_lanes`), and no Lane Sovereignty — with plain lanes there is
 * no corridor worth holding, so the victory is dropped even if the caller
 * listed it. Falls back to domination if that empties the list. Measured in
 * backend/scripts/GALAXY-BALANCE.md §6. Exported for tests.
 */
export function applyGalaxyHomeWorldsOff(list: VictoryType[]): {
  allowed_victory_conditions: VictoryType[];
  factions_enabled: false;
  galaxy_plain_lanes: true;
} {
  const without = list.filter((v) => v !== 'lane_sovereignty');
  return {
    allowed_victory_conditions: without.length > 0 ? without : ['domination'],
    factions_enabled: false,
    galaxy_plain_lanes: true,
  };
}

/**
 * The Space Age Moon Race resolution (docs/space-age-moon/README.md §10.2).
 *
 * ONE question: does the operator ship this phase yet. There is deliberately no
 * second, player-facing one.
 *
 * The Moon Race IS the Space Age — the lunar economy, the gated tier, the
 * Hegemony victory are what separate the era from rocket-flavoured Earth. An era
 * whose defining mechanic is optional does not have a defining mechanic: half
 * the games would be the old grind, "Space Age" would name two different games,
 * and a host would be making that choice for four other people before any of
 * them knew what it meant. So every Space Age game gets every shipped phase.
 *
 * The per-phase flags stay what they always were — dark-launch and kill
 * switches for the operator, not a game mode. `featureFlags.moonRacePhases` is
 * their single definition, so a sixth phase is one line there and reaches every
 * Space Age game the moment it is promoted.
 *
 * Exported for tests.
 */
export function resolveMoonRacePhases(opts: {
  isSpaceAge: boolean;
  /** What the operator ships — `featureFlags.moonRacePhases`. */
  shipped: MoonRacePhaseFlags;
}): { enabled: boolean; phases: Partial<Record<MoonRacePhaseKey, true>> } {
  const phases: Partial<Record<MoonRacePhaseKey, true>> = {};
  if (opts.isSpaceAge) {
    for (const [key, on] of Object.entries(opts.shipped) as [MoonRacePhaseKey, boolean][]) {
      // Only ever `true` or absent: normalizeGameSettings persists a phase key
      // solely when it is on, so writing an explicit `false` would round-trip to
      // undefined anyway and make settings comparisons lie in the meantime.
      if (on) phases[key] = true;
    }
  }
  return { enabled: Object.keys(phases).length > 0, phases };
}

/** What the bake reads: a create request's settings, or a lobby's stored ones. */
export type CreateGameSettingsInput = Partial<GameSettings> & {
  /** Galactic Age "Home Worlds": never persisted itself (see applyGalaxyHomeWorldsOff). */
  galaxy_home_worlds?: boolean;
};

/**
 * The create boundary's settings: the caller's choices, the new-game rule
 * defaults, and what the era and map bring with them. `hasMoon` is whether the
 * board has a Moon to hold, which decides whether the Lunar Hegemony is a way
 * the game can end.
 */
export function bakeCreateGameSettings(input: Theater & {
  settings: CreateGameSettingsInput;
  hasMoon: boolean;
}): GameSettings {
  const rawSettings = input.settings;
  const isGalacticAge = isGalacticAgeTheater(input);
  // Standalone Space Age frontier seeding is server-controlled via the feature
  // flag (the schema never accepts it from the client). Bake the live value into
  // the settings at create so the engine reads a fixed setting and stays pure.
  const isSpaceAge = isSpaceAgeTheater(input);
  // "Is or will be the Space Age": an era-advancement game that climbs there
  // arrives with the package too.
  const moonRace = resolveMoonRacePhases({
    isSpaceAge: isSpaceAge || reachesSpaceAge(input.era_id as EraId, rawSettings),
    shipped: featureFlags.moonRacePhases,
  });
  const spaceAgeBlockade = moonRace.phases.space_age_moon_blockade_enabled === true;
  const mergedList: VictoryType[] =
    rawSettings.allowed_victory_conditions && rawSettings.allowed_victory_conditions.length > 0
      ? [...new Set(rawSettings.allowed_victory_conditions)]
      : rawSettings.victory_type
        ? [rawSettings.victory_type]
        : ['domination'];
  const isGalaxyRules = isGalaxyRulesTheater(input);
  const galaxyHomeWorldsOff = isGalacticAge && rawSettings.galaxy_home_worlds === false;
  return normalizeGameSettings(
    applyOrbitGatedVictoryDefaults(
      {
        ...rawSettings,
        allowed_victory_conditions: mergedList,
        ...(galaxyHomeWorldsOff ? applyGalaxyHomeWorldsOff(mergedList) : {}),
        // New-game rule defaults, baked HERE rather than as normalizer
        // fallbacks: normalizeGameSettings re-runs on every room load
        // (repairLegacyGameState → gameRoomManager.repairRoom) and re-persists,
        // so a default changed there would silently re-rule matches already in
        // progress. At the create boundary an in-flight game keeps the rules it
        // started under, and an explicit client value still wins.
        combat_dice_cap_enabled: rawSettings.combat_dice_cap_enabled ?? true,
        card_set_bonus_cap: rawSettings.card_set_bonus_cap ?? DEFAULT_CARD_SET_BONUS_CAP,
        space_age_frontiers_enabled: isSpaceAge ? featureFlags.spaceAgeFrontiersEnabled : undefined,
        // Galactic Age corridors: same bake-at-create discipline as the
        // frontier flag, so the engine reads a fixed setting and stays pure.
        galaxy_corridors_enabled: isGalaxyRules ? featureFlags.galaxyCorridorsEnabled : undefined,
        // Galactic Age worlds as characters — same discipline; the map's
        // authored rules are snapshotted at init when this is on.
        world_rules_enabled: isGalaxyRules ? featureFlags.galaxyWorldRulesEnabled : undefined,
        world_rules_disabled: isGalaxyRules ? featureFlags.galaxyDisabledWorldRules : undefined,
        galaxy_transit_enabled: isGalaxyRules ? featureFlags.galaxyTransitEnabled : undefined,
        galaxy_buildings_v2: isGalaxyRules ? featureFlags.galaxyBuildingsV2Enabled : undefined,
        // Every Moon Race phase this game runs, resolved above. Spread rather
        // than listed so a sixth phase needs no edit here.
        ...moonRace.phases,
        // Tribute (§8) is a knob, not a phase: its own flag, and it applies
        // wherever the Moon Race does rather than needing a Space Age start.
        space_age_moon_tribute_enabled:
          (moonRace.enabled && featureFlags.spaceAgeMoonTributeEnabled) || undefined,
        // The blockade IS lane sealing, so the phase flag arms the underlying
        // mechanic rather than asking the lobby to set two things that must
        // agree. An explicit client value still wins.
        lanes_contestable_enabled: rawSettings.lanes_contestable_enabled ?? (spaceAgeBlockade || undefined),
        // Heritage building rights + modernize. Server-controlled: the schema
        // never accepts it from the client, and baking the live flag here (not
        // in the normalizer, which re-runs on every room load) keeps a running
        // game on the rules it started under.
        era_heritage_buildings_enabled: featureFlags.eraHeritageBuildingsEnabled,
        era_wonder_per_era_enabled: featureFlags.eraWonderPerEraEnabled,
      },
      {
        isOrbitGated: isGalacticAge || isSpaceAge,
        isGalacticAge,
        laneSovereignty: !galaxyHomeWorldsOff,
        callerChoseVictory:
          (rawSettings.allowed_victory_conditions?.length ?? 0) > 0 || rawSettings.victory_type != null,
        // Only on a board with a Moon to hold. An era-advancement climb bakes
        // the phase too, but the board transform that would bring it a Moon
        // is parked, so on its moonless board the route could never fire and
        // "How to win" would promise a victory that does not exist.
        lunarHegemony: moonRace.phases.space_age_moon_hegemony_enabled === true && input.hasMoon,
      },
    ),
  );
}

/** Keys the bake derives from the era and map rather than taking from the lobby. */
const THEATER_BAKED_KEYS = [
  'space_age_frontiers_enabled',
  'space_age_moon_tribute_enabled',
  'galaxy_corridors_enabled',
  'world_rules_enabled',
  'world_rules_disabled',
  'galaxy_transit_enabled',
  'galaxy_buildings_v2',
] as const;

/**
 * Systems an era cannot be played without, which the lobby form locks on
 * (frontend/src/utils/eraSystemDefaults.ts): the Moon and the lanes are
 * reached through the tech ladder and a building. The Galactic Age's factions
 * are refused rather than switched on, by the pairing rules.
 */
const ERA_REQUIRED_SYSTEMS: Record<string, ReadonlyArray<'economy_enabled' | 'tech_trees_enabled'>> = {
  space_age: ['economy_enabled', 'tech_trees_enabled'],
  galaxy_age: ['economy_enabled', 'tech_trees_enabled'],
};

/**
 * A waiting room's Map & Era vote: the settings the lobby would have been
 * created with on the new theater, from the same choices. What the old
 * theater baked in is dropped and baked again, so leaving the Space Age takes
 * its Moon Race, lunar victory and turn cap with it, and arriving brings them
 * along with the systems the era needs.
 */
export function rebakeSettingsForMapChange(input: {
  settings: Record<string, unknown>;
  from: Theater;
  to: Theater;
  hasMoon: boolean;
}): GameSettings {
  const { from, to } = input;
  const choices: Record<string, unknown> = { ...input.settings };
  for (const key of [...Object.keys(featureFlags.moonRacePhases), ...THEATER_BAKED_KEYS]) delete choices[key];
  // The lobby was created once already, new-game defaults and all. The dice
  // cap is stored only when on, so an explicit off must be passed back, or the
  // bake would read the missing key as a new game and switch the cap on again.
  choices.combat_dice_cap_enabled = input.settings.combat_dice_cap_enabled === true;
  // A Galactic Age lobby's own lane choice survives a move within the era;
  // anywhere else it was baked (the Space Age blockade) or refused at create.
  if (!(isGalaxyRulesTheater(from) && isGalaxyRulesTheater(to))) delete choices.lanes_contestable_enabled;
  if (!isGalacticAgeTheater(to)) delete choices.galaxy_plain_lanes;
  // The orbit-gated backstop's turn cap is baked: no waiting-room path sends one.
  const wasOrbitGated = isGalacticAgeTheater(from) || isSpaceAgeTheater(from);
  if (wasOrbitGated && choices.max_turns === ORBIT_GATED_DEFAULT_MAX_TURNS) delete choices.max_turns;
  // The Hegemony rides with the Moon Race, and the bake adds it back where it
  // applies. Lane Sovereignty only exists on a lane map.
  const listed = Array.isArray(choices.allowed_victory_conditions)
    ? (choices.allowed_victory_conditions as VictoryType[])
    : [];
  const kept = listed.filter((v) => v !== 'lunar_hegemony' && (isGalaxyRulesTheater(to) || v !== 'lane_sovereignty'));
  choices.allowed_victory_conditions = kept.length > 0 ? kept : ['domination'];
  // Era Advancement starts in the Ancient era.
  if (choices.era_advancement_enabled && to.era_id !== 'ancient') delete choices.era_advancement_enabled;
  for (const key of ERA_REQUIRED_SYSTEMS[to.era_id] ?? []) choices[key] = true;
  return bakeCreateGameSettings({ ...to, settings: choices as CreateGameSettingsInput, hasMoon: input.hasMoon });
}

const SYSTEM_LABELS = { economy_enabled: 'Economy & Buildings', tech_trees_enabled: 'Technology Trees' } as const;

/**
 * What a waiting-room proposal switches on besides itself, for its card, or
 * null: Naval brings Economy & Buildings, and a move to the Space or Galactic
 * Age brings the systems that era cannot be played without.
 */
export function lobbyVoteBringsAlong(
  settings: Record<string, unknown>,
  setting: string,
  value: unknown,
): string | null {
  const off = (keys: ReadonlyArray<keyof typeof SYSTEM_LABELS>) =>
    keys.filter((key) => settings[key] !== true).map((key) => SYSTEM_LABELS[key]);
  const turnsOn =
    setting === 'naval_enabled' && value === true ? off(['economy_enabled'])
      : setting === 'map_change' && value && typeof value === 'object'
        ? off(ERA_REQUIRED_SYSTEMS[(value as Theater).era_id] ?? [])
        : [];
  return turnsOn.length > 0 ? `turns on ${turnsOn.join(' and ')}` : null;
}

export const TERRITORY_DRAFT_FACTIONS_ERROR = 'Territory Draft cannot be combined with Asymmetric Factions';
export const ASYNC_TURN_TIMER_ERROR = 'Async games run on a daily deadline, not the turn timer';

/**
 * The settings a passed waiting-room vote leaves, with whatever the change
 * brings along: Naval needs Economy & Buildings (fleets only come from Ports),
 * which the lobby form locks on with it.
 */
export function applyLobbySettingVote(
  settings: Record<string, unknown>,
  setting: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...settings, [setting]: value };
  if (setting === 'naval_enabled' && value === true) next.economy_enabled = true;
  return next;
}

/**
 * Why a waiting-room vote on one setting may not stand, or null. It is held
 * to the rules a create request is: a vote may not leave a lobby in a shape
 * the create route refuses. A block the lobby already had is not the vote's
 * doing, and does not stop it.
 */
export function lobbySettingVoteRejection(input: Theater & {
  settings: Record<string, unknown>;
  setting: string;
  value: unknown;
}): string | null {
  const { settings, setting, value } = input;
  if (setting === 'turn_timer_seconds' && settings.async_mode === true) return ASYNC_TURN_TIMER_ERROR;
  const next = applyLobbySettingVote(settings, setting, value);
  if (next.territory_selection === true && next.factions_enabled === true) return TERRITORY_DRAFT_FACTIONS_ERROR;
  // The era was chosen at create, admin gate and all: what is asked here is
  // only whether the settings still fit it (the Galactic Age needs its factions).
  const pairing = (s: Record<string, unknown>) =>
    evaluateEraMapCompatibility({ era_id: input.era_id, map_id: input.map_id, settings: s, is_admin: true }).hardBlock;
  const after = pairing(next);
  return after && after !== pairing(settings) ? after : null;
}
