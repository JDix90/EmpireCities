# Galactic Age balance — measured state

Headless AI-vs-AI balance for the **64-territory** Galactic Age map
(`database/maps/era_galaxy.json`: 4 worlds × 16 territories, 8 hyperspace lanes
in a symmetric ring, 16 gateway tiles). Tool:
[`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

```sh
# from backend/ — the live create default for this era is threshold 60% + cap 90
# (games.routes.ts applyOrbitGatedVictoryDefaults), so this is the meaningful run:
SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=400 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-B \
  pnpm exec tsx scripts/simGalaxyBalance.ts        # confirm on a second seed
SIM_GAMES=400 pnpm exec tsx scripts/simGalaxyBalance.ts   # domination only
SIM_WORLD_RULES=0 SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts  # kill switch
SIM_MAP=/tmp/variant.json SIM_GAMES=200 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts  # knob sweep
```

Knobs: `SIM_MAP` (variant map file), `SIM_GAMES`, `SIM_DIFFICULTY`,
`SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`, `SIM_THRESHOLD`, `SIM_GRIND`,
`SIM_CORRIDORS`, `SIM_WORLD_RULES`. 4 players, one per galaxy faction,
faction↔seat rotated per game. Factions ON, naval OFF, era advancement OFF,
stability ON, seeded dice.

**Every table below is 400 games at expert with a 90-turn cap** unless a row says
200, measured on the Phase 4 tree (2026-09-09), seeds `borderfall-galaxy-balance`
(A) and `borderfall-galaxy-balance-B` (B). Each row is reproducible from the
commands above; nothing here is hand-copied from an older run.

## 1. What the harness mirrors, and the two bugs it had

- **The grind.** `processAiTurn` (sockets/gameSocket.ts) runs
  `runAiAttackExchanges` (ai/aiAttackGrind.ts): a turn-wide exchange budget — 8
  at expert, 16 once the game is decided — grinding one edge until it falls,
  drains, or the budget is gone. The sim used to resolve each planned attack as
  ONE exchange, which named the wrong faction as broken (it had Rust at 34% and
  Sol at 32%; the live AI had them at 14% and 41%). `SIM_GRIND=0` keeps the old
  behaviour only for that comparison.
- **The corridors.** Cross-lane attacks roll at most 2 attacker dice (3 with
  Lane Charts). The resolver only knows an edge is a lane if the caller passes
  the connection; the sim did not, so it silently measured the kill-switch game
  until `connectionsByKey` was threaded through. `SIM_CORRIDORS=0` is the
  kill switch.
- **Neutral off-world capture.** `executeLandAttack` refuses a neutral
  off-world tile unless the caller passes `neutralOffworldCaptureAllowed` after
  the orbit-access check (the socket does). The sim did not, so when the Vault
  arrived its Gate Ring was untouchable: **0 ring tiles taken in 400 games**
  and the Custodians read as 0% while live players could take it. Fixed the
  same way the socket does it. Anything measured on a neutral-start galaxy
  before that fix is wrong.

## 2. Where the era stands (Phase 4: corridors + worlds as characters)

Live defaults: corridors ON, world rules ON, threshold 60 + cap 90.

| Metric | threshold 60 (live default) A / B | domination only A |
|---|---|---|
| Avg game length | 33.8 / 32.4 turns | 55.0 turns |
| Decisive (not turn-limit) | **91.5% / 92.3%** | 70.3% |
| Territory-leader@turn-10 wins | 55.0% / 59.1% | 54.1% |
| Lane end-owner changes per game | 77.3 / 73.8 | 100.5 |
| Largest single-owner share per world at end | 11.2–12.7 of 16 | — |
| Vault (Gate Ring) held by someone at end | 70.0% / 72.8% | 88.5% |

| Faction | World | thr-60 A / B | dom A | eliminated (thr-60) A / B | holds the Vault at end A / B |
|---|---|---|---|---|---|
| stellar_mandate | Sol | 27.8% / 29.0% | 27.2% | 19.5% / 19.0% | 23.0% / 24.3% |
| forge_syndicate | Rust | 19.3% / 20.5% | 19.0% | 12.3% / 9.5% | 12.8% / 14.3% |
| helion_navigators | Verdan | 29.5% / 28.3% | 29.3% | 12.3% / 14.0% | 10.0% / 9.8% |
| void_custodians | Nexus | 23.5% / 22.3% | 24.5% | 12.8% / 14.0% | 24.3% / 24.5% |

Per-seat diagnostics (threshold 60, seed A):

| Faction | 1st cross-world capture (turn) | Lane exchanges → captures | Tiles @10 / @30 / end |
|---|---|---|---|
| stellar_mandate | 1.1 | 36.3 → 8.9 | 14.6 / 14.8 / 16.0 |
| forge_syndicate | 1.8 | 35.4 → 7.1 | 17.2 / 15.9 / 14.9 |
| helion_navigators | 1.1 | 32.9 → 8.0 | 18.9 / 17.8 / 17.9 |
| void_custodians | 5.9 | 18.5 → 5.2 | 13.3 / 15.5 / 15.2 |

### The gate

Phase 3/4 exit (grind-faithful sim, two seeds, live defaults): decisive ≥ 80%,
every faction within 18–32%, no faction eliminated in more than 30% of games,
lanes changing state at least six times per game. **All four hold on both
seeds.** The Vault is a real prize rather than a garrison the bots walk past:
somebody holds all four ring tiles at the end of seven games in ten, and it is
the Custodians (nearest) and Sol (two lanes onto Nexus) who take it most, at
roughly equal rates.

### Read

1. **Lanes are the board.** A lane's end-owner pair changes ~75 times per game
   under the threshold default and ~100 under domination; games are decided in
   ~33 turns instead of ~45 because gateway fights convert.
2. **The Custodians' identity is the Vault, not a home.** They start with 12 of
   16 tiles and must take the ring like everyone else; the `home_unit_bonus`
   below is what makes that a fair start (see §4).
3. **Forge is the weakest seat, at the band floor.** The Rust rule (buildings
   ×0.5, defence buildings +1 die) lifted it from 14–18% to 19–21%; its
   elimination rate fell from 42–49% (Phase 0) to ~10%.
4. **Helion swings least now** (28–30% across seeds, vs 16–23% before): the
   storms cap their stacks at 12 on Verdan, which happens to be exactly how the
   AI plays them anyway, and the Vault gives every faction a second objective.

## 3. What each phase moved

Measured under the threshold-60 default. Phase 0–1 rows are 400 games; Phase 3
rows 200; Phase 4 rows 400 (seed A / seed B).

| Phase | Sol | Rust | Verdan | Nexus | Decisive | Turns |
|---|---|---|---|---|---|---|
| 0 · grind-faithful harness, era as found | 41.3 / 37.3 | 13.8 / 8.8 | 16.0 / 22.8 | 29.0 / 31.3 | 86.5 / 84.8 | 45.4 |
| 1 · Nexus tech yield (0.0625) − Custodian reinforcement | ~39 | — | — | 29.5 / 32.0 | — | — |
| 3 · corridors: no gate, lane cap 2/3, kits rebuilt | 22.5 / 22.0 | 14.5 / 18.0 | 32.0 / 30.5 | 31.0 / 29.5 | 93.0 / 91.5 | ~32 |
| 4 · worlds as characters (this tree) | 27.8 / 29.0 | 19.3 / 20.5 | 29.5 / 28.3 | 23.5 / 22.3 | 91.5 / 92.3 | 33.8 / 32.4 |
| 4 with `SIM_WORLD_RULES=0` (kill switch, seed A) | 24.5 | 16.8 | 27.3 | 31.5 | 91.3 | 32.6 |

The kill switch restores the Phase 3 shape (Rust keeps its halved building
cost, which is a modifier, not a rule), so an operator flipping
`galaxy_world_rules_enabled` off gets a balanced game, not the pre-corridor one.

## 4. Tuning the Vault — what was tried

The plan's numbers carried two ⚠ balance knobs on Nexus (the ring garrison and
whether the world keeps its modifiers/region bonuses) and one on Verdan (the
storm threshold). 200 games, seed A, threshold 60, unless noted:

| Variant | Sol | Rust | Verdan | Nexus | Vault held at end |
|---|---|---|---|---|---|
| numeric modifiers cut, Nexus regions pay 0, garrison 6 (plan as written) | 40.0 | 9.5 | 50.0 | **0.5** | 0% (harness bug) |
| modifiers + region bonuses restored, garrison 6 | 34.0 | 31.5 | 18.0 | 16.5 | 74.5% |
| garrison 4 | 41.5 | 21.5 | 23.5 | 13.5 | 66.5% |
| garrison 8 | 33.5 | 26.5 | 20.5 | 19.5 | 74.0% |
| garrison 6 + `home_unit_bonus: 1` (shipped) | 31.0 | 21.5 | 25.0 | 22.5 | 68.5% |
| … same, seed B | 26.0 | 19.5 | 31.5 | 23.0 | 73.5% |

What the sweep says: the numeric world modifiers are load-bearing income, not
decoration — cutting them (the plan's "replace four invisible decimals") sent
Forge to 9.5% and the Custodians to nothing, so the rules ship **alongside** the
modifiers and Nexus keeps its region bonuses (a home that pays nothing is a
12-tile handicap, not a prize). Garrison size mostly moves Sol, which crosses
onto Nexus by two lanes: lower it and Sol takes the ring; raise it and nobody
does. The lever that fixes the seat without moving the prize is the start
itself — the Custodians begin without the ring's 4 tiles (12 units and a region
bonus), and one extra unit on each of their 12 tiles (`vault.home_unit_bonus`)
restores parity: 48 units, like every other world.

## 5. Open, and owned by the era plan

- **Forge sits at the floor of the band (19–21%).** Phase 6's Jump Gates (half
  price for the Syndicate) are the next lever that is theirs alone.
- **Sol still snowballs from the top**: the turn-10 leader wins 55–59% of games
  (25% baseline). Lane Sovereignty (Phase 5) gives the other seats a way to end
  a game the headcount would hand to Sol.
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows: the one-faction-per-world start fires only for four
  seats with four distinct factions, and the Vault start assumes it.

## History

- **2026-09-09, main @ 0f1a19a (Phase 0/1):** grind-faithful harness; Nexus
  tech yield 0.05 → 0.0625 (it floored to zero), paid for by the Custodians'
  reinforcement. Sol 41 → 39, Custodians 18 → 30.
- **Pre-fix baseline (obsolete):** measured on the pre-densification map with
  the single-exchange harness — stellar_mandate 2.0% / 1.2%, forge_syndicate
  36% / 33%, helion_navigators 35% / 41%, void_custodians 27% / 25%; ~45% of
  games hit the cap. The diagnosis then (Sol hubbed by 6 lanes, no economic
  passive) drove the ring and modifier changes.
