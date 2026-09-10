# Space to Stars — measured state

Headless AI-vs-AI audit of the **111-territory** ascension board
(`database/maps/era_ascension_galaxy.json`: Earth 54 + Luna 9 in play from turn
one, Verdan Reach / the Rust Belt / Nexus Station — 48 tiles — held behind
`unlock_era_index: 1`, 11 authored hyperspace lanes). The game runs Space Age
rules and climbs the two-step `space_to_stars` spine into the Galactic Age.

Tool: [`simSpaceAgeBalance.ts`](./simSpaceAgeBalance.ts) with `SIM_ASCENSION=1`
— the same harness that audits the standalone Moon race, because the first half
of this board IS that race.

```sh
# from backend/ — the live create defaults for an orbit-gated game are
# threshold 60 + cap 90:
SIM_ASCENSION=1 SIM_GAMES=200 SIM_DIFFICULTY=expert SIM_THRESHOLD=60 \
  SIM_MAX_TURNS=90 pnpm exec tsx scripts/simSpaceAgeBalance.ts
SIM_ASCENSION=1 SIM_FACTIONS=1 SIM_GAMES=200 SIM_DIFFICULTY=expert \
  SIM_THRESHOLD=60 SIM_MAX_TURNS=90 pnpm exec tsx scripts/simSpaceAgeBalance.ts
# …and the same commands WITHOUT SIM_ASCENSION for the standalone Space Age
# baseline every row below is compared against.
```

Ruleset: economy + tech + stability ON, era advancement ON (`space_to_stars`),
galaxy corridors + world rules ON, naval / events OFF. 4 players, expert, 90-turn
cap, threshold 60%.

**A caveat that applies to every number here.** Starting territory distribution
goes through the engine's own CSPRNG shuffle, which no seed reaches, so two runs
of the same command sample different starts. The AI's heuristic jitter IS seeded
now (same fix, same reason, as `simGalaxyBalance` — see GALAXY-BALANCE.md §1);
before that, two identical 20-game runs disagreed by tens of points. Everything
below is 200 games unless noted, and the seed column shows the run-to-run spread
that remains.

## 1. The exit gate

The bar Phase 8 was written against: **at least 70% of games reach the Galactic
Age, with a median arrival inside 25 turns of a Space Age start.**

| Metric | factions OFF (A / B) | factions ON (A / B) |
|---|---|---|
| Games reaching the Galactic Age | 91.5% / 92.0% | 96.0% / 98.0% |
| First arrival turn (median) | 20 / 20 | 17 / 17 |
| Seats reaching it (of 4) | 3.19 / 3.21 | 3.6 / 3.6 |
| Exo tiles owned by a player at end (of 48) | 29.7 / 30.2 | 29.0 / 30.1 |
| Exo captures per game | 31.7 / 32.6 | 30.9 / 32.7 |
| Winner had reached the Galactic Age | 91.5% / 92.0% | 96.0% / 98.0% |
| Decisive (not turn-limit) | 72.0% / 63.5% | 55.5% / 60.5% |
| Territory-leader@turn-10 wins | 68.4% / 65.2% | 61.5% / 58.2% |

**Both halves of the gate pass on every run.** The far worlds are not decoration:
about two thirds of their tiles have an owner by the end and they change hands
roughly 33 times a game.

## 2. The bug the sim found before the code shipped

The first version of the spine gated leaving the Space Age on the ordinary
milestone counts (tier-2 ×2, tier-3 ×1, three buildings). Measured over 10 games:

| | first version | with the Space Program gate |
|---|---|---|
| Games reaching the Galactic Age | 100% | 90% |
| Median arrival turn | 15 | 20 |

| Games where anyone completed the Moon ladder | 10% | 83.5% |
| Space station launched | 20% | 96.5% |
| Games where any Moon tile was captured | **0%** | 90.0% |
| Exo tiles owned at end | **0.0** | 29.7 |

Every seat climbed by turn 15, `executeAdvanceEra` cleared their
`unlocked_techs` — Lunar Expansion with them — and from that point nobody could
ever finish the ladder again. The three far worlds opened on schedule and sat
untouched for the remaining 45 turns while the game ground into the turn cap.

