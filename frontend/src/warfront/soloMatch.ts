/**
 * The solo opponent: the lab's own policies, playing the other seats live.
 *
 * Decision 32 moved the bots into Slice A precisely so one person can play a full match
 * before any netcode exists. They are the SAME policies the lab measures, driven by the
 * same `BotDriver` on the same cadence — a bot that played differently when somebody was
 * watching would make every number the lab produces a statement about a game nobody plays.
 */

import {
  BotDriver,
  ColonistBot,
  RaiderBot,
  RusherBot,
  TurtleBot,
  buildOpening,
  buildProvinceGeography,
  type Bot,
  type Scenario,
  type TerrainGrid,
} from '@borderfall/warfront-sim';

export type PolicyName = 'colonist' | 'raider' | 'turtle' | 'rusher';

export interface PolicyChoice {
  name: PolicyName;
  label: string;
  /** One line on what this opponent does, shown where it is picked. */
  blurb: string;
}

/** The policies a player may be given, in the order they are offered. */
export const POLICIES: readonly PolicyChoice[] = [
  { name: 'colonist', label: 'Colonist', blurb: 'Expands as fast as the price allows, and defends.' },
  { name: 'raider', label: 'Raider', blurb: 'Early skirmishers, harassing the lumber camps.' },
  { name: 'turtle', label: 'Turtle', blurb: 'Towers and spears; never past three provinces.' },
  { name: 'rusher', label: 'Rusher', blurb: 'Builds a siege train and marches at minute six.' },
];

function build(name: PolicyName): Bot {
  switch (name) {
    case 'raider':
      return new RaiderBot();
    case 'turtle':
      return new TurtleBot();
    case 'rusher':
      return new RusherBot();
    case 'colonist':
    default:
      return new ColonistBot();
  }
}

export interface SoloSetup {
  /** Seats to open, including the human's. Two is Rome against Gaul, per decision 22. */
  seats: number;
  /** Which seat the human plays. */
  playerSeat: number;
  /** Policy per opposing seat, in seat order excluding the player's. */
  opponents: readonly PolicyName[];
}

export interface SoloMatch {
  scenario: Scenario;
  /** The seat the human plays, and the cell its capital stands on. */
  playerSeat: number;
  playerSeatCell: number;
  /** Seat index → display name, for the standings. */
  seatNames: Record<number, string>;
  /** Drives the opposing policies; hand it to `SimRunner.beforeTick`. */
  driver: BotDriver;
}

/**
 * Builds a solo match: the real opening, the human in one seat and a policy in each of
 * the others.
 *
 * Deterministic given the same seed and setup, so a match can be replayed — including
 * what the opponents did, because their orders go through the same command path a human's
 * do and therefore land in the replay.
 */
export function buildSoloMatch(grid: TerrainGrid, seed: number, setup: SoloSetup): SoloMatch {
  const { scenario, seats } = buildOpening(grid, { seats: setup.seats });
  const seatNames: Record<number, string> = {};
  for (const seat of seats) seatNames[seat.seat] = seat.name;

  const bots = new Map<number, Bot>();
  let next = 0;
  for (const seat of seats) {
    if (seat.seat === setup.playerSeat) continue;
    bots.set(seat.seat, build(setup.opponents[next] ?? 'colonist'));
    next += 1;
  }

  const player = seats.find((s) => s.seat === setup.playerSeat) ?? seats[0];
  return {
    scenario,
    playerSeat: player.seat,
    playerSeatCell: player.cell,
    seatNames,
    driver: new BotDriver(seed, bots, buildProvinceGeography(grid)),
  };
}
