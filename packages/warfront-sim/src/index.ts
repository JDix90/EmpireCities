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
  TICK_RATE,
  COMMAND_DELAY_TICKS,
  NEAREST_PASSABLE_RADIUS,
  type Scenario,
  type SimOptions,
  type Replay,
} from './sim';
export * from './terrain';
export { FlowField, FlowFieldCache, COST_ORTHOGONAL, COST_DIAGONAL } from './flowField';
