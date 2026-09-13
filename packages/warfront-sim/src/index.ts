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
  TribeStore,
  buildProvinceGeography,
  raidSize,
  stepTribes,
  type Raider,
  type TribeHome,
  type TribeContext,
  type ProvinceGeography,
} from './tribes';
export { FlowField, FlowFieldCache, COST_ORTHOGONAL, COST_DIAGONAL } from './flowField';
