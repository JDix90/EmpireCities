/**
 * Shared types/constants for frontend + backend. Extend incrementally to reduce drift.
 */

export type GamePhase = 'territory_select' | 'draft' | 'attack' | 'fortify' | 'game_over';

export type ConnectionType = 'land' | 'sea' | 'orbit';

export interface MapConnectionEdge {
  from: string;
  to: string;
  type?: ConnectionType;
  /** Engine-added lane (a Launch Pad's orbit lane); never present in authored maps. */
  source?: 'launch_pad' | 'jump_gate';
}

export {
  type MapKind,
  type OrbitAccessMode,
  type MapTerritoryWorldLike,
  type MapWorldDefinition,
  type MapWorldGlobeView,
  type WorldModifiers,
  type WorldRules,
  type WorldVaultRule,
  inferWorldId,
} from './worldId';

export {
  type BannerLook,
  type CosmeticGlyphName,
  type CosmeticKind,
  type CosmeticLook,
  type CosmeticSet,
  type DiceLook,
  type FrameLook,
  type MarkerLook,
  type PlayerCosmetics,
  COSMETIC_GLYPHS,
  COSMETIC_LOOKS,
  COSMETIC_SETS,
  COSMETIC_TYPE_KIND,
  bannerLook,
  cosmeticLook,
  diceLook,
  frameLook,
  markerLook,
} from './cosmetics';

/**
 * AI opponent display names. A hand-picked, multicultural roster of commander
 * personas instead of auto-numbered "AI Bot 3", so AI players read as
 * intentional, not lazily generated. The "(AI)" suffix keeps it honest —
 * players should always be able to tell a bot from a human. Shared so the
 * in-game roster (frontend) and the broadcast / lobby / live-games names
 * (backend) resolve to the SAME name for a given seat.
 */
const AI_PERSONAS = [
  'General Varro',
  'Marshal Okonkwo',
  'Admiral Chen',
  'Strategos Doukas',
  'Warlord Tamsin',
  'Commander Reyes',
  'Hetman Volkov',
  'Rani Aditi',
  'Jarl Sigrún',
  'Sultana Yasmin',
  'Praetor Galba',
  'Khan Ulan',
];

/** Stable display name for an AI player, derived from its seat (player_index). */
export function aiPlayerName(playerIndex: number): string {
  const n = AI_PERSONAS.length;
  const i = ((Math.trunc(playerIndex) % n) + n) % n; // safe for any int, incl. negatives
  return `${AI_PERSONAS[i]} (AI)`;
}

// ── Level / XP utilities ──────────────────────────────────────────────────

/** Level from cumulative XP (matches backend computeLevel). */
export function getLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 250)) + 1;
}

/** Total XP needed to reach a given level. */
export function getXpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 250;
}

/** Progress info for current level. */
export function getLevelProgress(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  const level = getLevel(xp);
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const range = nextLevelXp - currentLevelXp;
  const progress = range > 0 ? (xp - currentLevelXp) / range : 0;
  return { level, currentLevelXp, nextLevelXp, progress: Math.min(1, Math.max(0, progress)) };
}

// ── Ranked tier utilities ─────────────────────────────────────────────────

export type RankedTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface TierInfo {
  tier: RankedTier;
  label: string;
  color: string;
  minMu: number;
}

const TIER_THRESHOLDS: TierInfo[] = [
  { tier: 'diamond',  label: 'Diamond',  color: '#B9F2FF', minMu: 1900 },
  { tier: 'platinum', label: 'Platinum', color: '#E5E4E2', minMu: 1700 },
  { tier: 'gold',     label: 'Gold',     color: '#FFD700', minMu: 1500 },
  { tier: 'silver',   label: 'Silver',   color: '#C0C0C0', minMu: 1300 },
  { tier: 'bronze',   label: 'Bronze',   color: '#CD7F32', minMu: 0 },
];

export function getTier(mu: number): TierInfo {
  return TIER_THRESHOLDS.find((t) => mu >= t.minMu) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]!;
}

// ── Cosmetic rarity ───────────────────────────────────────────────────────

export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

export const RARITY_COLORS: Record<CosmeticRarity, string> = {
  common:    '#9CA3AF',
  uncommon:  '#22C55E',
  rare:      '#3B82F6',
  legendary: '#A855F7',
  mythic:    '#F97316',
};

// ── Onboarding quest definitions ──────────────────────────────────────────

export interface QuestDef {
  quest_id: string;
  title: string;
  description: string;
  reward_xp: number;
  reward_gold: number;
}

