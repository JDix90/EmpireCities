/**
 * @borderfall/warfront-sim — deterministic, headless simulation core for the
 * experimental Warfront RTS mode. See README.md for the integer-only convention and why
 * it exists. Nothing here touches the DOM, Node APIs, the clock or unseeded randomness.
 */

export * from './fixed';
export { Rng, mix32 } from './rng';
export { StateHasher } from './hash';
export { EntityStore, type Unit, type UnitInit } from './entities';
export { CommandQueue, validateCommand, type Command, type ScheduledCommand } from './commands';
export {
  Sim,
  replayHash,
  cellCentre,
  REPLAY_VERSION,
  NEAREST_PASSABLE_RADIUS,
  type Scenario,
  type SimOptions,
  type Replay,
} from './sim';
export * from './terrain';
export * from './rules';
export { TICK_RATE, COMMAND_DELAY_TICKS } from './constants';
export { BuildingStore, type Building, type BuildingInit } from './buildings';
export { PlayerStore, type Player, type PlayerInit } from './players';
export { stepEconomy, isAtWork, unitCellDistance, type EconomyContext } from './economy';
export { ProvinceStore, type Province } from './provinces';
export { colonisePrice, provinceAtUnit, stepTerritory, type TerritoryContext } from './territory';
export { stepCombat, effectiveRange, type CombatContext } from './combat';
export {
  laneKey,
  revealedLanes,
  sightingsFor,
  withinHops,
  type ConvoySighting,
  type RevealContext,
} from './reveal';
export {
  TribeStore,
  buildProvinceGeography,
  firstRaidTick,
  raidSize,
  stepTribes,
  type Raider,
  type TribeHome,
  type TribeContext,
  type ProvinceGeography,
} from './tribes';
export { FlowField, FlowFieldCache, COST_ORTHOGONAL, COST_DIAGONAL } from './flowField';
export {
  matchCapTicks,
  majorityOf,
  matchResult,
  standings,
  stepScoring,
  MATCH_CAP_MINUTES_TWO,
  MATCH_CAP_MINUTES_FOUR,
  type MatchResult,
  type MatchEnd,
  type Standing,
} from './scoring';
export { SEATS, buildOpening, seatCellOf, speedOf, type Opening, type OpeningOptions, type SeatDefinition } from './openings';
export {
  BOT_THINK_INTERVAL_TICKS,
  botSeed,
  botThinkOffset,
  cellOf,
  rngFor,
  shouldThink,
  viewFor,
  type Bot,
  type BotView,
} from './bot';
export { runMatch, type MatchOptions, type MatchOutcome } from './match';
export { BotDriver } from './botDriver';
export { ColonistBot, COLONIST_DEFAULTS, type ColonistParams } from './bots/colonist';
export { RaiderBot } from './bots/raider';
export { TurtleBot } from './bots/turtle';
export { RusherBot } from './bots/rusher';
export { SeafarerBot, MarinerBot, IslanderBot } from './bots/seafarer';
export {
  MetricsCollector,
  summarise,
  CONTACT_CELLS,
  type MatchMetrics,
  type Summary,
  type Tally,
} from './lab/metrics';
export {
  playOne,
  playBatch,
  permutations,
  seatFairness,
  type BatchOptions,
  type BatchResult,
  type BotFactory,
  type FairnessOptions,
  type FairnessResult,
  type FairnessRow,
} from './lab/run';
