# Era Advancement — Stage 0 Pen-and-Paper Validation (§5.5)

**Date:** June 2026  
**Parameters:** §5.2 starting values from [Borderfall_Era_Advancement_Design_v2.md](/Users/jefe/Downloads/Borderfall_Era_Advancement_Design_v2.md)  
**Scenario:** 1v1, 12 turns, Player B advances on turn 4, Player A stays in era 0

---

## Setup

| Assumption | Value |
|------------|-------|
| Players | 2 (A = stayer, B = advancer) |
| Starting army | 25 units each |
| Starting reserve | 80 gold (`special_resource`) |
| Per-turn income | 50 gold (mid-game baseline) |
| Unit cost era 0 | 5 gold |
| Unit cost scaling | 1.25× per era |
| Strength scaling | 1.40× per era |
| Conversion ratio | 0.70 |
| Advance cost (0→1) | 100 gold (2× income) |
| Vulnerability | 1 turn, −25% effective combat power |

**Simplifications:** No map combat, no dice variance, no buildings, no tech gates. Both players spend all remaining gold on units each turn after income. Combat power = `units × era_strength` (vulnerability multiplies defender power).

---

## Turn-by-turn log

| Turn | Event | A units (power) | B units (power) | Notes |
|------|-------|-----------------|-----------------|-------|
| 1 | — | 51 (51) | 51 (51) | Even |
| 2 | — | 61 (61) | 61 (61) | Even |
| 3 | — | 71 (71) | 71 (71) | Even |
| 4 | **B advances** | 81 (81) | 41 → **43 eff.** | B: 71×0.7=49 units, −100g advance; vuln window **open** |
| 5 | — | 91 (91) | 49 (68.6) | B rebuilding; A still ahead |
| 6 | — | 101 (101) | 57 (79.8) | |
| 7 | — | 111 (111) | 65 (91) | |
| 8 | — | 121 (121) | 73 (102.2) | |
| 9 | — | 131 (131) | 81 (113.4) | |
| 10 | — | 141 (141) | 89 (124.6) | |
| 11 | — | 151 (151) | 97 (135.8) | |
| 12 | — | 161 (161) | 105 (147) | B never overtakes A in this model |

**Advance detail (turn 4):** B had 71 units, paid 100g, converted to 49 medieval units. Raw medieval power = 68.6; with vulnerability = **43 effective**. A had 81 power — nearly **2×** during the window.

---

## §5.5 verdict: vulnerability window

**Pass.** The one-turn vulnerability window creates a real, exploitable decision for the opponent:

- On turn 4, A should ask: *"Strike now while B is at ~43 effective power vs my 81, or keep building?"*
- Ignoring the window lets B rebuild to 49 units (68.6 power) on turn 5 — still behind but recovering.
- The window is **legible** (one turn, large power gap) and **tense** (advance cost + conversion loss are visible).

**Recommendation:** Ship with −25% effective defense for exactly one full turn cycle (from advance action through that player's next turn start). Surface with a UI badge: "Reorganizing Army (−25% defense this turn)."

---

## Combat break-even finding

In this spend-all-income model, **B does not reach combat parity with A within 12 turns.** Break-even turn: **none**.

This **confirms §5.4 fragility finding #2:** combat-only advancement is a slow payback. The stayer who never advances and pumps ancient units wins the raw arms race. Advancing is only justified when:

1. Era-unique payoffs exist (signature unit dice bonus, alternate victory progress), or
2. The stayer is not dumping 100% of income into units (economic development, tech, stability), or
3. The advancer times the advance when safe from immediate punishment and plans for mid-game payoff.

**Recommendation for Stage 1 PoC:** Include signature payoff as **+1 attack die on first medieval combat** (Medieval Signature) so advancing has a non-combat-curve justification in playtests.

---

## Conservative tuning check (J1)

Starting conversion at 0.70 with 100g cost at 50g/turn income:

- Advancement is **expensive** (2 turns of income) and **weakens immediately** (conversion + vulnerability).
- Risk of "nobody advances" is higher than "everyone rushes" — aligns with J1 (prefer under-tuned).

**No change recommended** to conversion ratio before first human playtest.

---

## Sign-off

| Check | Result |
|-------|--------|
| Vulnerability creates opponent "strike now?" tension | **Yes** |
| Advancement is immediate power loss | **Yes** |
| Combat break-even alone justifies advance | **No** (needs era-unique payoff) |
| Ready for Stage 1 spec | **Yes** |

**Next:** [stage1-spec.md](./stage1-spec.md)