export const ONBOARDING_QUESTS: QuestDef[] = [
  { quest_id: 'first_win',      title: 'First Victory',      description: 'Win your first game',          reward_xp: 50,  reward_gold: 20 },
  { quest_id: 'first_building',  title: 'Master Builder',     description: 'Build your first building',    reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_tech',      title: 'Age of Discovery',   description: 'Research a technology',        reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_ranked',    title: 'Ranked Contender',   description: 'Enter a ranked match',         reward_xp: 0,   reward_gold: 50 },
  { quest_id: 'first_friend',    title: 'Allies',             description: 'Add a friend',                 reward_xp: 0,   reward_gold: 25 },
  { quest_id: 'first_async',     title: 'The Long Game',      description: 'Start a multi-day game against another player', reward_xp: 0, reward_gold: 50 },
];

/**
 * Quests completable in any order. The rest of ONBOARDING_QUESTS gate
 * sequentially; first_async must not, because the players it targets are
 * early in the chain when the async CTA is shown to them.
 */
export const NON_SEQUENTIAL_QUESTS = new Set(['first_async']);

// ── Daily login rewards ───────────────────────────────────────────────────

/**
 * Escalating gold for consecutive login days (index = login_streak - 1;
 * day 5+ stays at the last value). Day 2 is deliberately bigger than day 1 —
 * the visible jump is the "come back tomorrow" hook on the post-game screen
 * and the login calendar. Shared so backend awards and frontend teasers can
 * never drift apart.
 */
export const DAILY_LOGIN_REWARDS = [10, 15, 20, 25, 30] as const;

/** Gold for a given consecutive-login day count (1-based; clamps at the cap). */
export function dailyLoginRewardForStreak(loginStreak: number): number {
  const idx = Math.min(Math.max(loginStreak, 1), DAILY_LOGIN_REWARDS.length) - 1;
  return DAILY_LOGIN_REWARDS[idx]!;
}

// ── Streak freezes ────────────────────────────────────────────────────────

/**
 * A streak freeze bridges exactly one missed day of the daily play streak;
 * gaps of two or more days still reset. Priced between the 3-day (25g) and
 * 7-day (75g) streak milestones so a freeze is a real purchase but cheaper
 * than the streak it protects. The cap keeps streaks mortal.
 */
export const STREAK_FREEZE_PRICE_GOLD = 50;
export const STREAK_FREEZE_MAX_HELD = 2;

// ── Building display names & effects ──────────────────────────────────────

/**
 * The ONE table of building names and one-line effects.
 *
 * Shared for the same reason `AI_DISPLAY_NAMES` is. Three tables used to carry
 * these independently — the build panel, the Bonuses modal, and the backend's
 * validation error messages — and they had drifted apart: `production_3` was
 * "Arsenal" in one and "War Factory" in another, `tech_gen_1` was "Laboratory"
 * and "Library", `defense_2` was "Fortress" and "Fortification". A player who
 * built a thing in one panel and read about it in another saw two names for it.
 *
 * The production chain was also mis-described. It does NOT produce units:
 * `collectProduction` credits the player's production-point pool — the ⚙ PP
 * chip — which is spent on constructing buildings and on advancing an era, and
 * nothing anywhere converts it to reinforcements. Draft units come from
 * territory count, region bonuses, factions and tech, never from a building.
 * The old names made that worse by being military ones (Camp, Barracks,
 * Arsenal), so "+1 unit per turn" read as troops appearing on the territory.
 * The chain is now named for what it actually is — industry — and its effects
 * use the same PP/TP tokens as the HUD resource chips, so the building's claim
 * and the number it moves are recognisably the same thing.
 *
 * Names are era-neutral by necessity: one label serves Ancient through Galaxy
 * Age, since building ids are not era-scoped.
 */
export interface BuildingDisplay {
  /** Name without the tier suffix. */
  name: string;
  /** Roman numeral for a tiered chain; absent for standalone buildings. */
  tier?: string;
  /** One-line effect, in the same vocabulary as the HUD resource chips. */
  effect: string;
}

