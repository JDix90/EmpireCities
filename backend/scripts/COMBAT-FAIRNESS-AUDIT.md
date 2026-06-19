# Combat Fairness Audit — Borderfall

_Audit of the combat system for offense/defense balance, in response to player reports that
combat "feels one-sided." Findings are grounded in the engine source and a simulation that
implements the exact rules (`backend/scripts/combatFairnessSim.js` — run with `node`)._

---

## Executive Summary

**Verdict: the dice core is fair; the "one-sided" feel lives in two compounding layers above it.**

1. **Base combat is well-balanced.** With full stacks, roughly equal numbers are a coin flip
   (10 v 10 ≈ 48% capture, 20 v 20 ≈ 58%), and you need ~1.4–2.2× the defenders for a
   confident (90%) win — textbook Risk. RNG is cryptographic (`crypto.randomInt`), not
   `Math.random` — no seed/bias exploit. **At equal footing, nothing is rigged.**

2. **The real imbalance is the modifier layer, and it favors the defender disproportionately.**
   Defender bonus dice swing far harder than attacker bonus dice, because they're added to a
   *lower* base (2 vs 3) and compound with the "defender wins ties" rule. In a dominant
   20-attacker vs 10-defender fight:

   | Defender bonus | P(attacker captures) |
   |---|---|
   | +0 | **96.5%** |
   | +1 (one faction passive _or_ `defense_1`) | **58%** |
   | +2 (`defense_2` building) | **19%** |
   | +3 (`defense_3` building) | **4.8%** |

   Stack building + wonder + tech (+5) and a territory becomes **impregnable to a 3–4:1
   attacker** (20 v 8 at +5 = 1.4% capture; 30 v 8 at +5 = 5.6%). There is **no upper cap** on
   post-bonus dice in the engine, so this stacking is unbounded.

3. **The strategic layer favors the attacker** — which is why the complaint cuts both ways.
   Offense controls all the tempo: unlimited attacks per turn, "attack again" momentum, full
   board information, and **no defender reaction phase** (defenders only roll dice). Plus the
   era snowball — the engine's own sims show the first era-advancer wins **94% of 1v1 games**
   (`backend/scripts/eraBalanceTuning.md`).

**Who feels cheated?** Both, in different situations:
- **Attackers** feel cheated bringing 3–4× force and bouncing off a fortified chokepoint they
  couldn't see was fortified.
- **Defenders** feel cheated getting rolled over by a tempo/era-lead aggressor while they sit
  passive with no counter-move.

---

## Methodology

- **Code-grounded:** read the single source of truth —
  [`combatResolver.ts`](../src/game-engine/combat/combatResolver.ts) (`resolveCombat`),
  [`combatModifiers.ts`](../src/game-engine/combat/combatModifiers.ts) (dice overrides), and
  [`executeLandAttack.ts`](../src/game-engine/combat/executeLandAttack.ts) (capture/move-in).
  Combat is unified — humans and AI both go through `resolveCombat`.
- **Simulation:** `combatFairnessSim.js` re-implements the exact exchange rules (descending
  sort, compare `min(a,d)` pairs, attacker wins only on strict `>`, loss caps) and runs exact
  enumeration for single exchanges plus 120k-trial Monte Carlo for full assaults. It does
  **not** model era rerolls (attacker-favoring) or post-combat reactions (minor), so it is a
  clean read on the structural balance.

---

## Detailed Findings

### 1. Core mechanic — fair by construction
- Attacker rolls `min(units−1, 3)`; defender rolls `min(units, 2)` (`combatResolver.ts:65-66`).
- Dice sorted descending, highest-vs-highest; **defender wins ties** (`combatResolver.ts:86-92`).
- One exchange per attack; capture happens on the exchange that drops the defender to 0; losses
  capped so neither side is over-killed (`:128-132`).
- Move-in: attacker advances `min(source−1, 3)` into the captured territory
  (`executeLandAttack.ts:154-156`).

**Base-rate balance (no bonuses), P(attacker captures):**

| Atk\Def | 5 | 10 | 15 | 20 |
|---|---|---|---|---|
| **10** | 87% | 48% | 17% | 5% |
| **15** | 98% | 84% | 54% | 26% |
| **20** | 99.8% | 96% | 82% | 58% |
| **30** | 100% | 99.9% | 99% | 94% |

Parity ≈ coin flip; large stacks slightly favor the attacker at parity (the 3-vs-2 dice edge),
exactly like Risk. **This is healthy.**

### 2. The tie rule and the small-stack penalty
"Defender wins ties" is worth ~0.41 units/exchange to the defender. It interacts with stack
size: when the attacker is too thin to field 3 dice, the defender wins decisively.

| Matchup | E[def loss] | E[att loss] | Winner |
|---|---|---|---|
| 3×2 (attacker has the numbers) | 1.079 | 0.921 | attacker |
| 2×2 (attacker stack thin) | 0.779 | 1.221 | **defender** |
| 1×2 | 0.255 | 0.745 | **defender** (3:1) |

### 3. The modifier asymmetry — where fairness breaks
There is **no clamp** on dice after bonuses — `min(units−1,3) + combinedAttackBonus` and
`baseDefenderDice + totalDefenseBonus` (`combatModifiers.ts:242-246, 171-176`). Because the
defender starts from base 2, each added defender die is a larger proportional swing, and the
effect is brutal and far steeper than attacker dice (20 v 10):