Two changes fixed it, and they only work together:

- **`gate_requires_moon_access` on the Space Age spine step.** Leaving for the
  stars means you built the ship: Lunar Expansion + a Launch Pad + a launched
  Space Station (or the Lunar Pioneers' birthright). Computed from `state`
  alone, so the map-free advance path can enforce it.
- **Per-player orbit regime** (`resolveOrbitAccessModeForPlayer`): a player's
  gate is the LATER of the board's era and their own. The board here stays
  `space_age` all game, so without this a player who reached the Galactic Age
  would still be held to a ladder whose techs the advance had just deleted. The
  "later of the two" shape is what keeps board-transform games unchanged — there
  the board is ahead of a trailing player, and their own era alone would hand
  them the Moon for free.

## 3. What the ascension board does to Space Age balance

Same harness, same settings, same 200 games — the only difference is the board
and the climb.

| Faction | standalone Space Age | Space to Stars (A / B) |
|---|---|---|
| Terran Federation | 18.0% | 26.3% / 23.3%* |
| Sino-Pacific Hegemony | 22.4% | 12.7% / 17.2%* |
| Climate Alliance | 37.3% | 26.9% / 32.1%* |
| **Corporate Enclave** | 35.8% | **50.7% / 53.7%** |
| **Solar Caliphate** | 16.5% | **11.3% / 10.5%** |
| Lunar Pioneers | 19.7% | 22.0% / 17.4%* |
| — | | |
| Territory-leader@turn-10 wins | 50.3% | 58.2–61.5% |
| Decisive (not turn-limit) | 47.5% | 55.5–60.5% |

The Space to Stars columns are the shipped 3/4 frontier; the Enclave and
Caliphate rows held to within a couple of points across every garrison variant
tried (§4), which is what makes them the signal rather than the noise.

**This board amplifies an imbalance it did not create.** The Space Age roster is
already spread 16.5–37.3% on its own map; the longer game and the second board
stretch that to 10.5–53.7%. The Corporate Enclave reaches the Moon in ~90% of its
games against ~60% for everyone else, and on this board the Moon is the on-ramp
to everything. That is the single largest open item on the feature.

## 4. The tuning that was tried, and what it measured

| Change | Why | Measured |
|---|---|---|
| Exo frontier garrison 4/6 → **3/4** (landing zone / interior) | A far world reached after a whole Space Program "should" defend harder than a field next door. | The fiction is right and the mechanic is inert: exo tiles owned at end sat at 29–30 of 48 at 3/4, 4/6 AND 6/8, and neither the snowball (58–63%) nor the faction spread moved. Weight only cost decisive games — 46.5% / 53.0% at 4/6 against 55.5% / 60.5% at 3/4 — by grinding more games into the cap. Took the lighter one. |
| Jump the AI jitter onto a seeded stream | Two identical 20-game runs put the lunar-region sample at n=18 and then n=9. | Removed that source; the start distribution remains unseeded (§ caveat). |

## 5. Open

- **The Corporate Enclave at ~52% and the Solar Caliphate at ~11%** (§3). The
  fix belongs to the Space Age roster, not to this board — but this board is
  where it becomes unmissable, and it should not ship past admin-only until the
  roster is retuned.
- **Decisive rate 55–60% with factions on** (64–72% without) at threshold 60 +
  cap 90. The Galactic Age's own bar is 80%, set on a 64-tile board; 111 tiles
  and a 60% threshold means 67 tiles to win. Either the cap or the threshold
  wants revisiting for this theater — and note that turning factions ON is what
  costs the ~10 points, which is the same imbalance §3 describes wearing a
  different hat.
- **The Moon decides the game**: the Moon-tile leader at the end wins ~81% and a
  player holding all nine wins ~97%. Reaching the stars reads as a victory lap
  more than a second act. The Pathfinder Gate and the far worlds' own rules are
  meant to be the answer; they are not enough yet.
- **Start distribution is unseeded** (§ caveat), so this document reports ranges
  rather than single numbers.
- **Only four-player games are measured.**