export const BUILDING_DISPLAY: Record<string, BuildingDisplay> = {
  // Industry — produces PP, the currency for buildings and era advancement.
  production_1: { name: 'Workshop', tier: 'I', effect: '+1 PP/turn' },
  production_2: { name: 'Foundry', tier: 'II', effect: '+2 PP/turn' },
  production_3: { name: 'Manufactory', tier: 'III', effect: '+4 PP/turn' },
  production_4: { name: 'Industrial Complex', tier: 'IV', effect: '+7 PP/turn' },

  defense_1: { name: 'Palisade', tier: 'I', effect: '+1 defense die' },
  defense_2: { name: 'Fortress', tier: 'II', effect: '+2 defense dice' },
  defense_3: { name: 'Citadel', tier: 'III', effect: '+3 defense dice' },

  tech_gen_1: { name: 'Laboratory', tier: 'I', effect: '+2 TP/turn' },
  tech_gen_2: { name: 'Research Center', tier: 'II', effect: '+4 TP/turn' },

  port: { name: 'Port', effect: '+1 fleet/turn' },
  naval_base: { name: 'Naval Base', effect: '+2 fleets/turn' },
  coastal_battery: {
    name: 'Coastal Battery',
    effect: '+1 defense die vs sea attacks',
  },
  launch_pad: {
    name: 'Launch Pad',
    effect: 'Enables Launch Space Station, and opens an orbit lane to the Moon from this territory',
  },
  jump_gate: {
    name: 'Jump Gate',
    effect: 'Moves your units to your gates on other worlds — logistics only, no attacks (one gate per world)',
  },
  // Galactic Age world buildings (GALAXY_WORLD_BUILDING_IDS below): one per
  // world rule, and a toll on the lanes. Relative wording, because each reads
  // its world's authored threshold rather than a number of its own.
  habitat_dome: { name: 'Habitat Dome', effect: 'The Cradle musters this system one unit higher' },
  storm_shelter: { name: 'Storm Shelter', effect: 'Storms strike this system only 6 units higher' },
  vault_conduit: { name: 'Vault Conduit', effect: '+1 TP/turn while you hold the whole Vault (one per Vault)' },
  toll_beacon: { name: 'Toll Beacon', effect: '+1 PP/turn while you hold both ends of its lane (one per lane)' },
};

/**
 * Per-era NAMES layered over `BUILDING_DISPLAY`. The ids are not era-scoped, so
 * the base table has to serve Ancient through Galaxy Age — and a Palisade on a
 * hyperspace gateway reads wrong. An era listed here renames what it lists and
 * inherits the rest; tiers and effects never change, because those are the
 * numbers the engine moves. Read by `buildingDisplayName` when the caller
 * passes the era, which it does only for a game whose settings opt in
 * (`galaxy_buildings_v2`), so a flag flip never renames a match in progress.
 */
export const BUILDING_DISPLAY_BY_ERA: Record<string, Record<string, string>> = {
  galaxy_age: {
    production_1: 'Fabricator',
    production_2: 'Orbital Foundry',
    production_3: 'Shipyard Ring',
    production_4: 'Dyson Collector',
    defense_1: 'Shield Array',
    defense_2: 'Bastion',
    defense_3: 'Gateway Citadel',
    tech_gen_1: 'Observatory',
    tech_gen_2: 'Lattice Array',
  },
};

/**
 * Display name for a building id, with its tier suffix by default. `eraId`
 * selects an era's name layer; absent or unlisted, the shared name is used.
 */
export function buildingDisplayName(buildingId: string, withTier = true, eraId?: string): string {
  const entry = BUILDING_DISPLAY[buildingId];
  if (!entry) return buildingId;
  const name = (eraId && BUILDING_DISPLAY_BY_ERA[eraId]?.[buildingId]) || entry.name;
  return withTier && entry.tier ? `${name} (${entry.tier})` : name;
}

/** The shape every tech-tree reader needs to know which buildings a node opens. */
export interface TechNodeBuildingUnlocks {
  unlocks_building?: string;
  unlocks_buildings?: string[];
}

/**
 * Every building a tech node unlocks. A node has carried one building in
 * `unlocks_building` since the trees were written; the Galactic Age's v2
 * gating needs a node to open two (its tier-1 economic root opens both the
 * first industry and the first research building), so `unlocks_buildings`
 * exists beside it. Readers go through here so the two fields can never
 * disagree about what a node opens.
 */
export function techNodeBuildingUnlocks(node: TechNodeBuildingUnlocks): string[] {
  if (node.unlocks_buildings && node.unlocks_buildings.length > 0) return node.unlocks_buildings;
  return node.unlocks_building ? [node.unlocks_building] : [];
}

// ── Galactic Age garrison doctrines (docs/GALACTIC_AGE_BUILDINGS.md §5) ──────
//
// A doctrine is a property of a tile's garrison, not of its units: Hardened
// makes the stack defending the tile roll d8s, Forward makes attacks launched
// from it roll d8s. One per tile, bought with PP. Dice COUNTS never change, so
// a Forward crossing of a hyperspace lane still rolls the lane's two dice.
// Read by the server's rule (state/garrisonDoctrines.ts) and the client's
// panels, so the two always name and price them alike.

export type GarrisonDoctrine = 'hardened' | 'forward';

export const GARRISON_DOCTRINE_IDS: readonly GarrisonDoctrine[] = ['hardened', 'forward'];

/** Opening PP price of either doctrine (a knob; the sim sets it). */
export const GARRISON_DOCTRINE_COST = 6;

