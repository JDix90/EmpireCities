# Galactic Age balance — measured state

Headless AI-vs-AI balance for the **64-territory** Galactic Age map
(`database/maps/era_galaxy.json`: 4 worlds × 16 territories, 8 orbit lanes in a
symmetric ring). Tool: [`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

```sh
# from backend/ — the live create default for this era is threshold 60% + cap 90
# (games.routes.ts applyOrbitGatedVictoryDefaults), so this is the meaningful run:
SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=400 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-B \
  pnpm exec tsx scripts/simGalaxyBalance.ts        # confirm on a second seed
SIM_GAMES=400 pnpm exec tsx scripts/simGalaxyBalance.ts   # domination only
SIM_GRIND=0 SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
```

Knobs: `SIM_GAMES`, `SIM_DIFFICULTY`, `SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`,
`SIM_THRESHOLD`, `SIM_GRIND`. 4 players, one per galaxy faction, faction↔seat
rotated per game. Factions ON, naval OFF, era advancement OFF, seeded dice.

**Every table below is 400 games at expert with a 90-turn cap**, measured on
`main` @ `0f1a19a` (2026-09-09), seeds `borderfall-galaxy-balance` (A) and
`borderfall-galaxy-balance-B` (B). Each row is reproducible from the commands
above; nothing here is hand-copied from an older run.

## 1. The harness must run the AI production runs

`playAiTurn` used to resolve **each planned attack as one dice exchange**. The
live AI does not: `processAiTurn` (sockets/gameSocket.ts) runs
`runAiAttackExchanges` (ai/aiAttackGrind.ts), which spends a turn-wide exchange
budget — 8 at expert, 16 once the game is decided — **grinding one edge until it
falls, drains, or the budget is gone**, then skips the rest of the plan. The
grind exists because attacking each edge once "left any 3+ unit territory
uncapturable by the AI"; the flag `ai_attack_grind_enabled` defaults ON.

So the old harness measured an AI nobody plays against, and it **named the wrong
faction as broken**. Same seeds, same settings, threshold 60:

| Faction | World | `SIM_GRIND=0` (old harness) A / B | Default (mirrors live AI) A / B |
|---|---|---|---|
| stellar_mandate | Sol | 31.8% / 32.8% | **41.3% / 37.3%** |
| forge_syndicate | Rust | **34.3% / 33.3%** | **13.8% / 8.8%** |
| helion_navigators | Verdan | 13.3% / 14.3% | 16.0% / 22.8% |
| void_custodians | Nexus | 20.8% / 19.8% | 29.0% / 31.3% |
| Decisive wins | | 56.3% / 57.0% | 86.5% / 84.8% |
| Avg game length | | 69.9 / 67.7 turns | 45.4 / 45.4 turns |

Read the old numbers and you would tune Rust down and Sol up — both backwards.
`SIM_GRIND=0` is kept only to reproduce this comparison.

## 2. Where the era stands today

| Metric | threshold 60 (live default) A / B | domination only A / B |
|---|---|---|
| Avg game length | 45.4 / 45.4 turns | 69.8 / 70.6 turns |
| Decisive (not turn-limit) | **86.5% / 84.8%** | 54.3% / 52.0% |
| Territory-leader@turn-10 wins | 41.2% / 44.1% | 37.9% / 39.9% |
| Largest single-owner share per world at end | 12.3–13.6 of 16 | 14.1–14.7 of 16 |

| Faction | World | thr-60 A / B | dom A / B | eliminated (thr-60) A / B |
|---|---|---|---|---|
| **stellar_mandate** | Sol | **41.3% / 37.3%** | 41.3% / 40.3% | 6.0% / 5.8% |
| **forge_syndicate** | Rust | **13.8% / 8.8%** | 14.3% / 8.8% | **42.5% / 48.8%** |
| helion_navigators | Verdan | 16.0% / 22.8% | 14.5% / 19.0% | 15.8% / 10.8% |
| void_custodians | Nexus | 29.0% / 31.3% | 30.0% / 32.0% | 27.0% / 23.5% |

Per-seat diagnostics (threshold 60, seed A):

| Faction | Chart turn | 1st cross-world capture | Lane exchanges → captures | Tiles @10 / @30 / end |
|---|---|---|---|---|
| stellar_mandate | 1.0 | 10.6 | 58.7 → 7.0 | 16.1 / 18.6 / 23.4 |
| forge_syndicate | 1.0 | 6.5 | 33.5 → 5.6 | 15.5 / 10.9 / 9.5 |
| helion_navigators | — (free) | 5.4 | 55.9 → 6.1 | 17.2 / 17.7 / 14.8 |
| void_custodians | 1.0 | 4.7 | 74.3 → 8.8 | 15.1 / 16.9 / 16.3 |

### Read

1. **The era is decisive under its live defaults** — ~86% of games end by
   threshold in ~45 turns. Domination alone still stalls half the time, so the
   threshold + cap defaults are load-bearing, not a backstop.
2. **Sol is the strongest seat, not the death trap the old baseline described.**
   The Mandate's −2 on every tech compounds across a tree whose tier 2–4 nodes
   are mostly dice (+1/+2/+2 attack, +1/+1/+1 defence), and once the AI grinds
   edges those dice convert.
3. **Rust is the seat that dies** — eliminated in 42–49% of games. Forge's kit is
   economic (production ×1.4, buildings ×0.8, +1 reinforcement) and the AI cannot
   turn production into survival. Rust and Sol have identical ring positions, so
   the gap is kit, not topology.
4. **The hyperspace "race" is zero turns long.** Starting tech points (3) plus
   the opening income tick already cover the 5-point Chart, so every non-Helion
   seat buys it on turn 1. Helion's signature perk is worth 5 tech points, once.
5. **Tech income is the most leveraged lever in the era** — see below.

## 3. Nexus Station's tech yield, and what it cost

Nexus advertised `tech_bonus: 0.05`. `collectProduction` floors the per-world
accumulation, and 16 × 0.05 = 0.8 → **0**: a fully held Nexus paid nothing, ever.
Making it pay is not a small correction. Measured 200 games × 2 seeds
(expert, threshold 60), Void Custodians' win rate against the value:

| `tech_bonus` | Tech/turn at full hold | Custodians A / B |
|---|---|---|
| 0.05 (the bug) | 0 | 17.5% / 20.0% |
| 0.0625 | 1 | 38.0% / 40.5% |
| 0.09375 | 1 (0.5 wasted) | 42.5% / 49.0% |
| 0.125 | 2 | 58.0% / 55.8% |

Flooring means the smallest *paying* value is +1 tech point per turn, and that
alone is worth roughly twenty points of win rate. The shipped fix is
**`0.0625` paired with dropping the Custodians' flat `reinforce_bonus: 1`** —
the spare reinforcement pays for the identity. That lands them at 29.0 / 31.3
and pulls Sol down from 47% to ~39% by giving it a real rival, at the cost of a
higher elimination rate for Rust. The world modifier is a placeholder for the
Vault rule in Phase 4 of the era plan, which replaces it with a region objective.

## 4. Open, and owned by the era plan

- **Rust dies and Sol leads.** Both are kit problems the corridor work (Phase 3)
  and the per-world rules (Phase 4) target; no numeric tweak here fixes them.
- **Helion swings 16–23% across seeds**, the widest spread of the four. Its perk
  is worth one tech purchase, so its results are mostly the seat's, not the kit's.
- **Only four-player games are measured**, because that is the only shape the
  create boundary now allows: the one-faction-per-world start
  (`tryDistributeGalaxyAgeFactionHomeworlds`) fires only for four seats with four
  distinct factions, and every other shape scattered each seat across worlds it
  could not reach.

## History — pre-fix baseline (obsolete, kept for the record)

Measured on the pre-densification map, before the symmetric ring, per-world
modifiers, contestable lanes and the Mandate discount, using the single-exchange
harness: stellar_mandate **2.0% / 1.2%**, forge_syndicate 36% / 33%,
helion_navigators 35% / 41%, void_custodians 27% / 25%; territory-leader@10 won
62%; avg peak spread 50/64; ~45% of games hit the cap. The diagnosis then (Sol
hubbed by 6 lanes, no economic passive) drove the ring and modifier changes.
Those shipped; the document was not re-measured until 2026-09-09.
