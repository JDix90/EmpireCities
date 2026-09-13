# @borderfall/warfront-sim

Deterministic, headless simulation core for the **experimental** Warfront RTS mode
([docs/WARFRONT_RTS_MODE.md](../../docs/WARFRONT_RTS_MODE.md), §10 Engineering). Pure
TypeScript: no DOM, no Node APIs, no runtime dependencies. One package, three hosts —
the match host runs it, a browser re-runs it for replays, and the headless lab runs it
at 100× speed. Nothing in here touches the existing turn-based game.

Step 1 of Slice A ships exactly this much: 16.16 fixed-point maths, a seeded generator,
a 15 tick/s loop with commands stamped two ticks ahead, a small entity store, one
command (`move`), a terrain cell grid and flow-field pathing over it. Combat, economy,
buildings, bots, rendering and netcode are later steps and are not started here.

## The one convention: every simulated quantity is an integer

A replay is a **seed plus a command log**. The match host, a replaying client and the
lab must all arrive at the same state from those two inputs, on different machines,
different browsers and different CPUs. That only holds if every operation on the state
is bit-for-bit reproducible everywhere:

- IEEE-754 `+ - * /` are correctly rounded and therefore reproducible — but only while
  the operands are exact. Integers below 2^53 are exact; `0.1` is not.
- `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`, `Math.log` and friends are **not**
  required to be correctly rounded. Engines differ in the last bit, and so do CPU
  generations.
- `Math.random`, `Date.now` and `performance.now` are inputs the command log does not
  record, so any state that depends on them cannot be replayed at all.

One float, or one unseeded call, does not crash anything. It makes two hosts disagree by
one bit that compounds over thousands of ticks, and the symptom is "the replay desynced
at minute nine" with nothing in the log to explain it. The brief calls those bugs
miserable to find; they are also miserable to *notice*, because the lab keeps producing
numbers that are simply wrong. So the package refuses the input at lint time instead of
debugging it at replay time.

Concretely:

- Fractions are **16.16 fixed point** (`src/fixed.ts`): an integer whose low 16 bits are
  the fraction, so `1.0` is `FP_ONE = 65536`. Multiply with `fpMul`, divide with `fpDiv`
  / `idiv`, take roots with `isqrt` / `fpSqrt` / `fpLength`. All of them are exact
  integer operations kept under 2^53.
- Fixed values must fit in a signed 32-bit integer. That is what keeps every
  intermediate product exact. Positions are in cell units, so ±32768 cells is the
  world limit — far more than the western-twenty grid needs.
- Randomness comes from `Rng` (`src/rng.ts`), seeded from the match seed and part of
  the hashed state. Use `fork(streamId)` for a subsystem that must not perturb others.
- Time is the tick counter. `TICK_RATE = 15`, `COMMAND_DELAY_TICKS = 2`.

### Enforced by lint

The root [eslint.config.mjs](../../eslint.config.mjs) carries two blocks for this
package, run by `pnpm run lint:warfront` (part of `pnpm run lint` and of CI):

| Scope | Banned |
|---|---|
| every `.ts` in the package, tests included | `Math.random`, `Date.now`, `performance.now`, `new Date()` / `Date()` |
| `src/**` except `*.test.ts` | float literals (`0.5`), the `/` and `**` operators, `Math.sqrt / sin / cos / tan / atan / atan2 / exp / log / pow / hypot / cbrt / fround` |

`src/fixed.ts` is the one file allowed to divide (it carries a file-level disable with
the reason). Tests are exempt from the second block only, because they compute BigInt
references and float bounds to check the integer code against.

## Golden replays

`golden/*.json` fixtures hold a seed, a scenario, a command log, a tick count and the
hash the final state must have. `src/golden.test.ts` runs each fixture **twice from
scratch** and compares both runs to each other and to the fixture. This is the
regression net for every later step: a change that alters a hash is a replay-format
break and must be deliberate.

