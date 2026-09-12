# Era Advancement — balance tuning notes (EA-502)

Baselines from the headless AI-vs-AI simulator, `scripts/simEraBalance.ts`. The
sim drives the pure engine (no sockets/DB) so combat — including the era-gap
dice and the vulnerability window — is modeled faithfully via
`game-engine/combat/executeLandAttack.ts`. Ruleset: economy + tech + stability +
era advancement ON; factions / naval / events / cards OFF; domination victory
with a turn cap. Combat dice are seeded per game; starting positions are sampled.

Run it yourself:

```
pnpm exec tsx scripts/simEraBalance.ts                       # 200 games, 4p, expert
SIM_GAMES=500 SIM_PLAYERS=4 SIM_DIFFICULTY=expert \
  SIM_MAX_TURNS=100 SIM_CSV=/tmp/era_balance.csv \
  pnpm exec tsx scripts/simEraBalance.ts
```

Knobs: `SIM_GAMES`, `SIM_PLAYERS`, `SIM_DIFFICULTY`, `SIM_MAX_TURNS`, `SIM_SEED`,
`SIM_CSV`, `SIM_P0_POLICY`, `SIM_POLICY_AB`, `SIM_GROWTH`, `SIM_MAX_LEAD`,
`SIM_CONV`, `SIM_COST_MULT`, `SIM_VULN`, `SIM_GAP_DICE`, `SIM_RULES`.