/** Faces on a doctrine side's dice. A d8 beats a d6 in a matchup 56% of the time. */
export const GARRISON_DOCTRINE_DIE_FACES = 8;

/** The research that opens doctrines: the galaxy tree's economic root. */
export const GARRISON_DOCTRINE_TECH_ID = 'ga_lattice_logistics';

export const GARRISON_DOCTRINE_DISPLAY: Record<GarrisonDoctrine, { name: string; short: string; effect: string }> = {
  hardened: {
    name: 'Hardened garrison',
    short: 'Hardened',
    effect: 'The stack defending this system rolls d8 dice.',
  },
  forward: {
    name: 'Forward garrison',
    short: 'Forward',
    effect: 'Attacks launched from this system roll d8 dice.',
  },
};

export function isGarrisonDoctrine(value: unknown): value is GarrisonDoctrine {
  return value === 'hardened' || value === 'forward';
}

// ── Galactic Age world buildings (docs/GALACTIC_AGE_BUILDINGS.md §7) ─────────
//
// One building per world rule, so each world's rule carries a decision, and a
// toll that pays for holding corridors. Each is its own building id and its
// own one-per-tile category, opened by Lattice Logistics, and exists only in a
// game created with `galaxy_world_buildings`. Prices and effects live here so
// the server, the build panel and the bots read one table.

export const GALAXY_WORLD_BUILDING_IDS = ['habitat_dome', 'storm_shelter', 'vault_conduit', 'toll_beacon'] as const;
export type GalaxyWorldBuildingId = (typeof GALAXY_WORLD_BUILDING_IDS)[number];

export function isGalaxyWorldBuilding(id: string): id is GalaxyWorldBuildingId {
  return (GALAXY_WORLD_BUILDING_IDS as readonly string[]).includes(id);
}

/** PP to raise each, before the world's build-cost multiplier (Rust builds at half). */
export const GALAXY_WORLD_BUILDING_COSTS: Record<GalaxyWorldBuildingId, number> = {
  habitat_dome: 5,
  storm_shelter: 5,
  vault_conduit: 6,
  toll_beacon: 6,
};

/** What each one moves, on the tile it stands on. */
export const GALAXY_WORLD_BUILDING_EFFECTS = {
  /** Added to the Cradle's muster threshold on a tile with a Habitat Dome (2 → 3). */
  habitatDomeMusterBonus: 1,
  /** Added to the storm threshold on a tile with a Storm Shelter (12 → 18). */
  stormShelterThresholdBonus: 6,
  /** TP a turn from a Vault's Conduit, while its owner holds the whole Vault. One Conduit a Vault. */
  vaultConduitTechIncome: 1,
  /** PP a turn per Toll Beacon, while its lane is its owner's corridor. One beacon a lane. */
  tollBeaconProductionIncome: 1,
} as const;

// ── WW2 Manhattan Project: the atomic arsenal (docs/WW2_MANHATTAN_PROJECT.md §5)
// Under `settings.ww2_atomic_arsenal` the Atom Bomb is once per turn, priced in
// PP with a price that climbs with each detonation, leaves fallout on its tile,
// costs the bomber stability at home, and makes Manhattan Project cheaper for
// everyone still without it. The server, the territory panel and the bots read
// this one table.

export const WW2_ATOMIC_ARSENAL = {
  /** PP for a player's first detonation. */
  firstPrice: 15,
  /** PP added to the price for each detonation the player has already made. */
  priceStep: 5,
  /** Rounds a bombed tile carries fallout. */
  falloutRounds: 3,
  /** Units a held fallout tile loses at each round start, never below one. */
  falloutAttrition: 1,
  /** Stability every territory of the bomber loses, in a game with stability. */
  homeStabilityLoss: 10,
  /** Manhattan Project's price, as a share, for a player without it once anyone has detonated. */
  proliferationCostShare: 0.5,
} as const;

/** PP for a player's next detonation, given how many they have made. */
export function atomBombPrice(detonationsSoFar: number): number {
  return WW2_ATOMIC_ARSENAL.firstPrice + WW2_ATOMIC_ARSENAL.priceStep * Math.max(0, detonationsSoFar);
}

// ── Galactic Age lane powers (docs/GALACTIC_AGE_BUILDINGS.md §6) ─────────────
//
// Opening PP prices, read by the server's ability defs (abilities/techAbilities)
// and the client's ability buttons, so the two quote one price.
export const GALAXY_LANE_POWER_COSTS = {
  lance_battery: 5,
  orbital_muster: 6,
  seal_breaker: 4,
  surge_projector: 10,
} as const;

/** One-line effect for a building id, or an empty string for an unknown id. */
export function buildingEffect(buildingId: string): string {
  return BUILDING_DISPLAY[buildingId]?.effect ?? '';
}
