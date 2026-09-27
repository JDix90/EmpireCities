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

**Every table in §2, §3's fixed-harness rows and §5 is 1,000 games per seed at
expert with a 90-turn cap**, on the fixed harness (§1), seeds
`borderfall-galaxy-balance` (A), `…-B` and `…-C`. §2 is the board after the
Rust/Verdan retune (§4). Numbers published before the harness fix — including
the far-world redesign PRs (#443–#447) — came from a harness whose games leaked
into each other; §3 and §4 keep that history, with those rows marked.

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

## 2. Where the era stands (after the Rust/Verdan retune, live defaults)

Corridors ON, world rules ON, Lane Sovereignty ON, threshold 60 + cap 90.

| Metric | A | B | C |
|---|---|---|---|
| Avg game length | 25.6 | 24.4 | 25.9 turns |
| Decisive (not turn-limit) | 99.5% | 99.8% | 99.8% |
| Won by Lane Sovereignty | 34.5% | 33.4% | 33.6% |
| Won by threshold | 65.0% | 66.4% | 66.2% |
| Territory-leader@turn-10 wins | 63.2% | 63.1% | 60.8% |
| Lane end-owner changes per game | 65.3 | 62.1 | 66.8 |
| Vault (Gate Ring) held at end | 61.9% | 64.5% | 62.0% |
| …of which by the Custodians | 44.8% | 47.5% | 46.0% |
| Games that opened a Jump Gate lane | 99.9% | 100% | 100% |

| Faction | World | A | B | C | avg | eliminated (A/B/C) |
|---|---|---|---|---|---|---|
| stellar_mandate | Sol | 24.7% | 20.3% | 22.5% | **22.5%** | 19.7 / 19.5 / 19.4% |
| forge_syndicate | Rust | 29.2% | 30.5% | 29.4% | **29.7%** | 7.5 / 7.7 / 8.6% |
| helion_navigators | Verdan | 19.9% | 19.9% | 20.5% | **20.1%** | 7.0 / 6.5 / 7.6% |
| void_custodians | Nexus | 26.2% | 29.3% | 27.6% | **27.7%** | 9.4 / 10.4 / 10.6% |

### The gate

The exit bar from Phase 3 onward: decisive ≥ 80%, every faction within 18–32%,
no faction eliminated in more than 30% of games, lanes changing state at least
six times per game. Phase 5 adds "Sovereignty ends at least a quarter of decisive
games"; Phase 6 adds "gates built in at least half of games" and "a surge lane is
crossed when it appears".

**Everything passes on every seed.** The spread is 19.9–30.5%. Before the retune
Forge was over the ceiling on every seed (35.2–39.2%) and Verdan under the floor
on one.

### Read

1. **Rust is still the fortress, now a breakable one.** One of Verdan's lanes
   lands on Crucible Deep, the Tharsis hub, and Nexus's on Hematite Span, the
   Hesperia hub, so a landing can spread; Forge is eliminated in ~8% of games
   instead of ~3%.
2. **Verdan is the weakest seat** at 20.1%, inside the band on every seed.
3. **Sol is the most often eliminated** (~19.5%) and its win rate varies most by
   seed (20.3–24.7%).
4. **The Vault matters more**: held at the end of ~63% of games, by the
   Custodians in ~46%.
5. **The snowball is a little stronger**: the turn-10 leader wins ~62% (~60%
   before the retune).
6. **Two ways to win, both live.** Sovereignty ends about a third of games.

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
| 7 · far-world redesign, *fixed harness* | 24.3 | 36.9 | 18.4 | 20.4 | 99.6 | 25.9 |
| **7 · Rust/Verdan retune, *fixed harness* (live)** | **22.5** | **29.7** | **20.1** | **27.7** | 99.7 | 25.3 |
| retune with `SIM_SOVEREIGNTY=0` | 22.7 | 27.7 | 21.6 | 28.0 | 99.4 | 26.8 |
| retune with `SIM_EVENTS=1` | 19.0 | 30.9 | 22.6 | 27.5 | 98.9 | 27.9 |
| retune with `SIM_WORLD_RULES=0` | 23.6 | 39.8 | 17.4 | 19.2 | 99.4 | 26.5 |

*Fixed-harness rows are three-seed averages of 1,000 games each.*

**Sovereignty still does its catch-up job**, now more clearly: without it the
turn-10 leader wins ~60% instead of ~62%, but Sol is eliminated in a quarter of
games (24–26%). Both switch settings pass the gate.

**The world-rules kill switch.** It used to hand the Custodians the Vault at
start (the ring's neutral garrison and their home bonus were gated on it). The
starting layout now follows the map whatever the switch says; the switch turns
off the Vault's payouts (tech, Emergency Seal, AI weighting) and every other
rule. `galaxy_world_rules_enabled` stays the master, and under it each rule has
its own flag, default ON: `galaxy_rule_cradle_enabled`,
`galaxy_rule_storms_enabled`, `galaxy_rule_forge_enabled` and
`galaxy_rule_vault_enabled`, baked at create as `settings.world_rules_disabled`.

One rule off at a time through that switch (`SIM_WORLD_RULES_OFF`), fixed
harness, retuned board, 1,000 games per seed:

| Rule off (A / B / C) | Sol | Rust | Verdan | Nexus | Leader@10 | Gate |
|---|---|---|---|---|---|---|
| none (live) | 24.7 / 20.3 / 22.5 | 29.2 / 30.5 / 29.4 | 19.9 / 19.9 / 20.5 | 26.2 / 29.3 / 27.6 | 63.2 / 63.1 / 60.8% | pass |
| Sol's Cradle | 24.7 / 20.3 / 22.5 | 29.3 / 30.5 / 29.4 | 19.9 / 19.9 / 20.5 | 26.1 / 29.3 / 27.6 | 63.3 / 63.1 / 60.8% | **pass** |
| Rust's Forge die | 24.5 / 18.7 / 23.3 | 30.5 / 30.8 / 29.0 | 19.8 / 21.3 / 19.1 | 25.2 / 29.2 / 28.6 | 63.1 / 63.7 / 62.1% | **pass** |
| Verdan's Storms | 25.5 / 21.9 / 22.7 | 27.0 / 28.5 / 27.4 | 16.7 / 14.9 / 14.8 | 30.8 / 34.7 / 35.1 | 58.9 / 58.0 / 57.7% | fail: Verdan, Nexus |
| Nexus Vault | 23.5 / 23.5 / 21.0 | 43.9 / 39.9 / 40.7 | 19.4 / 20.2 / 23.7 | 13.2 / 16.4 / 14.6 | 67.3 / 64.1 / 66.3% | fail: Rust, Nexus |
| all (the master) | 24.1 / 24.3 / 22.4 | 41.0 / 38.9 / 39.4 | 16.5 / 16.1 / 19.6 | 18.4 / 20.7 / 18.6 | 64.5 / 65.9 / 65.4% | fail: Rust, Verdan |

What each switch costs:

- **Cradle:** nothing at all; the runs match live to the decimal.
- **Forge die:** under a point for anyone. Sol dips to 18.7% on seed B, just
  inside the floor.
- **Storms:** Verdan loses ~4.5 points (to ~15.5%) and Nexus climbs over the
  ceiling on two seeds. The Storms still carry Verdan.
- **Vault:** the Custodians fall to ~15% and Forge climbs to ~41%.
- **The master:** Forge ~40%, Verdan ~17%.

So the Cradle and Forge-die switches are now balance-free; the Storms, Vault and
master switches are last resorts for a rule that is actually broken.

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
| **Retune: two lanes back onto hubs** (*fixed harness*) | Both of Verdan's lanes landed in Argyre Marches, one three-tile region, so Forge held its whole Verdan front in one place; Nexus's landed on Ferro Span, a shoulder. Sulphur Drift → Crucible Deep (Tharsis hub) and Antenna Spire → Hematite Span (Hesperia hub), the endpoints from before #444. | Rust 39.2 → 34.6 (seed A) |
| **Retune: Rust region bonuses 12 → 10** (Anchor Works 2, Tharsis 1) | With the lanes moved, Forge was still at 34.6% (seed A). | with the next row |
| **Retune: Verdan region bonuses 12 → 14** (Dawnrim 4, Brilliance Isles 4) | Verdan sat at the floor; raising Rust's alone gave the ground to Nexus. | all four 19.9–30.5% on every seed |
| **Retune: Vault `home_unit_bonus` 1 and Nexus tech 0.084 re-checked** (*fixed harness*) | Both were chosen on the leaking harness. On the retuned board: bonus 0 sends Forge to 51–53% and Nexus to 13–15%; tech 0.0625 puts Forge at 33.4% on seed B. | both stay |

These were tried and **rejected on the evidence** (the retune's screening is
seed A, 1,000 games, fixed harness):

- **Economic levers for Rust and Verdan.** Rust's world `production_bonus`
  0.4 → 0.2 or 0.3 and Verdan's 0.2 → 0.35 left every faction within 0.1 of live,
  and Forge's Jump Gates at full price changed nothing at all. Rust's lead was
  positional, not economic.
- **Forge `reinforce_bonus` 2 → 1.** Forge stayed at 39.0%; Sol fell to 19.2%.
- **Verdan's storm threshold 12 → 16.** Forge −1, Verdan −0.4.
- **Region bonuses alone.** Rust 12 → 9 took Forge to 35.3% and Verdan 12 → 14
  to 34.4%; the ground went to Nexus, not Verdan, until the lanes moved.

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

| Metric (retuned board) | A | B | C |
|---|---|---|---|
| Nebula Closures per game | 2.3 | 2.2 | 2.2 |
| Lane Surges per game | 2.2 | 2.2 | 2.2 |
| Games opening a surge where somebody crossed it | 89.3% | 88.7% | 85.5% |
| Surge crossings total | 5756 | 6185 | 5785 |

With events on the retuned board passes the gate (§3), though Sol sits at
18.3–20.3%.

A harness bug surfaced here too: the socket clears `active_event` once it has
broadcast the card, and with no socket the sim left it set, re-applying the same
instant card every round (11.6 "closures" per game where the deck can deal about
4). The sim now clears it the way `broadcastEventCard` does.

## 6. Open

- **Sol is the most often eliminated seat** (~19.5%; a quarter of games with
  Sovereignty off) and the most seed-sensitive (20.3–24.7%). Inside the band.
- **Sol's Cradle rule does nothing measurable** (§3, §4). A rule that fires
  would be the natural place for Sol's identity.
- **The Storms, Vault and master switches fail the gate** (§3); each is a last
  resort for a rule that is actually broken.
- **The snowball**: turn-10 leader at ~62%.
- **Region bonus totals are no longer equal**: Rust 10, Verdan 14, Sol and Nexus
  12. The design principle was 12 per world; the geography now carries the
  difference.
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows (`GALAXY_REQUIRED_PLAYERS = 4`): the one-faction-per-world
  start fires only for four seats with four distinct factions, and the Vault
  start assumes it.

## History

- **2026-09-27 (Rust/Verdan retune):** two lanes back onto hubs, Rust region
  bonuses 12 → 10, Verdan 12 → 14; Vault +1 and Nexus tech 0.084 re-checked and
  kept. Sol 24 → 22.5, Rust 37 → 30, Verdan 18 → 20, Nexus 20 → 28. Passes the
  gate on every seed.
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
