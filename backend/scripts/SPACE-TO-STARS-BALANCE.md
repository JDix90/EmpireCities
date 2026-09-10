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
# threshold 60 + cap 90, and the Moon Race is ON:
SIM_ASCENSION=1 SIM_GAMES=200 SIM_DIFFICULTY=expert SIM_THRESHOLD=60 \
  SIM_MAX_TURNS=90 pnpm exec tsx scripts/simSpaceAgeBalance.ts
SIM_ASCENSION=1 SIM_FACTIONS=1 SIM_GAMES=200 SIM_DIFFICULTY=expert \
  SIM_THRESHOLD=60 SIM_MAX_TURNS=90 pnpm exec tsx scripts/simSpaceAgeBalance.ts
# The standalone Space Age baseline every row below is compared against — the
# same ruleset, on `era_space_age`, with the Moon Race phases named explicitly
# because they only default ON in ascension mode:
SIM_MOON_HELIUM3=1 SIM_MOON_TIER=1 SIM_MOON_HEGEMONY=1 SIM_MOON_MISSIONS=1 \
  SIM_MOON_BLOCKADE=1 SIM_FACTIONS=1 SIM_GAMES=200 SIM_DIFFICULTY=expert \
  SIM_THRESHOLD=60 SIM_MAX_TURNS=90 pnpm exec tsx scripts/simSpaceAgeBalance.ts