- **Defender +1 ≈ halves** capture odds (96.5% → 58%); +2 → 19%; +3 → 4.8%.
- **Attacker +1** barely moves an already-winning fight (96.5% → 99.6%).

Compounding this, the **defender has more flat-dice levers** than the attacker:

| Defender-only flat dice | Attacker-only flat dice |
|---|---|
| Buildings `defense_1/2/3` (+1/+2/+3) | March to the Sea (+1/hop, 3 hops) |
| Wonder (Colosseum, +1 global) | Underdefended/`rapid_fire` (+1 vs ≤2 def) |
| Sea defense `coastal_battery` (+1) | Precision strike (3-dice override) |
| Great Wall pre-charge (+2/turn) | Air strike (−1 def pre-combat) |
| Janissaries (defender base 3) | (more _self-buff_ abilities, +1 each) |
| Naval bombardment (+1..+3 amphibious) | Era vulnerability window (def ×0.75) |

Tech and event bonuses **are** symmetric, and the era-gap die is clamped to ±1 — those are
well-designed guardrails. The problem is specifically the **unbounded defensive flat-dice stack**.

### 4. Strategic layer — offense controls tempo
- **No defender reaction:** all defender faction abilities are passive/post-hoc
  (`defenderReactions.ts`); defenders never act on the attacker's turn.
- **Unlimited attacks + "attack again":** an attacker chains captures with full board info and
  no interruption. AI is budget-limited (easy 2 / medium 4 / hard 8); humans are not.
- **Era snowball:** `eraBalanceTuning.md` reports first-advancer win rate ~49% in 4-player
  (healthy) but **94% in 1v1** — the biggest one-sidedness, favoring the aggressor.
- **Anti-snowball that helps defenders:** capturing tanks the conqueror's stability/economy and
  slows their own era advancement.
- AI gets **no combat dice bonus** at any difficulty — difficulty is planning depth only.

### 5. RNG
Fair. `crypto.randomInt(1,7)` per die, independent draws, no seeding (`combatResolver.ts:68`).

---

## Recommendations (prioritized)

1. **Cap post-bonus dice** (highest impact, lowest risk) — **PROTOTYPED**, see below.
2. **Diminishing returns on defender bonus dice** — count the 2nd+ defensive die as ~+0.5,
   since each die from base-2 swings ~2× harder than an attacker die.
3. **Show defensive bonuses in the pre-attack UI.** A large share of "this feels unfair" is
   information asymmetry — the attacker can't see the +3 building before bouncing.
4. **Address the 1v1 era snowball** (already flagged in the tuning doc): for ranked 1v1, lower
   `era_advancement_combat_gap_dice` or strengthen catch-up.
5. **Give defenders one small active lever OR dampen attacker tempo** — pick one, not both.

---

## Prototype: Recommendation #1 — anti-fortress dice cap

Flag-gated, **off by default** (vanilla combat unchanged until a lobby enables it). Settings:
`combat_dice_cap_enabled` (default `false`), `combat_max_attacker_dice` (default 5),
`combat_max_defender_dice` (default 4). The clamp is applied to the final post-bonus override in
`combatModifiers.ts` (before the era-vulnerability reduction) and recorded as a `capped` field in
the bonus breakdown. Configured caps are clamped to never drop below the natural base (atk 3 /
def 2). Exposed in the lobby's Advanced Features as a "Combat Dice Cap" toggle + max sliders.

**Effect (cap OFF → ON, def≤4 / atk≤5), from `combatFairnessSim.js`:**

| Scenario | OFF | ON |
|---|---|---|
| 20 v 10, defender +3 | 4.8% | **17.5%** |
| 20 v 10, defender +5 | 0.3% | **17.3%** |
| 20 atk vs 5 def (**4:1**), +4 stacked | 22% | **63%** |
| 20 atk vs 8 def, +5 stacked | 1.4% | **32%** |
| 30 atk vs 8 def (~4:1), +5 | 5.6% | **64%** |

**It leaves real combat alone:** vanilla fights are identical (10v10 = 48%, 20v10 = 96.5%,
15v20 = 26% cap on/off), and reasonable bonuses (+1/+2) are untouched — only the runaway stack
(+3 and up) is clamped. A fully-stacked defender still holds ~17–35% of the time against a 2:1
force, so fortresses stay *hard*, just not *impossible*. `maxDef` is the tuning dial.

---

## Code reference map

| Feature | File:line |
|---|---|
| Single-exchange resolution | `src/game-engine/combat/combatResolver.ts:31-141` |
| Defender wins ties | `src/game-engine/combat/combatResolver.ts:86-92` |
| Dice-override + bonus stacking (no base clamp) | `src/game-engine/combat/combatModifiers.ts:171-246` |
| Anti-fortress cap (prototype) | `src/game-engine/combat/combatModifiers.ts` (search `combat_dice_cap_enabled`) |
| Capture + move-in | `src/game-engine/combat/executeLandAttack.ts:154-156` |
| Reinforcement scaling | `src/game-engine/combat/combatResolver.ts:164-173` |
| Cap settings + normalization | `src/types/index.ts`, `src/game-engine/state/gameSettings.ts` |
| Reproducible simulation | `backend/scripts/combatFairnessSim.js` |
| Era-snowball sims | `backend/scripts/eraBalanceTuning.md` |
