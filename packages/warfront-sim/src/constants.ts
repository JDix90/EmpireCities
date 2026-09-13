/**
 * Core timing constants.
 *
 * These live apart from sim.ts so the rules and economy modules can read them without
 * importing the simulation itself, which imports them back.
 */

/** Simulation ticks per second (decision 29). */
export const TICK_RATE = 15;

/** Live commands execute this many ticks after they are issued (decision 29). */
export const COMMAND_DELAY_TICKS = 2;
