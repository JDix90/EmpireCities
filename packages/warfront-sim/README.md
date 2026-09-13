# @borderfall/warfront-sim

Deterministic, headless simulation core for the **experimental** Warfront RTS mode
([docs/WARFRONT_RTS_MODE.md](../../docs/WARFRONT_RTS_MODE.md), §10 Engineering). Pure
TypeScript: no DOM, no Node APIs, no runtime dependencies. One package, three hosts —
the match host runs it, a browser re-runs it for replays, and the headless lab runs it
at 100× speed. Nothing in here touches the existing turn-based game.

What exists: 16.16 fixed-point maths, a seeded generator, a 15 tick/s loop with commands
stamped two ticks ahead, an entity store, a terrain cell grid with flow-field pathing
over it, and from step 3 an economy — resources, buildings, villagers assigned to jobs,
upkeep and starvation. Combat, colonisation, tribes, bots and netcode are later steps and
are not started here.

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

## The economy (step 3, rule II)

`rules.ts` holds **every tunable number in one place**, because the brief is explicit
that its economy figures exist so a harness has something to disagree with and that none
should survive a thousand simulated matches unchanged. The lab sweeps that file; it does
not hunt through the rules code.

Rates are written **per minute**, never per tick. A farmer's 12 food a minute is 12/900 a
tick, which is not an integer and so cannot live in state. Instead each tick adds the
per-minute rate to an accumulator and whole units are flushed at `TICKS_PER_MINUTE`. Over
900 ticks a farmer delivers exactly 12 food on every machine, and there is no rounding
residue to drift a replay apart. A test asserts the brief's own arithmetic: one farmer
nets exactly 9 food a minute after eating.

`economy.ts` runs a fixed order every tick — construction, gathering, training, upkeep,
population — and the order is part of the rules, not an accident: gathering before upkeep
means a farm can feed the villager working it within the same tick.

Two things terrain decides, which is rule IV feeding rule II: a farm needs plains, a
lumber camp forest, a mine hills, so **where** you settle decides **what** you can build;
and a worker earns only while it is standing at its building, so walking there costs real
time.

## Combat and tribes (step 3, rules III and VI)

Combat is **auto-attack, not ordered attack**: anything in range of an enemy strikes it on
its own cadence. That is what lets rule VI work at all — raiders reach your villagers and
the fighting starts without anyone clicking. The triangle is spear → cavalry → archer →
spear at double damage, the skirmisher doubles on villagers and halves on every soldier,
and a ram damages buildings and nothing else. Terrain *modifies* the triangle rather than
adding to it: an archer on high ground reaches one cell further, and that is the whole of
it. No formations, no morale, no healing.

Seats and towers **fire on their own** at the brief's 8 damage a second over 6 cells,
which is what makes rule III more than bookkeeping: a lone ram walking up to a seat dies
at tick 211 having taken 450 off 1500, so a seat costs about four rams or one ram with an
escort to pull the tower.

`tribes.ts` is rule VI. Every province is a tribe's home until somebody settles it;
colonising the home ends that source for free, because a settled province is not neutral
and so musters nothing. Raids **muster on the frontier** — `buildProvinceGeography` derives
land adjacency and per-pair border cells from the grid in one pass, needing no map
document — and aim at the victim's nearest producing building, which is where the
villagers are. They loot, they retreat, and the tribe keeps no standing army between
raids. Raid size grows with the clock *and* with the victim's holdings, which is the
anti-turtle half of the rule.

**Pace is not cosmetic.** `UNIT_SPECS.speedPerMinute` is derived from the committed asset,
not guessed: at 4 km cells a seat sits 53-82 cells from its frontiers, and the brief wants
a first colony around minute two, which fixes a villager at ~54 cells a minute. The first
pass was six times slower and rule VI was a dead letter — raiders could not reach anything
before their raid expired, so they piled up on the map and no villager was ever in danger.

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
Pass `terrain: TerrainGrid.decode(asset)` to `new Sim(...)` for flow-field movement, and a
scenario carrying `players` and `buildings` to give the match an economy.

**Replay format version 3.** The version is bumped whenever the hashed state changes
shape — 2 added the economy, 3 added combat cooldowns and the tribes — because an older
replay would hash differently than it recorded. `fromReplay` refuses it with a clear error
rather than replaying it to a quietly different answer: a replay that disagrees with
itself is exactly the failure this package exists to prevent.

## Working on it

- Like `packages/shared`, this resolves from its built `dist/` — after a fresh checkout,
  branch switch or rebase: `pnpm -C packages/warfront-sim run build`.
- `pnpm -C packages/warfront-sim run typecheck` checks sources **and** tests
  (`tsconfig.test.json`); the build config excludes tests and pulls in no Node types, so
  the published code cannot accidentally depend on `fs` or `process`.
