# Galactic Age balance — baseline audit

Headless AI-vs-AI balance for the **64-territory** Galactic Age map (after the
6→16 per-world densification). Tool: [`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

```sh
# from backend/
pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=500 SIM_DIFFICULTY=expert SIM_MAX_TURNS=90 \
  SIM_CSV=/tmp/galaxy.csv pnpm exec tsx scripts/simGalaxyBalance.ts
```

4 players, one per galaxy faction (faction↔player assignment is **rotated per game**
so win rate isn't confounded with turn order). Factions ON, naval OFF, era
advancement OFF (galaxy is terminal), domination victory, seeded combat dice.

## Baseline results (400 games, expert, maxTurns 90; confirmed on a 2nd seed)

| Metric | Value | Read |
|---|---|---|
| Avg game length | 68 turns | long; ~45% reach the turn cap |
| Decisive (non-turn-limit) wins | 55% | nearly half stalemate to the cap |
| **Territory-leader@turn-10 win rate** | **62%** (base 25%) | strong **snowball** |
| **Avg peak territory spread** | **50 / 64** | games run away to one player |

| Faction | World | Win rate (seed A / B) | |
|---|---|---|---|
| **stellar_mandate** | **Sol** | **2.0% / 1.2%** | **broken — far below 25%** |
| forge_syndicate | Rust | 36% / 33% | high |
| helion_navigators | Verdan | 35% / 41% | high |
| void_custodians | Nexus | 27% / 25% | ~balanced |

## Diagnosis

1. **Sol is a death trap (the headline).** Sol carries **6 orbit lanes** vs **4** for
   each exo world (it's the hub every faction connects to), so Stellar Mandate is
   reachable and dogpiled from all three sides at once. Its faction kit is purely
   defensive (+1 defense die) with **no economic passive**, so it can't out-grow the
   pressure. Result: it almost never wins despite owning the highest continent bonus
   (`stellar_core` = 5).
2. **Helion's free lanes are very strong.** Skipping the Hyperspace Chart tech lets
   the Navigators invade immediately while rivals still tech up — consistently top-2.
3. **The dense map front-loads income, so games snowball.** Base reinforcements are
   `floor(territoryCount/3)`, so fully holding a 16-territory world drafts ~5/turn
   (vs ~2 at 6). Whoever expands first compounds: the turn-10 leader wins 62% and the
   map tips to a ~50-territory spread. ~45% of games then grind to the turn cap.

## Recommended fixes (implemented + re-validated against this sim in follow-ups)

- **De-hub the orbit graph (structural Sol fix).** Rebalance the cross-world lanes
  toward a symmetric ring so no world has more inbound lanes than another. This is the
  most direct fix for Sol's 2%.
- **Per-world identity modifiers (identity + Sol economy).** Give each world a
  distinct economic edge (Rust +production, Verdan +stability, Nexus +tech, Sol
  +reinforcements / strongest bonus) so the cradle can pay for its exposure without a
  rules change to the combat engine.
- **Contestable hyperspace lanes (snowball friction).** Make lanes choke points
  (cross only from a held endpoint), which slows runaway cross-world expansion and
  gives the trailing factions defensible borders — directly targets the 62% / 50-spread
  snowball.
- **Re-run this sim after each** to confirm faction win rates converge toward 25% and
  the snowball/ spread numbers come down.
