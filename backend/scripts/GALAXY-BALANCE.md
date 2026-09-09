# Galactic Age balance — measured state

Headless AI-vs-AI balance for the **64-territory** Galactic Age map
(`database/maps/era_galaxy.json`: 4 worlds × 16 territories, 8 orbit lanes in a
symmetric ring). Tool: [`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

```sh
# from backend/
pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=400 SIM_DIFFICULTY=expert SIM_MAX_TURNS=90 pnpm exec tsx scripts/simGalaxyBalance.ts
# live create default for the era is threshold 60% + max_turns 90 (games.routes.ts
# applyOrbitGatedVictoryDefaults) — mirror it with:
SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
```

Knobs: `SIM_GAMES`, `SIM_DIFFICULTY`, `SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`,
`SIM_THRESHOLD`. 4 players, one per galaxy faction, faction↔seat rotated per game.
Factions ON, naval OFF, era advancement OFF, seeded combat dice. Every table
below: **400 games, expert, maxTurns 90**, measured on `main` @ `c9a78ed`
(2026-09-09), seeds `borderfall-galaxy-balance` (A) and
`borderfall-galaxy-balance-B` (B).

> **The numbers that used to be here (Sol 2% / 62% snowball / 50-tile spread)
> were the pre-fix baseline and are obsolete.** They are kept at the bottom under
> *History* for the record only.

## 1. What the committed harness reports today

| Metric | domination only, A / B | threshold 60 (live default), A / B |
|---|---|---|
| Avg game length | 90.1 / 89.2 turns | 69.1 / 68.6 turns |
| Decisive (not turn-limit) | **4.8% / 9.5%** | 57.0% / 56.3% |
| Territory-leader@turn-10 win rate | 22.2% / 28.7% | 22.9% / 29.8% (no snowball) |
| Avg peak territory spread | 38.5 / 39.4 of 64 | 32.0 / 31.8 |

| Faction | World | dom-only A / B | threshold-60 A / B |
|---|---|---|---|
| stellar_mandate | Sol | 29.0% / 32.5% | 28.8% / 32.8% |
| forge_syndicate | Rust | **36.3% / 34.3%** | **36.0% / 33.8%** |
| helion_navigators | Verdan | **11.8% / 14.0%** | **12.8% / 13.8%** |
| void_custodians | Nexus | 23.0% / 19.3% | 22.5% / 19.8% |

Read at face value this says: Sol is fixed, Helion is now the broken faction,
and the era stalemates (95% of domination-only games hit the cap).

## 2. Why those numbers cannot be trusted: the harness does not grind

`playAiTurn` in `simGalaxyBalance.ts` resolves **each planned attack as exactly
one dice exchange**. The live AI does not: `processAiTurn` in
`sockets/gameSocket.ts` runs `runAiAttackExchanges` (`ai/aiAttackGrind.ts`),
which spends a turn-wide exchange budget (8 at expert, 16 once the game is
decided) **grinding one edge until it falls, drains, or the budget is gone**, and
skips the remaining planned edges once the budget is spent. The grind flag
`ai_attack_grind_enabled` defaults ON. The comment in `gameSocket.ts` says why
it exists: attacking each planned edge once "left any 3+ unit territory
uncapturable by the AI". That is exactly the AI the committed sim still runs.

Measured consequence (instrumented copy of the harness, same seeds, same
settings, threshold 60): the committed loop converts ~6% of cross-lane
exchanges into captures (3.9 captures / 62.5 attacks per Mandate seat per game);
the live grind loop converts ~10% and captures roughly twice as many tiles per
game — and the **faction ranking inverts**.

## 3. What the live AI actually does (grind-faithful re-measurement)

Same harness with the attack loop replaced by the live grind semantics
(`aiAttackExchangeBudget`, `shouldContinueGrind`, `shouldPressDecidedGame`
imported from `ai/aiAttackGrind.ts`; remaining planned edges skipped at budget
0). This variant is **not yet committed** — folding it into
`simGalaxyBalance.ts` is the first recommended follow-up, since a balance sim
that runs a weaker AI than production reports the wrong faction as broken.

| Metric | domination only, A / B | threshold 60 (live default), A / B |
|---|---|---|
| Avg game length | 71.9 / 69.6 turns | **43.6 / 42.5 turns** |
| Decisive | 51.5% / 56.8% (all `last_standing`) | **87.5% / 89.3%** (`threshold`) |
| Largest single-owner share per world at end | 14.3–14.7 of 16 | 12.4–14.1 of 16 |

| Faction | World | dom-only A / B | threshold-60 A / B | eliminated (thr-60) A / B |
|---|---|---|---|---|
| **stellar_mandate** | Sol | **47.3% / 46.3%** | **47.5% / 43.0%** | 3.0% / 4.3% |
| **forge_syndicate** | Rust | **9.8% / 9.8%** | **8.0% / 8.8%** | **41.3% / 44.0%** |
| helion_navigators | Verdan | 24.5% / 22.0% | 27.0% / 28.0% | 9.8% / 9.0% |
| void_custodians | Nexus | 18.5% / 22.0% | 17.5% / 20.3% | 39.0% / 35.8% |

Per-faction diagnostics (threshold 60, seed A, per seat per game):

| Faction | Chart researched on turn | First cross-world capture | Cross-lane exchanges → captures | Tiles @10 / @30 / end |
|---|---|---|---|---|
| stellar_mandate | 1.0 | turn 8.6 (97.5% of games) | 69.3 → 7.1 | 16.7 / 22.4 / 26.0 |
| forge_syndicate | 1.0 | turn 5.8 (84.8%) | 46.6 → 6.1 | 15.1 / 11.5 / 8.5 |
| helion_navigators | — (free) | turn 6.4 (97.5%) | 58.7 → 5.8 | 17.5 / 18.4 / 19.1 |
| void_custodians | 1.0 | turn 4.4 (92.8%) | 57.5 → 7.6 | 14.6 / 11.8 / 10.5 |

### Read

1. **The era is decisive under the live default** (threshold 60 + cap 90): ~88%
   of games end by threshold in ~43 turns. Domination-only still stalls in half
   the games — the cap and threshold defaults are load-bearing, not a backstop.
2. **Sol is the dominant seat, not the death trap.** The Mandate's `-2` on every
   tech node compounds across a 10-node tree whose tier 2–4 nodes are mostly
   attack/defense dice (+1/+2/+2 attack, +1/+1/+1 defense); once the AI grinds
   edges, dice convert to captures. Its Cyber Strike is also the only galaxy
   faction ability the AI actually fires (strike parity in `processAiTurn`).
3. **Rust is the seat that dies.** Forge's kit is economic (production ×1.4,
   buildings ×0.8, +1 reinforcement) and the AI cannot turn production into
   survival; its Supply Insert (`guerrilla_warfare`) has no
   `TERRITORY_ABILITY_DEFS` entry so the AI parity path never uses it. Rust and
   Sol have identical ring positions (both border Verdan and Nexus), so the gap
   is kit, not topology.
4. **The hyperspace "race" is zero turns long.** Starting tech points (3) plus
   the opening income tick (3 at 16 tiles) already cover the 5-point Chart, so
   every non-Helion seat buys it on turn 1 (column above). Helion's signature
   perk is worth 5 tech points, once. Its ~25% comes from being the faction
   that does not get eliminated (9–10%), not from its lanes.
5. **Nexus's `tech_bonus: 0.05` never pays out.** `collectProduction` floors the
   per-world accumulation; 16 × 0.05 = 0.8 → 0 tech points even for a fully
   held Nexus. The other three world modifiers pay 3–6 production per turn.

## 4. Other lobby shapes (grind-faithful, threshold 60, 200 games, seed A)

The one-faction-per-world start (`tryDistributeGalaxyAgeFactionHomeworlds`)
only fires for **exactly 4 seats with 4 distinct factions**. Everything else
falls back to geographic distribution over all 64 tiles, and every seat starts
holding territory on several worlds it cannot yet reach.

| Shape | Start worlds per seat | Avg turns | Decisive | Win rates |
|---|---|---|---|---|
| 4p, factions OFF (the lobby default — Factions is not pre-checked for the era) | 4 of 4 | 55.0 | 62.5% | 19.5–29.0% (symmetric) |
| 3p, factions ON | 3 of 4 | 33.1 | 86.5% | 32–35% |
| 2p, factions ON | 3–4 of 4 | **16.0** | 97.5% | starts at 32 tiles, threshold needs 39 |

## 5. Structural variants tried (grind-faithful, threshold 60, 200 games, seed A)

| Variant | Decisive | Mandate / Forge / Helion / Custodians |
|---|---|---|
| baseline (8 lanes, chart 5) | 87.5% (400g) | 47.5 / 8.0 / 27.0 / 17.5 |
| Helion `reinforce_bonus: 1` (A / B) | 82.5% / 87.5% | 41.5 / 6.5 / **34.5** / 17.5 · 32.0 / 9.5 / **35.0** / 23.5 |
| one lane per hop (4 lanes) | 31.5% | 32.5 / 19.5 / 38.0 / 10.0 |
| full mesh (12 lanes: + sol↔rust, verdan↔nexus) | 58.0% | 33.5 / 22.5 / 17.5 / 26.5 |
| Chart cost 12 | 50.5% | 22.5 / 31.5 / **9.5** / 36.5 |

Takeaways: the lane count is the dominant pacing knob (4 lanes → 68% cap; 12
lanes → worlds become mosaics, largest share 11/16); making the Chart expensive
does not create a race, it just hands the game to whoever gets dice techs first
and starves Helion; a flat +1 reinforcement lifts Helion to ~35% without touching
Forge's collapse. None of these fixes Sol/Rust — that is a kit problem.

## History — pre-fix baseline (obsolete, kept for the record)

Measured on the pre-densification map before the symmetric ring, per-world
modifiers, contestable lanes and the Mandate discount landed, with the
single-exchange harness: stellar_mandate **2.0% / 1.2%**, forge_syndicate 36% /
33%, helion_navigators 35% / 41%, void_custodians 27% / 25%; territory-leader@10
won 62%; avg peak spread 50/64; ~45% of games reached the cap. The diagnosis at
the time (Sol hubbed by 6 lanes, no economic passive) drove the ring + modifier
changes above. Those changes shipped; this document was not re-measured until
2026-09-09.