- Run: `pnpm run test:warfront` (from the repo root) or `pnpm test` here.
- Regenerate on purpose: `pnpm run golden:update` in this directory, then explain the
  new hashes in the PR.

The hash (`src/hash.ts`) digests tick, RNG state, every entity and every pending
command — the complete state — so two sims that agree on the hash agree on everything a
replay can observe.

## Terrain and pathing

`src/terrain.ts` decodes the cell-grid asset the offline pipeline produces
(`frontend/scripts/buildWarfrontTerrain.ts` → `database/warfront/western_twenty.terrain.json`,
run with `pnpm run build:warfront-terrain` from the repo root). One uint16 per cell:
owner province, elevation tier, passability, biome, and ford / beach / pass flags; rows
are run-length encoded and the file carries a checksum from this package's own hasher,
re-checked on decode. `TerrainGrid.cellForLngLatE6` maps micro-degree lon/lat to a cell
with exact integer arithmetic, for hosts that need to place things geographically.

**Where the asset lives, and why:** `database/warfront/`. Three consumers read it — the
match host (the backend already resolves `database/` by path for map documents), the lab
(Node), and the client. `frontend/public/` would have been the obvious place for the
client, but everything under it is served to every anonymous visitor, and every Warfront
surface is admin-only until further notice. The client therefore fetches the asset
through an admin-guarded endpoint, and nothing Warfront sits on the public web root.
Only `database/warfront/curated/` is hand-edited (passes, forest mask, river list);
`sources/` holds bbox-trimmed Natural Earth extracts the script fetches once, and the
terrain file itself is generated — never edit it by hand.

`src/flowField.ts` is Dijkstra from the target cell over passable cells (orthogonal 10,
diagonal 14, no corner cutting past a blocked orthogonal), **resumable**: a field runs
only until the cells its followers stand on are settled. The heap breaks ties by cell
index, so every `next` pointer is a pure function of (grid, target) and a field extended
later agrees with one built in a single sweep — the property that lets the match host and
a replaying client share nothing but the seed and the log. A unit ordered onto an
impassable cell is redirected to the nearest passable one by a fixed ring scan; an order
nothing can reach is dropped, and a unit whose goal proves unreachable simply stops.

The terrain golden fixture (`golden/terrain-alps-pass-and-loire-ford.json`) runs on the
committed asset and names its checksum; `Sim.fromReplay` refuses any other grid.
`src/sim.terrain.test.ts` asserts what the hash only pins: the Milan → Augsburg unit
walks a Brenner pass cell and the Le Mans → Poitiers unit crosses the Loire on a ford.

## API sketch

```ts
import { Sim, fromInt, fpRatio } from '@borderfall/warfront-sim';

const sim = new Sim({
  seed: 20260913,
  scenario: { units: [{ owner: 1, x: fromInt(2), y: fromInt(2), speed: fpRatio(1, 4) }] },
});
sim.issue({ type: 'move', unit: 1, x: fromInt(9), y: fromInt(4) }); // stamped tick + 2
sim.run(60);
sim.hash();        // '…16 hex chars…'
sim.toReplay();    // { version, seed, scenario, commands } — plain integers, JSON-safe
```

`Sim.fromReplay(replay, terrain?)` rebuilds the match at tick 0 with every command
pre-scheduled; `replayHash(replay, ticks, terrain?)` is the one-liner the golden tests use.
Pass `terrain: TerrainGrid.decode(asset)` to `new Sim(...)` for flow-field movement.

## Working on it

- Like `packages/shared`, this resolves from its built `dist/` — after a fresh checkout,
  branch switch or rebase: `pnpm -C packages/warfront-sim run build`.
- `pnpm -C packages/warfront-sim run typecheck` checks sources **and** tests
  (`tsconfig.test.json`); the build config excludes tests and pulls in no Node types, so
  the published code cannot accidentally depend on `fs` or `process`.