```

Ruleset: economy + tech + stability ON, era advancement ON (`space_to_stars`),
the whole Moon Race package ON, galaxy corridors + world rules ON, naval /
events OFF. 4 players, expert, 90-turn cap, threshold 60%.

**A caveat that applies to every number here.** Starting territory distribution
goes through the engine's own CSPRNG shuffle, which no seed reaches, so two runs
of the same command sample different starts. The AI's heuristic jitter IS seeded
now (same fix, same reason, as `simGalaxyBalance` — see GALAXY-BALANCE.md §1);
before that, two identical 20-game runs disagreed by tens of points. Everything
below is 200 games unless noted, and the two seed columns show the run-to-run
spread that remains.

## 1. The exit gate

The bar Phase 8 was written against: **at least 70% of games reach the Galactic
Age, with a median arrival inside 25 turns of a Space Age start.**

| Metric | factions OFF (A / B) | factions ON (A / B) |
|---|---|---|
| Games reaching the Galactic Age | 78.5% / 76.5% | 91.0% / 92.5% |
| First arrival turn (median) | 20 / 20 | 14 / 14 |
| Seats reaching it (of 4) | 2.24 / 2.15 | 2.96 / 3.10 |
| Exo tiles owned by a player at end (of 48) | 18.8 / 18.3 | 22.1 / 24.0 |
| Exo captures per game | 19.9 / 19.8 | 24.9 / 27.7 |
| Winner had reached the Galactic Age | 78.5% / 76.5% | 91.0% / 92.5% |
| Decisive (not turn-limit) | 94.0% / 97.5% | 93.5% / 90.0% |
| Avg game length (turns) | 41.5 / 39.5 | 45.2 / 47.4 |
| Won by Lunar Hegemony | 23.5% / 27.0% | 20.0% / 18.0% |
| Territory-leader@turn-10 wins | 70.1% / 75.1% | 74.9% / 70.2% |

**Both halves of the gate pass on every run**, and the board does not break the
Moon Race's own gate either: the Hegemony ends 18–27% of games, inside its
10–35% band. About four in ten of the far worlds' tiles have an owner by the
end, changing hands ~20–28 times a game.

The Hegemony is what makes this board finish. Before the Moon Race merged, the
same measurement ran 55–72% decisive at the same cap: a 111-tile board and a 60%
threshold means 67 tiles to win, which is a long way. A second decisive route
that lands around turn 30 is exactly what a board this size needed.

## 2. Two bugs the sim found before either shipped

### The climb had no ship (found on this branch)

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
untouched for the remaining 45 turns.

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

### The harness measured a game nobody can create (found on the merge)

`SIM_MOON_MISSIONS=1` implies `SIM_SECRET_MISSIONS=1`, which is right for a
Phase-5 study — it gives the lunar branch a matched control — and wrong for a
default. `applyOrbitGatedVictoryDefaults` never adds `secret_mission` at create.
With it in the victory list, **41 of 60 ascension games ended on a secret
mission at a median turn 20** — the same turn the first player reaches the
Galactic Age. The board's entire second half never happened, and the run read as
a failed exit gate (58.3% reaching the stars, 2.5 exo tiles owned).

Ascension mode now defaults the five Moon Race phases ON (the package ships ON,
so a run with them off measures a game nobody can create either) and leaves
`secret_mission` out unless asked for explicitly.

## 3. What the ascension board does to Space Age faction balance

Same harness, same settings, same 200 games — the only difference is the board
and the climb.

| Faction | standalone Space Age | Space to Stars (A / B) | reaches the Moon (standalone → here) |
|---|---|---|---|
| Terran Federation | 16.5% | 29.3% / 33.1% | 37.6% → 79–87% |
| Sino-Pacific Hegemony | 19.4% | 13.4% / 14.2% | 35.1% → 53–54% |
| Climate Alliance | 33.6% | 33.6% / 27.6% | 40.3% → 59–61% |
| **Corporate Enclave** | 23.9% | **40.3% / 44.0%** | 41.8% → 75–82% |
| **Solar Caliphate** | 21.8% | **16.5% / 14.3%** | 38.3% → 50–55% |
| Lunar Pioneers | 34.8% | 16.7% / 16.7% | 68.2% → 72–75% |
| — | | | |
| Territory-leader@turn-10 wins | 56.3% | 70.2–74.9% | |
| Decisive (not turn-limit) | 99.5% | 90.0–93.5% | |

**This board amplifies an imbalance it did not create, and the mechanism is in
the last column.** Main's re-tune left the roster spread 16.5–34.8% on its own
map, where a game lasts ~23 turns and everybody reaches the Moon at about the
same rate. Here a game lasts ~46, and the economic factions convert that time
into a Moon foothold at nearly double the rate of the two that do not: the
Corporate Enclave lands in ~80% of its games against the Caliphate's ~52%. On
this board the Moon is the on-ramp to everything, so that gap becomes the
scoreboard — 44% against 14%.

Two other rows worth naming:

- **The Lunar Pioneers are the board's biggest loser**, 34.8% → 16.7%, despite
  still reaching the Moon more than anyone. Their kit is a head start, and a
  46-turn game gives everyone else time to catch up and then out-produce them.
- **The Solar Caliphate is eliminated in ~35% of games**, over the 30% bar the
  Galactic Age holds itself to.

## 4. The tuning that was tried, and what it measured

| Change | Why | Measured |
|---|---|---|
| Exo frontier garrison 4/6 → **3/4** (landing zone / interior) | A far world reached after a whole Space Program "should" defend harder than a field next door. | The fiction is right and the mechanic is inert: exo tiles owned at end sat at 29–30 of 48 at 3/4, 4/6 AND 6/8, and neither the snowball (58–63%) nor the faction spread moved. Weight only cost decisive games — 46.5% / 53.0% at 4/6 against 55.5% / 60.5% at 3/4 — by grinding more games into the cap. Took the lighter one. (Measured pre-merge, without the Moon Race.) |
| Seed the AI jitter | Two identical 20-game runs put the lunar-region sample at n=18 and then n=9. | Removed that source; the start distribution remains unseeded (§ caveat). |

## 5. Open

- **The Corporate Enclave at ~42% and the Sino-Pacific / Caliphate at ~14%**
  (§3), with the Caliphate eliminated in ~35%. The fix belongs to the Space Age
  roster's economy curve rather than to this board, but this board is where it
  becomes unmissable. It should not ship past admin-only until that is retuned —
  and the retune has to be measured HERE as well as on `era_space_age`, because
  the two boards reward different things.
- **The Lunar Pioneers lose half their win rate** on a longer board (§3). Their
  identity is a head start; this board's length is the counter to it.
- **The Moon decides the game**: the Moon-tile leader at the end wins 87–97%,
  and the turn-10 territory leader 70–75% against 56% on the standalone board.
  Reaching the stars still reads as a victory lap more than a second act. The
  Pathfinder Gate and the far worlds' own rules are meant to be the answer; they
  are not enough yet.
- **Start distribution is unseeded** (§ caveat), so this document reports ranges
  rather than single numbers.
- **Only four-player games are measured.**