> **Read [The stall problem](#the-stall-problem-ea-503-2026-09--advancing-does-not-pay)
> before quoting anything below it.** Three things changed in 2026-09: sweeps
> became reproducible (only the combat dice used to be seeded), the sim now
> models era territory growth (it never did, and production always has), and
> *first-advancer win rate* was retired as a balance signal because it measures
> which seat had the best economy, not what advancing is worth. Every number
> ABOVE that section predates all three — re-run with `SIM_GROWTH=0` to
> approximate them, and use `SIM_POLICY_AB=1` for any new claim.

## Headline finding that drove an AI fix

The first sim runs showed the gate was reachable in **100%** of games (AIs built
huge economies — ~12 techs, ~29 buildings, 100% stability) yet **almost nobody
advanced** (~0.9 advances/game, winners stuck at era 0). The cause was EA-501's
own *absolute* heavy-threat block (≥15 border units): in any developed game the
border always carries 15+ units, so advancement was permanently frozen.

Fix (EA-501, committed with EA-502): measure border threat **relative** to the
player's own border defense (`countBorderStrength`). Hard-block only when
genuinely outgunned (`threat ≥ 6 && threat/defense ≥ 1.5`); the calm bonus and
graduated penalties also key off the ratio. Impact in 2p expert games:

| metric | absolute block (before) | relative block (after) |
| --- | --- | --- |
| reached final era | 7.5% | 28.3% |
| decisive (non-turn-limit) wins | 37.5% | 98.3% |
| advances / game | 0.95 | 4.27 |
| first-advance turn | 16.3 | 8.4 |

## Baseline (500 games · 4p · expert · maxTurns 100 · seed "borderfall-era-balance")

Numbers below are post-audit: a review found `executeLandAttack` updated only the
defender's `territory_count` on capture, so the sim's reinforcement income (read
from `territory_count` in `advanceToNextPlayer`) and `domination`/`threshold`
victory didn't track conquest. Fixed to sync both involved players. The corrected
numbers moved < 3 points — the conclusions are robust.

- Runtime: **15.6s** (31 ms/game) — comfortably inside the < 10 min target.
- **Reached final era (Modern): 86.2%** — clears EA-501's "expert completes the
  classic spine in ≥80% of long sims" acceptance bar.
- Decisive wins: 64.6%; avg game length 82 turns; avg 10.5 advances/game;
  avg first advance turn 18.
- Winner era distribution: era5 (Modern) **418/500** — winners almost always
  reach the top of the spine before closing the game out.
- **First-advancer win rate: 49.5%** vs a 25% random baseline (≈2×). Era advantage
  is a real edge but NOT deterministic in 4p — the catch-up discount + gate
  relaxation + echo decay + the ±1 era-gap clamp keep trailing players in it.

## Snowball read

- 4p (representative multiplayer): first-advancer win ≈ 49% (≈2× baseline) —
  healthy. Era lead matters without being an auto-win.
- 2p (1v1-style): first-advancer win **94%**, era-leader almost always wins.
  This is the expected snowball of any 1v1 territory game (whoever develops
  faster compounds it); era advancement amplifies it but is not the sole cause.
- The reported "era-leader@turn10 win rate" is small-n noise — first advance
  averages turn ~19, so few players lead by turn 10. Use first-advancer win rate
  as the robust snowball metric.

## Recommendations (need owner sign-off + human playtest before changing balance)

1. **Hold the current 4p balance.** ~2× first-advancer edge and 84% spine
   completion is a good target; no constant changes recommended for multiplayer.
2. **Watch 2p / ranked 1v1.** If 1v1 era-rushing feels deterministic in playtest,
   the cheapest levers are lowering `era_advancement_combat_gap_dice` effect or
   strengthening catch-up (`era_advancement_catchup_discount`,
   gate relaxation) — both already plumbed as settings.
3. **Tutorial / preset cost tuning.** The sim confirms the Skirmish-style short
   gate is reachable quickly (first advance ~turn 8 in 2p), which supports the
   EA-404 tutorial's generous-resource setup.

These are observations to validate with real games — the sim models the land
ruleset and AI play, not human strategy, fog, factions, or naval.

---

## AI advancement fix (2026-06-13) — bots were frozen in the start era

**Bug found in playtest:** AI bots stayed in the Ancient era while a human
climbed, enabling a steamroll. The sim had only ever run `expert`, hiding it.

### Root cause (sim across all difficulties, pre-fix)

| difficulty | reached final era | advances/game |
|---|---|---|
| easy | **0%** (frozen) | 0.00 |
| medium *(casual default)* | 35% | 7.3 |
| hard | 47% | 7.4 |
| expert | 47% | 9.4 |

Easy/tutorial bots `return null` from `selectAiTechResearch` + `selectAiBuildingPlacement`
→ never satisfy the gate. Medium researched cheapest-first (not gate-aware), and
the advance check ran *before* that turn's economy (one-turn tax).

### Fix

- **Gate-directed research** (`selectGateDirectedTech`): fill tier-1 → tier-2 →
  tier-3 toward the milestone before strategic/cheapest picks.
- **Un-freeze easy/medium economy** in era-advancement games (tutorial stays passive).
- **Economy before the advance check** in `processAiTurn` + the sim loop (advance same turn).
- **Rubber-band**: a bot trailing the leader advances whenever gated (easy's
  85% skip suppressed when behind); catch-up gate relaxation + stability relief
  now scale with the era gap.
- **`era_advancement_max_lead`** (new setting): hard cap — no player may advance
  more than N eras ahead of the trailing living player.

Post-fix: medium reaches final ~62%, all researching difficulties climb.

### The parity/progression tension (important)

The peak era spread (leader − laggard) is driven by the **FFA territorial
snowball**, not the gate — relaxing the gate to near-trivial did **not** compress
it. Strict "within 1 era" is only *guaranteed* by the lead cap, which trades away
climbing:

| `era_advancement_max_lead` | peak spread | reached final | feel |
|---|---|---|---|
| 1 | 1.0 (100% within 1) | ~0–8% | field stalls — one straggler gates everyone |
| 2 | 2.0 | ~8% | leader reaches era 2–3, bounded runaway |
| 3 | ~2.9 | ~20% | ≈ uncapped |
| off (null, default) | ~3.5 | 47–62% | competitive leader allowed |

**Recommendation:** default `era_advancement_max_lead` OFF (competitive). Offer
`= 2` as a "fair/anti-steamroll" option; `= 1` only for strict-parity modes
(accepts suppressed climbing). The +1-die combat clamp (EA-203) already limits
the *mechanical* edge of any era lead regardless of spread.

---

## The stall problem (EA-503, 2026-09) — advancing does not pay

Reported from playtesting: *"if I am winning, it is often to my benefit NOT to
advance, since advancing opens up new territory for opponents who are penned
in."* That is correct, and the effect is large.

### Three harness defects had to be fixed before any of this was measurable

1. **The sweep was not reproducible.** `SIM_SEED` seeded only the combat dice.
   The opening position, card deck, AI heuristic jitter and every
   stability/rebellion roll came from unseeded CSPRNGs, so two identical
   invocations differed by several points of win rate and *no* cross-run
   comparison was sound. Fixed by adding an optional `rng` to
   `InitializeGameStateOptions` and `applyStabilityTick` (production keeps the
   CSPRNG — these draws must stay unpredictable to clients) and by passing the
   existing `computeAiTurn` `rng` option. The sim now seeds all four off
   `SIM_SEED`, and two runs of the same config produce identical games.
   `SIM_POLICY_AB` is therefore a genuinely paired comparison: both arms play
   the same board with the same dice and differ only in the advance decision.
2. **Territory growth was never modeled.** Production unlocks
   `unlock_era_index` frontiers as neutral land when the global era floor rises
   (gameSocket `applyEraBoardChange` → `unlockTerritoriesForFloor`), and
   `era_ancient` tags 29 of its 57 territories that way — 4 open on the Medieval
   hop, 12 more on Discovery, a 37% larger board. The sim never called it, so
   every sweep before this section measured a game where advancing has costs but
   no board consequences. Now default ON; `SIM_GROWTH=0` reproduces the old runs.
3. **First-advancer win rate was the wrong headline.** The player who reaches
   the gate first is the player with the best economy, so the ~2× figure in the
   sections above measures *selection*, not the value of advancing. Still
   printed, now labelled.

### The instrument: `SIM_P0_POLICY`

Seat 0 runs the same expert economy as every other seat, but its advance
decision is pinned: `always`, `never`, `when_behind`, or `ai` (the shipped
heuristic, the default). Everyone else plays normally and advances. The
win-rate difference between arms is the value of advancing, holding all else
fixed. `SIM_POLICY_AB=1` runs both arms and checks the acceptance bar.

One trap worth recording: the AI build picker stops buying once the building
gate is met and the purse is short of the advance fare (aiBot.ts § "Era-advance
fund"). A seat that will never advance has no fare to bank, so leaving that
reservation on hands the stall arm an idle treasury and flatters every result.
`pickBuild` suppresses it for the `never` arm.

### Finding: never advancing is the strongest policy in the shipped ruleset

500 games/arm · 4p · expert · maxTurns 100 · seat-0 win rate, fair share 25%.
Three seeds, since determinism removes run-to-run noise but not seed-to-seed
sampling noise.

| ruleset | default seed | s1 | s2 | mean gap |
|---|---|---|---|---|
| **Shipped** (conversion 0.7, open frontier) | −11.4 | −7.6 | −13.2 | **−10.7** |
| conv 1.0 + `gate,expedition,renaissance` | +3.0 | +3.4 | −0.4 | **+2.0** |

Advancing costs the advancing seat about **10 points of win rate** — in a
4-player game where a seat is only "worth" 25 to begin with. It is not a
marginal mistuning; in the shipped ruleset the era system is a trap, and the
strongest line for a player who is winning is to never press the button.

### What each lever is worth (seed s1, one seed only — attributions are noisy)

| conversion | rules | gap |
|---|---|---|
| 0.7 | — (shipped) | −7.6 |
| 1.0 | — | −5.4 |
| 0.7 | `gate` | −4.6 |
| 1.0 | `gate` | −0.2 |
| 1.0 | `gate,expedition` | −2.0 |
| 1.0 | `gate,expedition,renaissance` | +3.4 |
| 1.0 | `renaissance` | −5.6 |

Read carefully, because the interaction matters more than any single row:

- The two costs each carry roughly half the deficit. Removing army conversion
  is worth ~2 points; gating the frontier ~3; together they reach parity
  (−0.2). Neither alone is close.
- **Rewards are worthless until the frontier is gated.** `renaissance` alone is
  −5.6, indistinguishable from doing nothing (−5.4). The same lever on top of a
  gated frontier is worth +5.4 (−2.0 → +3.4). An ungated frontier leaks the
  payoff to whoever is penned in, so paying the advancer more just feeds them.
- `expedition` measured *negative* on this seed (−0.2 → −2.0). One seed at 500
  games cannot separate that from noise, but there is no evidence it earns its
  implementation cost.
- `renaissance` alone also pushed era-laggard@turn20 to 2.7%, under the
  snowball floor. Rewards without the gate concentrate advantage without
  making advancement worth choosing — the worst of both.

### Status: the problem is confirmed, the fix is not

The candidate package swings the gap by ~13 points and flips the sign, but
lands at **+2.0 mean and negative on one of three seeds** — short of the +5
acceptance bar. **It is not ready to implement as specified.** What is
established:

- The stall is real, large, and reproducible (three seeds, all strongly negative).
- Direction of travel is right: conversion and the open frontier are the costs
  that do the damage, and the gate is what makes any reward stick.
- Sizing is not established. The next round belongs in this harness, not in the
  engine: search the reward side (era-scoped territorial abilities, expedition
  sizing, a stronger renaissance) against the bar, on 3+ seeds, before writing
  a line of feature code.

### The acceptance bar

```
SIM_POLICY_AB=1 SIM_GAMES=500 SIM_MAX_TURNS=100 pnpm exec tsx scripts/simEraBalance.ts
```

- **Advancing must pay** — seat-0 `always` beats `never` by **≥ +5 points** in 4p.
- **…but must not steamroll** — era-laggard@turn20 win rate **≥ 5%**.

The script prints PASS/FAIL on both. Confirm on **at least three `SIM_SEED`
values**: the deterministic harness removes run-to-run noise, but seed-to-seed
spread on the gap is still ~4 points, and a one-seed PASS means nothing.

### Rejected levers (single-seed screens, kept so the rejection is checkable)

| lever | result |
|---|---|
| Era-gap dice +1 → +2 | the largest gap of anything tested, and the clearest snowball: era leader@t20 ~96%, laggard ~2%, 1v1 laggard 0%. **Reward must not come from combat multipliers.** |
| Frontier garrisons scaled to mean stack | erases the gain — it makes the advancer's own private frontier expensive to take |
| Hegemony / era-scaled victory | decided 60–75% of games and cut length ~50 → ~32 turns while leaving seat 0 flat: it rewards whoever already holds the most land, i.e. the staller |
| Advance cost 2.0 → 1.5× income | no measurable effect |
| Vulnerability window removed | no measurable effect; keep it — it is the interesting cost, and unlike conversion it does not compound |

### Caveats — what this study does not prove

- Bots do not *strategise* around an exclusive frontier: they take what is
  adjacent and legal, and never race to claim land before a rival reaches the
  era that opens it. The `gate` is therefore plausibly worth more to humans
  than measured — an argument for playtesting it, not for assuming the numbers
  transfer.
- The era-laggard metric is confounded: the laggard is usually also the weakest
  economy, so its win rate is a floor on snowball, not a clean measure of it.
- Factions, naval, events, cards and fog are OFF, as in every sweep here.
- `renaissance` is modeled as a free cheapest-tier-1; the implementation sketch
  is a 100%-off `pending_tech_discount` the player spends where they like.
- Single-seed rows are screens, not results. Only the three-seed table above
  carries a conclusion.
