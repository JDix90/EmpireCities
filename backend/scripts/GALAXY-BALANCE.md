# Galactic Age balance — measured state

Headless AI-vs-AI balance for the **64-territory** Galactic Age map
(`database/maps/era_galaxy.json`: 4 worlds × 16 territories, 8 hyperspace lanes
in a symmetric ring, 16 gateway tiles). Tool:
[`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

Since the far-world redesign (2026-09-27) the three far worlds are authored
places rather than Voronoi patchworks: Verdan Reach is the Twilight Ring, the
Rust Belt the Sundered Plate, Nexus Station the Shattered Shell. They are built
from specs by `frontend/scripts/buildGalaxyWorlds.ts`, which refuses geometry
whose land borders differ from the designed graph. Sol III is unchanged.

The era's other board — `era_ascension_galaxy`, where a Space Age game climbs
into these worlds rather than starting in them — is audited separately in
[SPACE-TO-STARS-BALANCE.md](./SPACE-TO-STARS-BALANCE.md); nothing in this
document is measured on it.

```sh
# from backend/ — the live create defaults for this era are threshold 60% + cap
# 90 + Lane Sovereignty, so this is the meaningful run:
SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=1000 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-B \
  pnpm exec tsx scripts/simGalaxyBalance.ts        # …and a third seed
SIM_GAMES=1000 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-C \
  pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_EVENTS=1      SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # lane weather
SIM_SOVEREIGNTY=0 SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # kill switch
SIM_WORLD_RULES=0 SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # kill switch
SIM_WORLD_RULES_OFF=storms SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # one rule off
SIM_MAP=/tmp/variant.json SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # knob sweep
```

Knobs: `SIM_MAP` (variant map file), `SIM_GAMES`, `SIM_DIFFICULTY`,
`SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`, `SIM_THRESHOLD`, `SIM_GRIND`,
`SIM_CORRIDORS`, `SIM_WORLD_RULES`, `SIM_WORLD_RULES_OFF` (comma list of
`cradle`, `storms`, `forge`, `vault`), `SIM_SOVEREIGNTY`, `SIM_EVENTS`. 4 players,
one per galaxy faction, faction↔seat rotated per game. Factions ON, naval OFF,
era advancement OFF, stability ON, events OFF (the era's own system defaults are
economy + tech + factions). The sim asserts that each faction starts on its own
home world, so a map whose home regions stop resolving fails loudly instead of
silently measuring a scattered start.

**Every table in §2, §3's phase-7 rows and §5 is 1,000 games per seed at expert
with a 90-turn cap**, re-measured on `main` on 2026-09-27 after the fifth harness
bug in §1 was fixed, seeds `borderfall-galaxy-balance` (A), `…-B` and `…-C`.
Numbers published before that fix — including the far-world redesign PRs
(#443–#447) — were measured on a harness whose games leaked into each other; see
§1. §3 and §4 keep the history, with those rows marked.

## 1. The harness, and the five bugs it had

Each of these made the sim measure a game nobody plays. They are listed because
every number in this document is only as good as the harness that produced it.

- **The grind.** `processAiTurn` spends a turn-wide exchange budget grinding one
  edge until it falls (`ai/aiAttackGrind.ts`); the sim used to resolve each
  planned attack as ONE exchange. That inverted the faction ranking (it had Rust
  at 34% and Sol at 32%; the live AI had them at 14% and 41%). `SIM_GRIND=0`
  reproduces the old behaviour for that comparison.
- **The corridors.** Cross-lane attacks roll at most 2 attacker dice. The
  resolver only knows an edge is a lane if the caller passes the connection; the
  sim did not, so it silently measured the kill-switch game.
- **Neutral off-world capture.** `executeLandAttack` refuses a neutral off-world
  tile unless the caller passes `neutralOffworldCaptureAllowed` after the
  orbit-access check (the socket does). The sim did not, so when the Vault
  arrived its Gate Ring was untouchable: **0 ring tiles taken in 400 games**, and
  the Custodians read as a dead seat.
- **Unseeded AI jitter.** `computeAiTurn` adds heuristic jitter to every
  candidate's score, from `Math.random` — right for live play, fatal for a
  measurement harness. Two runs of the same config on the same seed differed by
  up to **4 points of faction win rate** (seed C gave Forge 18.3% then 14.3%),
  because a reordered candidate list cascades through the whole game. The harness
  now passes a seeded stream. Any single-faction tuning done before that fix
  should be treated as noise.

- **One map for every game.** The sim loaded the map once and handed the same
  object to all its games, and Jump Gates and lane weather write their lanes
  into `map.connections`. Every game therefore began with the previous game's
  last lanes on the board, so games were not independent. Two things followed:
  - the leftover lanes shaped every game's start and fronts, which biased every
    number the sim produced (on seed B, Rust 27.7% on the shared map against
    35.2% on a map per game);
  - an unseeded engine roll that changed one game changed every game after it.
    Two identical 1,000-game runs of seed B matched until game 266 and then
    diverged in 734 of 1,000 games, with faction win rates up to 4 points apart.
  Each game now gets its own copy (`structuredClone`), as `simSpaceAgeBalance.ts`
  already did. Live play never had this: `resolveMap` parses the map afresh and
  each room keeps its own. It surfaced while chasing an apparent three-point
  effect of Rust's Forge die on Sol, which on the fixed harness is 0.8 points.

**The harness is deterministic up to a few unseeded engine rolls.** Dice and AI
jitter are seeded; stability's population and rebellion rolls, the card-deck
shuffle and the game id still draw from `crypto`. With games independent, those
change a game or two per thousand (2 of 1,000 on seed B) and no longer spread:
two runs of one seed give the same win rates. The noise that remains is sampling
noise, about ±1.4 points per faction per 1,000-game seed.

## 2. Where the era stands (after the far-world redesign, live defaults)

Corridors ON, world rules ON, Lane Sovereignty ON, threshold 60 + cap 90.

| Metric | A | B | C |
|---|---|---|---|
| Avg game length | 26.1 | 25.7 | 25.8 turns |
| Decisive (not turn-limit) | 99.8% | 99.5% | 99.6% |
| Won by Lane Sovereignty | 38.4% | 36.6% | 37.7% |
| Won by threshold | 61.4% | 62.9% | 61.9% |
| Territory-leader@turn-10 wins | 58.8% | 58.1% | 61.7% |
| Lane end-owner changes per game | 64.6 | 63.0 | 64.0 |
| Vault (Gate Ring) held at end | 57.6% | 58.5% | 57.4% |
| …of which by the Custodians | 37.3% | 38.5% | 35.9% |
| Games that opened a Jump Gate lane | 99.7% | 99.9% | 99.7% |

| Faction | World | A | B | C | avg | eliminated (A/B/C) |
|---|---|---|---|---|---|---|
| stellar_mandate | Sol | 23.6% | 23.6% | 25.7% | **24.3%** | 17.8 / 19.3 / 15.2% |
| forge_syndicate | Rust | 39.2% | 35.2% | 36.4% | **36.9%** | 3.7 / 2.5 / 3.2% |
| helion_navigators | Verdan | 18.1% | 19.7% | 17.4% | **18.4%** | 10.3 / 7.1 / 9.2% |
| void_custodians | Nexus | 19.1% | 21.5% | 20.5% | **20.4%** | 13.7 / 13.9 / 15.1% |

### The gate

The exit bar from Phase 3 onward: decisive ≥ 80%, every faction within 18–32%,
no faction eliminated in more than 30% of games, lanes changing state at least
six times per game. Phase 5 adds "Sovereignty ends at least a quarter of decisive
games"; Phase 6 adds "gates built in at least half of games" and "a surge lane is
crossed when it appears".

**The era fails the gate.** Forge is over the 32% ceiling on every seed
(35.2–39.2%) and is almost never eliminated (2.5–3.7%). Verdan is under the 18%
floor on seed C and just above it on A. Everything else passes.

**Before the redesign the same era passed.** The pre-redesign board, re-measured
on the fixed harness (the map from `dd92cd9`, current code):

| Board (A / B / C) | Sol | Rust | Verdan | Nexus | Gate |
|---|---|---|---|---|---|
| Before the redesign | 30.9 / 27.9 / 30.7 | 26.1 / 29.4 / 27.0 | 21.3 / 22.3 / 19.6 | 21.7 / 20.4 / 22.7 | pass |
| After (live) | 23.6 / 23.6 / 25.7 | 39.2 / 35.2 / 36.4 | 18.1 / 19.7 / 17.4 | 19.1 / 21.5 / 20.5 | **fail** |

The redesign PRs reported passes because they were measured on the leaking
harness. On the fixed one, the redesign moved about ten points to Forge, mostly
from Sol and a little from Verdan and Nexus.

### Read

1. **The Sundered Plate is too strong a fortress.** Verdan's lanes land on the
   dead ends of Rust's west plate and Nexus's on the east; Forge is eliminated in
   3% of games and wins over a third.
2. **Verdan is the weakest seat** (18.4%), squeezed between Forge and Sol.
3. **Sol, the unchanged world, lost the most** (29.8% → 24.3%), but stays inside
   the band.
4. **The Vault is contested**: held at the end of ~58% of games, by the
   Custodians in ~37%.
5. **The snowball is unchanged**: the turn-10 leader wins ~60%, as before.
6. **Two ways to win, both live.** Sovereignty ends ~38% of games.
7. **Lanes change hands less** (~64 times a game, against ~69 before the
   redesign): the new worlds have fewer ways in.

## 3. What each phase moved

Threshold-60 default. Phase 0–4 rows predate the jitter fix, so treat them as
±3 points. **Every row up to and including "7 as first published" was measured
on the leaking harness (§1)**; only the rows marked *fixed harness* are
comparable with §2.

| Phase | Sol | Rust | Verdan | Nexus | Decisive | Turns |
|---|---|---|---|---|---|---|
| 0 · grind-faithful harness, era as found | 41.3 | 13.8 | 16.0 | 29.0 | 86.5 | 45.4 |
| 3 · corridors: no gate, lane cap, kits rebuilt | 22.5 | 14.5 | 32.0 | 31.0 | 93.0 | ~32 |
| 4 · worlds as characters | 27.8 | 19.3 | 29.5 | 23.5 | 91.5 | 33.8 |
| 5 · Lane Sovereignty | ~28 | ~16 | ~33 | ~24 | 97 | 27 |
| 6 · Jump Gates + lane weather | 25.8 | 18.2 | 27.1 | 29.0 | 96.6 | 30.1 |
| 7 as first published (leaking harness) | 21.0 | 29.2 | 25.4 | 24.4 | 99.4 | 28.0 |
| 6, pre-redesign board, *fixed harness* | 29.8 | 27.5 | 21.1 | 21.6 | 99.6 | 26.0 |
| **7 · far-world redesign, *fixed harness*** | **24.3** | **36.9** | **18.4** | **20.4** | 99.6 | 25.9 |
| 7 with `SIM_SOVEREIGNTY=0`, *fixed* | 24.0 | 38.7 | 17.5 | 19.8 | 99.5 | 27.8 |
| 7 with `SIM_EVENTS=1`, *fixed* | 20.5 | 44.4 | 16.7 | 18.5 | 99.1 | 27.7 |
| 7 with `SIM_WORLD_RULES=0`, *fixed* | 22.9 | 49.2 | 15.2 | 12.7 | 99.4 | 26.7 |

*Fixed-harness rows are three-seed averages of 1,000 games each.*

**Sovereignty still does its catch-up job**: without it the turn-10 leader wins
61% instead of ~60%, and Forge climbs another two points.

**The world-rules kill switch.** It used to hand the Custodians the Vault at
start (the ring's neutral garrison and their home bonus were gated on it). The
starting layout now follows the map whatever the switch says; the switch turns
off the Vault's payouts (tech, Emergency Seal, AI weighting) and every other
rule. `galaxy_world_rules_enabled` stays the master, and under it each rule has
its own flag, default ON: `galaxy_rule_cradle_enabled`,
`galaxy_rule_storms_enabled`, `galaxy_rule_forge_enabled` and
`galaxy_rule_vault_enabled`, baked at create as `settings.world_rules_disabled`.

One rule off at a time through that switch (`SIM_WORLD_RULES_OFF`), fixed
harness, 1,000 games per seed:

| Rule off (A / B / C) | Sol | Rust | Verdan | Nexus | Leader@10 |
|---|---|---|---|---|---|
| none (live) | 23.6 / 23.6 / 25.7 | 39.2 / 35.2 / 36.4 | 18.1 / 19.7 / 17.4 | 19.1 / 21.5 / 20.5 | 58.8 / 58.1 / 61.7% |
| Sol's Cradle | 23.6 / 23.6 / 25.7 | 39.2 / 35.2 / 36.4 | 18.1 / 19.7 / 17.4 | 19.1 / 21.5 / 20.5 | 58.8 / 58.1 / 61.7% |
| Rust's Forge die | 22.6 / 22.8 / 25.1 | 40.8 / 37.4 / 38.0 | 17.5 / 18.9 / 16.7 | 19.1 / 20.9 / 20.2 | 60.0 / 57.2 / 62.1% |
| Verdan's Storms | 24.9 / 25.1 / 27.9 | 38.3 / 34.5 / 34.0 | 15.0 / 15.9 / 14.0 | 21.8 / 24.5 / 24.1 | 59.4 / 59.5 / 60.0% |
| Nexus Vault | 22.8 / 23.8 / 22.2 | 47.3 / 46.3 / 50.4 | 21.6 / 19.4 / 18.1 | 8.3 / 10.5 / 9.3 | 65.6 / 65.2 / 68.8% |
| all (the master) | 23.6 / 22.5 / 22.7 | 47.1 / 50.4 / 50.1 | 16.1 / 14.7 / 14.8 | 13.2 / 12.4 / 12.4 | 66.4 / 64.4 / 66.7% |

What each switch costs, against a live game that already fails on Forge:

- **Cradle:** nothing at all. The runs are identical to live to the decimal: in
  these games the Cradle never changes an outcome.
- **Forge die:** about two points more for Forge; Sol and Verdan each lose
  under a point. (The earlier "three points off Sol" was the harness leak.)
- **Storms:** Verdan loses about three and a half points (to ~15%); Sol and
  Nexus gain.
- **Vault:** the Custodians collapse to ~9% and Forge reaches ~48%. The Vault is
  what holds Nexus up.
- **The master:** Forge ~49%, Nexus ~13%, Verdan ~15%.

## 4. The tuning that got here, and what it cost

Phase 6 rows are 400 games × 3 seeds on the old board; phase 7 rows are 1,000
games × 3 seeds on the redesigned one. **Every "Measured" figure below comes from
the leaking harness (§1)**, so treat the phase-7 tuning — Vault +1 and Nexus
tech 0.084 — as chosen on bad numbers and due for re-measurement with the rest.

| Change | Why | Measured |
|---|---|---|
| **Jump Gate lanes carry no attack** | With gate lanes fighting like authored ones, mobility paid the leader: turn-10 leader 55% → 68%, games down to 25.7 turns, Sol 38%, and the Forge Syndicate — whose gates these are — down to 13.5%, because mobility erodes exactly the positional defence a turtle lives on. | Sol 38.0 → 26.5, leader 68 → 60 (200g, seed A) |
| **Vault `home_unit_bonus` removed** (Phase 6; reversed in phase 7) | It was Phase 4 compensation for the Custodians starting without the ring; by Phase 6 they were the strongest seat. | Nexus 34.4 → 27.1 avg |
| **Forge `reinforce_bonus` 1 → 2** | The only purely economic kit in the era, and the one that kept losing anyway. Its buildings and half-price gates were already the most-built of the four and did not convert. | Rust 14.3 → 19.5 avg |
| **Sol research discount removed** | The last compounding lever. Sol III is the centre of the ring and worth ~24% on position alone; the discount added ten points on top. | Sol 34.6 → 25.8 avg |
| **Phase 7: far worlds rebuilt** (Verdan, then Rust, then Nexus, one PR each) | Three identical Voronoi patchworks with no seas and alphabetical gateways. Each world now has authored chokepoints, lanes placed on purpose, and 4–6 regions whose bonuses still total 12. | Rust 17.9 → 29.2, Sol 25.0 → 21.0 |
| **Phase 7: Vault `home_unit_bonus` back to 1** | On the Shattered Shell the Vault is the hub every inner shard bridges into, and the Custodians start without it. Without the bonus Nexus fell to ~8% and Forge rose to ~44% (seeds A and B); at 2, Verdan went over the ceiling (~34%) and Sol under the floor (~15%). | Nexus 16–19 → 24.4 |
| **Phase 7: Nexus `tech_bonus` 0.0625 → 0.084** | At 0.0625 per tile the Custodians' 12 opening tiles floored to 0 tech points; 0.084 makes it 1. Vault +1 alone left Nexus at 16–19% and Rust at 30–34%. | Rust 32.5 → 29.2, Nexus 18.0 → 24.4 |

Two things were tried and **rejected on the evidence**:

- **A production-to-attack die for Forge** (+1 attack die from a territory with a
  production building). It moved Forge 12.5% → 12.5%. A balance lever that does
  not move the number it exists for is surface for nothing, so it came out.
- **Capping the AI at two gate worlds** instead of three. Sol 45%, Verdan 14% —
  worse on both ends, and the gate counts barely changed because captured gates
  get rebuilt.

**Sol's Cradle world rule is inert** (Phase 6, and again on the fixed harness,
where switching it off changes nothing at all). Removing `population_growth_mult`
changed nothing on two of three seeds; removing `deploy_cap_bonus` changed
nothing on any (the deploy cap only binds below 50 stability, which the AI rarely
reaches). Sol's identity is currently carried by Blockade Runner and by position.
Giving that world a rule that actually fires is the clearest next balance job.

## 5. Lane weather (`SIM_EVENTS=1`)

Events are off by default for this era, so weather is measured on its own run.

| Metric (fixed harness) | A | B | C |
|---|---|---|---|
| Nebula Closures per game | 2.1 | 2.2 | 2.3 |
| Lane Surges per game | 2.2 | 2.2 | 2.2 |
| Games opening a surge where somebody crossed it | 88.3% | 90.2% | 88.6% |
| Surge crossings total | 5955 | 6069 | 5559 |

With events on, Forge reaches 44.4% (§3), so turning events on for this era would
need its own pass.

A harness bug surfaced here too: the socket clears `active_event` once it has
broadcast the card, and with no socket the sim left it set, re-applying the same
instant card every round (11.6 "closures" per game where the deck can deal about
4). The sim now clears it the way `broadcastEventCard` does.

## 6. Open

- **Forge is over the ceiling** (36.9%; 35.2–39.2% by seed) and almost never
  eliminated. This is the first balance job: the redesigned Rust Belt needs
  retuning, measured on the fixed harness.
- **Verdan is at the floor** (18.4%; under it on seed C).
- **The phase-7 tuning was chosen on the leaking harness** (§4): the Vault's
  `home_unit_bonus: 1` and Nexus `tech_bonus: 0.084`. Neither has been re-chosen.
- **Sol's Cradle rule does nothing measurable** (§3, §4). A rule that fires
  would be the natural place for Sol's identity.
- **Only the Cradle switch is balance-free** (§3). The master and the Storms,
  Vault and Forge switches each move the era further from the gate; each is a
  last resort for a broken rule, not a tuning knob.
- **Events on** pushes Forge to 44%.
- **The snowball**: turn-10 leader at ~60%.
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows (`GALAXY_REQUIRED_PLAYERS = 4`): the one-faction-per-world
  start fires only for four seats with four distinct factions, and the Vault
  start assumes it.

## History

- **2026-09-27 (harness fix):** one map per sim game (§1). Every table
  re-measured; the era fails the gate on Forge.
- **2026-09-27 (Phase 7, far-world redesign):** Verdan, Rust and Nexus rebuilt
  from authored specs, one PR each, each measured on 1,000 games × 3 seeds
  before merging — on the leaking harness; Vault `home_unit_bonus` back to 1 and
  Nexus tech 0.084. As published: Sol 25 → 21, Rust 18 → 29, Verdan 27 → 25,
  Nexus 30 → 24. On the fixed harness: Sol 30 → 24, Rust 28 → 37, Verdan 21 → 18,
  Nexus 22 → 20.
- **2026-09-10 (Phases 5–6):** Lane Sovereignty, Jump Gates and lane weather;
  Vault bonus removed, Forge reinforce 2, Sol research discount removed.
- **2026-09-09 (Phases 0–4):** grind-faithful harness; Nexus tech yield 0.05 →
  0.0625 (it floored to zero); corridors replaced the Hyperspace Chart gate;
  worlds got their rules. Sol 41 → 28, Rust 14 → 19.
- **Pre-fix baseline (obsolete):** the pre-densification map on the
  single-exchange harness — stellar_mandate 2.0% / 1.2%, forge_syndicate 36% /
  33%, helion_navigators 35% / 41%, void_custodians 27% / 25%; ~45% of games hit
  the cap.
