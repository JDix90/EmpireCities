/**
 * The Warfront lab.
 *
 * Plays batches of headless matches and prints the numbers the brief's design-question
 * table asks for. Nothing here asserts: a metric that misses its target is a finding to
 * act on, and CI's job is the invariants that must hold of any correct simulation
 * (src/lab/invariants.test.ts), not of a well-balanced one.
 *
 *   pnpm -C packages/warfront-sim run lab -- --matches 20
 *   pnpm -C packages/warfront-sim run lab -- --fairness --seats 4 --repeats 2
 *   pnpm -C packages/warfront-sim run lab -- --matchup colonist,rusher --minutes 12
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TerrainGrid, type TerrainAsset } from '../src/terrain';
import { buildProvinceGeography } from '../src/tribes';
import { playBatch, seatFairness, type BotFactory } from '../src/lab/run';
import { ColonistBot } from '../src/bots/colonist';
import { RaiderBot } from '../src/bots/raider';
import { TurtleBot } from '../src/bots/turtle';
import { RusherBot } from '../src/bots/rusher';
import { TICKS_PER_MINUTE } from '../src/rules';
import type { Summary } from '../src/lab/metrics';

const ROOT = join(__dirname, '..', '..', '..');
const ASSET = join(ROOT, 'database/warfront/western_twenty.terrain.json');

const FACTORIES: Record<string, BotFactory> = {
  colonist: () => new ColonistBot(),
  raider: () => new RaiderBot(),
  turtle: () => new TurtleBot(),
  rusher: () => new RusherBot(),
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printSummary(label: string, summary: Summary): void {
  const line = (k: string, v: string) => process.stdout.write(`  ${k.padEnd(32)} ${v}\n`);
  process.stdout.write(`\n${label} — ${summary.matches} matches\n`);
  line('ended on the clock', `${summary.endedOnClockPercent}%  (brief wants >= 33% at four seats)`);
  line(
    'median first contact',
    summary.medianFirstContactSeconds === null
      ? 'never'
      : `${summary.medianFirstContactSeconds}s  (brief wants 240-480s)`,
  );
  line('median economy ratio at 15m', `${summary.medianEconomyRatio / 100}x  (brief wants < 2x)`);
  line(
    'earliest elimination',
    summary.earliestEliminationSeconds === null
      ? 'none'
      : `${summary.earliestEliminationSeconds}s  (brief wants none before 720s outside rushes)`,
  );
  line('seats that raised no economy', `${summary.seatMatchesWithoutEconomy}  (must be 0: a seat that built nothing is not playing)`);
  line(
    'seats that colonised at all',
    `${summary.colonisedPercent}%  (${summary.seatMatchesThatColonised}/${summary.seatMatches} — rule I is untested at 0%)`,
  );
  line('matches where every economy died', String(summary.economicWipeouts));
  line(
    'earliest economy wiped out',
    summary.earliestWipeoutSeconds === null ? 'none' : `${summary.earliestWipeoutSeconds}s`,
  );
  for (const [policy, tally] of Object.entries(summary.byPolicy)) {
    line(`win rate: ${policy}`, `${tally.winPercent}%  (${tally.won}/${tally.played})`);
  }
}

function main(): void {
  const grid = TerrainGrid.decode(JSON.parse(readFileSync(ASSET, 'utf8')) as TerrainAsset);
  const geography = buildProvinceGeography(grid);
  const minutes = Number(arg('minutes', '25'));
  const maxTicks = TICKS_PER_MINUTE * minutes;

  if (flag('fairness')) {
    const seats = Number(arg('seats', '4'));
    const repeats = Number(arg('repeats', '1'));
    const result = seatFairness({
      terrain: grid,
      geography,
      policy: FACTORIES[arg('policy', 'colonist') as string] ?? FACTORIES.colonist,
      seats,
      repeats,
      baseSeed: Number(arg('seed', '20260913')),
      maxTicks,
    });
    process.stdout.write(`\nseat fairness — ${result.matches} matches, same policy in every seat\n`);
    for (const row of result.rows) {
      process.stdout.write(`  ${row.name.padEnd(10)} ${String(row.winPercent).padStart(3)}%  (${row.won}/${row.played})\n`);
    }
    process.stdout.write(`  spread ${result.spreadPercent} points  (brief wants no seat above 55%)\n`);
    printSummary('fairness batch', result.summary);
  } else {
    const names = (arg('matchup', 'colonist,colonist') as string).split(',');
    const policies = new Map<number, BotFactory>();
    names.forEach((n, i) => {
      const factory = FACTORIES[n.trim()];
      if (!factory) throw new Error(`unknown policy "${n}" — try ${Object.keys(FACTORIES).join(', ')}`);
      policies.set(i + 1, factory);
    });
    const count = Number(arg('matches', '10'));
    const base = Number(arg('seed', '20260913'));
    const seeds = Array.from({ length: count }, (_, i) => base + i);
    const result = playBatch({ terrain: grid, geography, policies, seeds, maxTicks });
    printSummary(`matchup ${names.join(' vs ')}`, result.summary);
  }

  // No elapsed-time readout here on purpose. The package's determinism lint bans reading a
  // clock, and carving out an exemption for "it is only a report" is how one finds its way
  // back into something that matters — the same argument as percentOf in lab/metrics.ts.
  // `time pnpm run lab` answers the question without needing the exception.
}

main();
