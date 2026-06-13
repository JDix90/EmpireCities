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

Knobs: `SIM_GAMES`, `SIM_PLAYERS`, `SIM_DIFFICULTY`, `SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`.

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

- Runtime: **19.6s** (39 ms/game) — comfortably inside the < 10 min target.
- **Reached final era (Modern): 84.4%** — clears EA-501's "expert completes the
  classic spine in ≥80% of long sims" acceptance bar (88.8% at maxTurns 120).
- Decisive wins: 61.6%; avg game length 83.9 turns; avg 10.4 advances/game;
  avg first advance turn 19.
- Winner era distribution: era5 (Modern) **409/500** — winners almost always
  reach the top of the spine before closing the game out.
- **First-advancer win rate: 49%** vs a 25% random baseline (≈2×). Era advantage
  is a real edge but NOT deterministic in 4p — the catch-up discount + gate
  relaxation + echo decay + the ±1 era-gap clamp keep trailing players in it.

## Snowball read

- 4p (representative multiplayer): first-advancer win ≈ 49% (≈2× baseline) —
  healthy. Era lead matters without being an auto-win.
- 2p (1v1-style): first-advancer win **93%**, era-leader almost always wins.
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
