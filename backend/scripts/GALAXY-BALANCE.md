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
`cradle`, `storms`, `forge`, `vault`), `SIM_SOVEREIGNTY`, `SIM_EVENTS`,
`SIM_FACTION_PATCH` (JSON faction-kit overrides), `SIM_SCATTERED`,
`SIM_FACTIONS=0`, `SIM_PLAIN_LANES` and `SIM_CATCHUP_PER` (§6),
`SIM_PLAYERS`, `SIM_COLONY_GARRISON` and `SIM_SOVEREIGNTY_ROUNDS` (§7), and
`SIM_HOUSE_RELATIONS`, `SIM_CONCORD_ROUNDS`, `SIM_LANE_CROWN`,
`SIM_SCHISM_HALVES`, `SIM_SCHISM_OPENING` and `SIM_SCHISM_REINFORCE` (§8).
4 players by default, one per galaxy faction, faction↔seat rotated per game; at
2 or 3 the line-up also rotates through every combination of factions; at 8
every faction plays twice (§8). Factions ON, naval OFF,
era advancement OFF, stability ON, events OFF (the era's own system defaults are
economy + tech + factions). The sim asserts that each faction starts on its own
home world, so a map whose home regions stop resolving fails loudly instead of
silently measuring a scattered start.

**Every table in §2, §3's fixed-harness rows and §5 is 1,000 games per seed at
expert with a 90-turn cap**, on the fixed harness (§1), seeds
`borderfall-galaxy-balance` (A), `…-B` and `…-C`. §2 is the board after the
Cradle muster (§4). Numbers published before the harness fix — including
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

## 2. Where the era stands (after the Cradle muster, live defaults)

Corridors ON, world rules ON, Lane Sovereignty ON, threshold 60 + cap 90.

| Metric | A | B | C |
|---|---|---|---|
| Avg game length | 27.7 | 26.5 | 27.0 turns |
| Decisive (not turn-limit) | 99.0% | 99.6% | 99.5% |
| Won by Lane Sovereignty | 35.3% | 36.0% | 35.3% |
| Won by threshold | 63.7% | 63.6% | 64.2% |
| Territory-leader@turn-10 wins | 60.8% | 63.4% | 61.4% |
| Lane end-owner changes per game | 72.9 | 70.2 | 71.8 |
| Vault (Gate Ring) held at end | 61.7% | 64.0% | 63.3% |
| …of which by the Custodians | 45.9% | 45.8% | 46.3% |
| Games that opened a Jump Gate lane | 99.7% | 99.9% | 99.8% |

| Faction | World | A | B | C | avg | eliminated (A/B/C) |
|---|---|---|---|---|---|---|
| stellar_mandate | Sol | 25.0% | 21.5% | 25.3% | **23.9%** | 24.9 / 25.6 / 24.6% |
| forge_syndicate | Rust | 26.0% | 27.5% | 25.4% | **26.3%** | 10.0 / 9.1 / 6.9% |
| helion_navigators | Verdan | 20.9% | 22.1% | 19.8% | **20.9%** | 8.3 / 5.6 / 7.5% |
| void_custodians | Nexus | 28.1% | 28.9% | 29.5% | **28.8%** | 11.0 / 11.6 / 8.8% |

### The gate

The exit bar from Phase 3 onward: decisive ≥ 80%, every faction within 18–32%,
no faction eliminated in more than 30% of games, lanes changing state at least
six times per game. Phase 5 adds "Sovereignty ends at least a quarter of decisive
games"; Phase 6 adds "gates built in at least half of games" and "a surge lane is
crossed when it appears".

**Everything passes on every seed.** The spread is 19.8–29.5%, tighter than the
retune's 19.9–30.5%.

### Read

1. **Every rule now fires.** Sol's Cradle was inert until the muster (§4);
   switching it off now costs Sol ~4 points.
2. **Rust is still the fortress, now a breakable one.** One of Verdan's lanes
   lands on Crucible Deep, the Tharsis hub, and Nexus's on Hematite Span, the
   Hesperia hub, so a landing can spread; Forge is eliminated in ~9% of games.
3. **Verdan is the weakest seat** at 20.9%, inside the band on every seed.
4. **Sol is the most often eliminated** (~25%, up from ~19.5%): Verdan's +2
   reinforcements come out of Sol, its natural prey. Inside the 30% limit.
5. **The Vault matters**: held at the end of ~63% of games, by the Custodians
   in ~46%.
6. **The snowball is unchanged**: the turn-10 leader wins ~62%.
7. **Two ways to win, both live.** Sovereignty ends about a third of games.

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
| 7 · Rust/Verdan retune, *fixed harness* | 22.5 | 29.7 | 20.1 | 27.7 | 99.7 | 25.3 |
| **7 · Cradle muster + Verdan +2, *fixed harness* (live)** | **23.9** | **26.3** | **20.9** | **28.8** | 99.4 | 27.1 |
| muster with `SIM_SOVEREIGNTY=0` | 23.7 | 25.2 | 21.4 | 29.8 | 99.2 | 28.7 |
| muster with `SIM_EVENTS=1` | 21.1 | 24.8 | 26.0 | 28.1 | 98.6 | 28.6 |
| muster with `SIM_WORLD_RULES=0` | 19.1 | 35.9 | 18.2 | 26.8 | 99.4 | 27.8 |

*Fixed-harness rows are three-seed averages of 1,000 games each.*

**Sovereignty still does its catch-up job**: without it Sol is eliminated in
29.1–29.6% of games, just inside the 30% limit, instead of ~25%. Both switch
settings pass the gate.

**The world-rules kill switch.** It used to hand the Custodians the Vault at
start (the ring's neutral garrison and their home bonus were gated on it). The
starting layout now follows the map whatever the switch says; the switch turns
off the Vault's payouts (tech, Emergency Seal, AI weighting) and every other
rule. `galaxy_world_rules_enabled` stays the master, and under it each rule has
its own flag, default ON: `galaxy_rule_cradle_enabled`,
`galaxy_rule_storms_enabled`, `galaxy_rule_forge_enabled` and
`galaxy_rule_vault_enabled`, baked at create as `settings.world_rules_disabled`.

One rule off at a time through that switch (`SIM_WORLD_RULES_OFF`), fixed
harness, live board (Cradle muster), 1,000 games per seed:

| Rule off (A / B / C) | Sol | Rust | Verdan | Nexus | Leader@10 | Gate |
|---|---|---|---|---|---|---|
| none (live) | 25.0 / 21.5 / 25.3 | 26.0 / 27.5 / 25.4 | 20.9 / 22.1 / 19.8 | 28.1 / 28.9 / 29.5 | 60.8 / 63.4 / 61.4% | pass |
| Sol's Cradle | 21.8 / 18.7 / 19.6 | 25.0 / 28.4 / 24.4 | 23.4 / 22.3 / 22.4 | 29.8 / 30.6 / 33.6 | 60.4 / 61.7 / 60.0% | fail: Nexus (seed C) |
| Rust's Forge die | 23.8 / 20.5 / 23.3 | 27.8 / 29.5 / 27.1 | 20.8 / 22.0 / 19.5 | 27.6 / 28.0 / 30.1 | 61.0 / 63.6 / 63.4% | **pass** |
| Verdan's Storms | 26.0 / 23.7 / 26.1 | 20.6 / 21.2 / 21.6 | 16.0 / 15.1 / 13.6 | 37.4 / 40.0 / 38.7 | 54.2 / 55.5 / 56.5% | fail: Verdan, Nexus |
| Nexus Vault | 23.8 / 24.6 / 24.0 | 37.8 / 36.8 / 35.5 | 23.0 / 22.8 / 24.4 | 15.4 / 15.8 / 16.1 | 65.9 / 66.5 / 67.3% | fail: Rust, Nexus |
| all (the master) | 20.6 / 17.4 / 19.2 | 35.8 / 38.4 / 33.5 | 18.8 / 16.9 / 18.9 | 24.8 / 27.3 / 28.4 | 59.1 / 58.8 / 59.9% | fail: Sol, Rust, Verdan |

What each switch costs:

- **Cradle:** Sol loses ~4 points (to ~20%) and the Custodians gain ~2.5,
  crossing the ceiling on seed C (33.6%). Verdan keeps its +2 reinforcements
  with nothing to pay for, and gains ~2.
- **Forge die:** under two points for anyone. The only balance-free switch.
- **Storms:** Verdan loses ~6 points (to ~15%) and Nexus climbs to ~39%. The
  Storms still carry Verdan.
- **Vault:** the Custodians fall to ~16% and Forge climbs to ~37%.
- **The master:** Forge ~36%, Sol ~19% (17.4% on seed B), Verdan ~18%.

So the Forge-die switch is balance-free; the Cradle, Storms, Vault and master
switches are last resorts for a rule that is actually broken. The Cradle's
failure is the price of it firing: its offset (Verdan's +2) lives in the
faction kit, which no world-rule switch reaches.

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
| **Cradle: the muster replaces the deploy cap and population** (*fixed harness*) | The old Cradle (`deploy_cap_bonus` 2, `population_growth_mult` 2) was inert: switching it off matched live to the decimal. The deploy cap only binds below 50 stability, which the AI rarely reaches, and population only scales building income, a lever §4 shows is inert. The muster is the storms' mirror, and what the Mandate's description already promised ("a population that replaces what it loses"): every 5th round, each Sol tile held with fewer than 2 units gains 1. | Sol 24.7 → 30.1, Verdan 19.9 → 17.1 (seed A) |
| **Verdan `reinforce_bonus` 0 → 2** | Verdan is Sol's main target (Sol captures a third more tiles from Verdan than from the Custodians, and three times what it takes from Forge), so every Cradle that fired came out of Verdan's share. +1 held seed A (19.2%) but not B or C (15.9–16.9% with the every-3rd-round muster). | all four 19.8–29.5% on every seed |

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

**Choosing the muster** (seed A unless noted, 1,000 games each; `N` is the
threshold, the cadence is how often it fires). A control with `N` = 1, which
can never fire, matched live exactly, so every shift below is the rule's own:

| Muster | Verdan kit | Sol | Rust | Verdan | Nexus |
|---|---|---|---|---|---|
| none (the retune) | — | 24.7 | 29.2 | 19.9 | 26.2 |
| N 2, every round | — | 32.4 | 30.1 | 17.0 | 20.5 |
| N 3 / 4 / 5, every round | — | 34.7 / 38.9 / 38.3 | 30.6 / 39.6 / 44.9 | 12.4 / 7.3 / 6.1 | 22.3 / 14.2 / 10.7 |
| N 2, every 2nd / 3rd / 4th / 5th round | — | 33.9 / 31.0 / 29.7 / 30.1 | 27.9 / 30.2 / 29.3 / 27.2 | 16.7 / 14.3 / 16.4 / 17.1 | 21.5 / 24.5 / 24.6 / 25.6 |
| N 2, every 3rd, Sol regions 12 → 10 / 8 | — | 29.4 / 27.1 | 26.9 / 27.2 | 17.5 / 16.8 | 26.2 / 28.9 |
| N 2, every 3rd | +1 (A / B / C) | 29.5 / 28.1 / 30.1 | 25.3 / 27.6 / 25.8 | 19.2 / 16.9 / 15.9 | 26.0 / 27.4 / 28.2 |
| N 2, every 3rd | +2 (A / B / C) | 27.3 / 24.5 / 27.2 | 27.1 / 26.5 / 23.6 | 18.9 / 20.0 / 18.9 | 26.7 / 29.0 / 30.3 |
| **N 2, every 5th (shipped)** | **+2 (A / B / C)** | **25.0 / 21.5 / 25.3** | **26.0 / 27.4 / 25.4** | **20.9 / 22.2 / 19.8** | **28.1 / 28.9 / 29.5** |

- **Any muster is a big lever.** Even every 5th round it gives Sol ~5 points,
  and the effect barely scales with cadence: a 1-unit tile cannot attack and
  falls to any probe, a 2-unit one does neither.
- **Where the refill lands matters less than that it lands.** Screened with a
  throwaway front-line/interior split: front-line tiles only gave Sol 30.5% (every
  round), interior only 29.0%. Neither shipped; the rule stays one line.
- **Cutting Sol's region bonuses does not save Verdan.** The ground goes to
  Nexus. Verdan loses to the muster because it is the seat attacking Sol.
- **The every-3rd-round muster with Verdan +2 also passes**, but with Verdan at
  18.9% on two seeds and Nexus at 30.3%; every 5th leaves more room on both.

## 5. Lane weather (`SIM_EVENTS=1`)

Events are off by default for this era, so weather is measured on its own run.

| Metric (live board) | A | B | C |
|---|---|---|---|
| Nebula Closures per game | 2.3 | 2.2 | 2.3 |
| Lane Surges per game | 2.2 | 2.3 | 2.3 |
| Games opening a surge where somebody crossed it | 89.4% | 88.1% | 88.5% |
| Surge crossings total | 5931 | 6257 | 6146 |

With events on the live board passes the gate (§3), though Sol sits at
19.6–22.4% and is eliminated in up to 28.5% of games.

A harness bug surfaced here too: the socket clears `active_event` once it has
broadcast the card, and with no socket the sim left it set, re-applying the same
instant card every round (11.6 "closures" per game where the deck can deal about
4). The sim now clears it the way `broadcastEventCard` does.

## 6. No home worlds (`SIM_SCATTERED=1`)

A candidate mode, measured in the sim only; the engine has no such setting.
Every player keeps their faction and kit, but the board is dealt the way the
engine deals a no-factions game: each non-neutral tile is shuffled and dealt
round-robin at 3 units, so each seat opens with 15 tiles spread over all four
worlds, and the Vault ring stays neutral (garrison 6). The Custodians' home-unit
bonus does not apply. The question was whether it plays faster.

1,000 games per seed, A / B / C:

| Metric | Home worlds (live, §2) | Scattered, kits as shipped | Scattered, Forge + Verdan `reinforce_bonus` 0 |
|---|---|---|---|
| Sol | 25.0 / 21.5 / 25.3 | 18.3 / **17.3** / **17.2** | 23.1 / 24.9 / 22.0 |
| Rust | 26.0 / 27.5 / 25.4 | **33.0** / 32.5 / **34.6** | 25.6 / 24.1 / 24.1 |
| Verdan | 20.9 / 22.1 / 19.8 | 28.9 / 30.4 / 29.5 | 23.4 / 20.9 / 22.5 |
| Nexus | 28.1 / 28.9 / 29.5 | 19.8 / 19.8 / 18.7 | 27.9 / 30.1 / 31.4 |
| Avg game length | 27.7 / 26.5 / 27.0 | 25.8 / 24.9 / 26.1 | 23.8 / 23.3 / 23.1 |
| Turn-10 leader wins | 60.8 / 63.4 / 61.4% | 69.6 / 72.8 / 70.8% | 74.4 / 76.5 / 76.1% |
| Won by Lane Sovereignty | 35.3 / 36.0 / 35.3% | 32.2 / 30.3 / 27.5% | 29.4 / 30.0 / 28.1% |
| Worst elimination rate | 25.6% (Sol) | 9.5% (Sol) | 6.2% (Verdan) |
| Vault held at end | 61.7 / 64.0 / 63.3% | 39.7 / 38.0 / 38.2% | 43.5 / 41.5 / 45.1% |
| First lane capture (avg turn, by seat) | 1.1–2.8 | 2.7–3.4 | 2.5–3.2 |

Every column is decisive in 99% of games or more and lanes change hands 69–80
times a game; in both scattered columns 88–91% of seats build a Jump Gate lane.

- **With the kits as shipped it fails the gate:** Forge over 32% on two seeds,
  Sol under 18% on two. Forge's and Verdan's +2 reinforcements are
  compensation for where their home worlds sit; with no home worlds they are
  just two extra units a turn.
- **Without those two bonuses it passes the win-rate gate on every seed**
  (20.9–31.4%), with Nexus close to the ceiling on seed C.
- **It is faster, by 3–4 turns** (about 14%): 23.4 turns against 27.1; with
  the kits as shipped only 1.5 turns. The first lane capture comes later on
  average, not sooner, because nobody has to cross a lane to reach an enemy.
- **The snowball is the cost.** The turn-10 leader wins about 76% of games
  against about 62% with home worlds. No gate row covers it, but it is the
  number every earlier phase worked to bring down. Eliminations fall a lot
  (at most 6.2%): games end by threshold or Sovereignty while everyone is
  still on the board.
- **The Vault matters less:** held at the end of about 43% of games against 63%.

Commands, from `backend/`:

```sh
SIM_SCATTERED=1 SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_SCATTERED=1 SIM_FACTION_PATCH='{"forge_syndicate":{"reinforce_bonus":0},"helion_navigators":{"reinforce_bonus":0}}' \
  SIM_GAMES=1000 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
```

### Plain lanes: no home worlds, no kits, no lane rules

The further step: lanes stop mattering at all. On top of the scattered start,
factions are off (seats carry no faction, so no kit and no reinforcement
bonus), Lane Sovereignty is off, and lanes fight like any border
(`settings.galaxy_plain_lanes`: no lane dice cap, and the AI stops treating
gateways as objectives or buying Lane Charts). Corridors stay on, so there is no
tech gate. World rules stay on; the second column also switches off the Vault,
whose Emergency Seal is itself a lane rule.

**This shipped as the lobby's Home Worlds option** (admin-only, default on).
Turning it off makes the create route bake exactly this configuration:
factions off, `galaxy_plain_lanes`, and Lane Sovereignty dropped from the
victory list; no catch-up rule. Four seats are still required, since that is
the only shape measured.

With no factions the four seats are symmetric, so per-seat win rates only show
noise (21.9–27.7% across all six runs); the numbers that matter are length and
the snowball. 1,000 games per seed, A / B / C:

| Metric | Home worlds (live, §2) | Scattered, kits, Forge + Verdan +0 | Plain lanes | Plain lanes, Vault off |
|---|---|---|---|---|
| Avg game length | 27.7 / 26.5 / 27.0 | 23.8 / 23.3 / 23.1 | 22.2 / 23.0 / 22.8 | 22.2 / 22.4 / 22.8 |
| Turn-10 leader wins | 60.8 / 63.4 / 61.4% | 74.4 / 76.5 / 76.1% | 79.5 / 78.4 / 77.7% | 81.8 / 79.2 / 76.6% |
| Decisive | 99.0–99.6% | 99.5–99.9% | 99.8–100% | 99.7–100% |
| Lane end-owner changes per game | 70–73 | 69–71 | 55–57 | 55–57 |
| First lane capture (avg turn, by seat) | 1.1–2.8 | 2.5–3.2 | 5.4–5.8 | 5.4–5.8 |
| Worst elimination rate | 25.6% | 6.2% | 5.9% | 5.8% |

Every plain-lanes game ends by threshold (Sovereignty is off).

- **It is the fastest version measured**: about 22.7 turns against 27.1 with
  home worlds, 16% shorter.
- **Lanes really do stop mattering.** Nobody captures across one until turn 5–6
  on average, and each seat takes only about 3.6 tiles across lanes in a whole
  game. The fighting happens inside each world.
- **The snowball is the worst yet:** the turn-10 leader wins about 79% of games.
  With threshold victory at 60% on a symmetric board, whoever is ahead early
  gets there first. A higher threshold is the obvious lever to try next, at the
  cost of some of the speed.
- **The Vault barely matters here** (held at the end of about a third of games,
  and switching it off changes nothing measurable).

**A higher threshold does not fix the snowball.** The same plain-lanes run with
`SIM_THRESHOLD=70`, 1,000 games per seed, A / B / C:

| Metric | Plain lanes, threshold 60 | Plain lanes, threshold 70 |
|---|---|---|
| Avg game length | 22.2 / 23.0 / 22.8 | 25.5 / 26.1 / 26.1 |
| Turn-10 leader wins | 79.5 / 78.4 / 77.7% | 79.7 / 78.1 / 77.7% |
| Decisive | 99.8–100% | 99.5–100% |
| Worst elimination rate | 5.9% | 11.1% |
| Lane end-owner changes per game | 55–57 | 62–64 |

The turn-10 leader wins exactly as often; a higher bar only makes them take
longer to reach it, which gives back about three of the four turns plain lanes
saved (25.9 against 27.1 with home worlds). The game is decided by turn 10
either way, so a fix has to act on the lead itself (a catch-up rule), not on
the finish line.

**A catch-up rule trades speed for the snowball at about one for one.**
`SIM_CATCHUP_PER=N` (sim-only): every N territories a player holds above a
quarter of the board (16) cost one reinforcement at the start of their turn,
never below 3. Plain lanes, threshold 60, 1,000 games per seed:

| Rule | Seeds | Avg game length | Turn-10 leader wins | Decisive |
|---|---|---|---|---|
| none (plain lanes) | A / B / C | 22.2 / 23.0 / 22.8 | 79.5 / 78.4 / 77.7% | 99.8–100% |
| −1 per 4 over | A | 24.1 | 77.4% | 99.6% |
| −1 per 3 over | A / B / C | 25.0 / 24.2 / 24.7 | 73.6 / 77.0 / 74.6% | 99.3–99.7% |
| −1 per 2 over | A / B / C | 27.3 / 27.4 / 26.3 | 69.7 / 69.0 / 70.1% | 99.3–99.7% |
| −1 per 1 over | A | 45.6 | 52.5% | **89.5%** |
| *home worlds (live, §2)* | A / B / C | 27.7 / 26.5 / 27.0 | 60.8 / 63.4 / 61.4% | 99.0–99.6% |

Eliminations stay low in every row (at most 7.6%, except 12.1% at −1 per 1).

- **Each turn of length buys a few points of snowball and no more.** −1 per 3
  costs about 2 turns for 3.5 points; −1 per 2 costs about 4.3 turns for about
  9 points.
- **At −1 per 2 the game is exactly as long as home worlds** (27.0 against
  27.1 turns) and the leader still wins about 70% against about 62%. The home-
  world game controls the snowball better at the same length: its protection
  comes from structure (a defensible home, capped lanes, Sovereignty as a second
  way to win), not from taxing the leader.
- **At −1 per 1 the rule breaks the game**: 45.6 turns, and 10.5% of games hit the
  90-turn cap undecided.

So plain lanes is a choice of point on one curve: faster, or less decided early,
but not both. If the goal is a faster Galactic Age with the current snowball,
none of these reach it.

Commands, from `backend/`:

```sh
SIM_SCATTERED=1 SIM_FACTIONS=0 SIM_PLAIN_LANES=1 SIM_SOVEREIGNTY=0 SIM_GAMES=1000 SIM_THRESHOLD=60 \
  pnpm exec tsx scripts/simGalaxyBalance.ts
```

## 7. Colonies — two and three players (`SIM_PLAYERS`)

Below four seats every player still opens on their faction's whole home world,
and the worlds nobody calls home open **neutral and garrisoned** — colonies
(`state/galaxyModes.ts`). At three seats the ring's two gaps (Sol–Rust,
Verdan–Nexus) are bridged all game by the lanes a Lane Surge would open; without
them the middle seat of the three borders both rivals and never the colony.
Colonies needs home worlds, so it plays with factions on; Home Worlds off deals
the scattered start at any seat count. Design and the modes planned for five to
eight seats: [docs/GALACTIC_AGE_MODES.md](../../docs/GALACTIC_AGE_MODES.md).

Shipped:
- colony garrison **5 on a gateway, 7 inland** (a Vault ring keeps its
  authored 6);
- Lane Sovereignty **5 of 8 lanes for 5 rounds at two seats**, 3 at three
  (`LANE_SOVEREIGNTY_ROUNDS_BY_SEATS`);
- at two seats the Helion Navigators draft **+1 instead of +2**
  (`colony_reinforce_bonus` in `eras/galaxyage.ts`).

Four seats are untouched: seed A at 1,000 games reproduces §2's column to the
decimal.

**1,200 games per seed (a whole number of line-up cycles), live defaults
(threshold 60, cap 90), A / B / C:**

| Metric | Two players | Three players |
|---|---|---|
| Avg game length | 23.4 / 23.5 / 23.5 | 26.0 / 26.2 / 26.2 |
| Decisive (not turn-limit) | 99.8 / 99.8 / 99.9% | 99.5 / 99.3 / 99.2% |
| Won by Lane Sovereignty | 44.5 / 44.4 / 46.4% | 38.6 / 38.5 / 37.6% |
| Territory-leader@turn-10 wins | 72.0 / 73.5 / 70.1% | 63.0 / 62.4 / 61.3% |
| First seat wins (baseline 50 / 33%) | 48.4 / 49.1 / 47.0% | 31.8 / 35.8 / 33.7% |
| Worst elimination rate | 0% | 1.9 / 1.4 / 1.9% |
| Lane end-owner changes per game | 19.3 / 19.5 / 19.1 | 95.4 / 96.9 / 98.4 |
| First colony tile taken | turn 1.2–1.3 | turn 1.2 |
| Colony tiles held at turn 10 / 30 | 16 / 28 of 32 | 11 / 15 of 16 |
| Vault held at end (by the Custodians) | 47–50% (30–32%) | 43–46% (29–34%) |

| Faction | World | Two players (of the games it played; 50%) | Three players (33.3%) |
|---|---|---|---|
| stellar_mandate | Sol | 56.2 / 56.7 / 54.7% | 30.7 / 31.1 / 31.4% |
| forge_syndicate | Rust | 42.3 / 42.5 / 42.3% | 38.3 / 39.2 / 33.1% |
| helion_navigators | Verdan | 58.7 / 59.5 / 57.7% | 36.6 / 37.7 / 38.6% |
| void_custodians | Nexus | 42.8 / 41.3 / 45.3% | 27.8 / 25.3 / 30.2% |

The gate, scaled to the seat count (every faction within ±28% of 1/players,
as 18–32% is at four): **both pass everything on every seed.** Three players'
turn-10 snowball is no worse than four players'; a duel's is higher (70–74%).
Duels are decided by matchup (row beats column, A / B / C):

| | Sol | Rust | Verdan | Nexus |
|---|---|---|---|---|
| **Sol** | — | 60 / 62 / 62% | 44 / 46 / 42% | 64 / 62 / 61% |
| **Rust** | 40 / 38 / 38% | — | 51 / 48 / 50% | 36 / 40 / 38% |
| **Verdan** | 56 / 54 / 58% | 49 / 52 / 50% | — | 72 / 74 / 64% |
| **Nexus** | 36 / 38 / 39% | 64 / 60 / 62% | 28 / 26 / 36% | — |

Whether the homes are neighbours or face each other across the ring matters
little: 23.1–23.5 turns across the ring, 23.4–23.7 as neighbours; Sovereignty
ends 37–40% of the first and 48–50% of the second.

### How it got there

**Colony garrison.** Two players, seed A, threshold 60, 3 Sovereignty rounds:

| Gateway / inland | Games | Turns | Sovereignty | Sol | Rust | Verdan | Nexus |
|---|---|---|---|---|---|---|---|
| 3 / 4 | 480 | 19.0 | 45.2% | 60.4 | 52.5 | 68.8 | **18.3** |
| 4 / 6 (the Moon's) | 960 | 20.6 | 60.6% | 61.7 | 31.7 | 66.3 | 40.4 |
| **5 / 7** | 960 | 21.1 | 62.8% | 57.5 | 37.5 | 62.3 | 42.7 |
| 4 / 8 | 960 | 20.1 | 67.5% | 63.5 | 29.8 | 62.5 | 44.2 |
| 6 / 8 | 960 | 21.3 | 65.6% | 61.0 | 30.8 | 67.1 | 41.0 |

A light garrison is a land grab the Custodians lose: they open on 12 tiles, not
16, with their ring still to take, so they draft about 7 a turn to the others'
9–11. Heavier colonies slow that race for everyone. 5 / 7 is the best
two-player column and costs three players nothing
(960 games, seed A: turn-10 leader 71.0% at 3 / 4, 64.0% at 5 / 7, every
faction inside 24–43% in all six garrisons tried).

**Sovereignty.** At three rounds it took over duels (62.8% of games at 5 / 7).
The corridor bar is too coarse a lever: six lanes instead of five dropped it to
10.7% (960 games, bar patched for the run). A streak breaks on a rival's turn,
so the rounds set how many rival turns it must survive — (rounds − 1) ×
(seats − 1): six at four seats, four at three, but two at two. Five rounds
restores four:

| Rounds (two players, 5 / 7) | Games | Sovereignty | Turns |
|---|---|---|---|
| 3 | 960 | 62.8% | 21.1 |
| 4 | 960 | 54.1% | 22.3 |
| **5** | 1,200 × 3 | 44.7–45.3% (44.4–46.4% with the duel bonus) | 23.3–23.4 |
| 6 | 960 | 39.0% | 24.2 |

Three players keep three rounds: 37.6–38.6% of games, beside four players' 35%.

**Rejected: handing a seated Custodian their Vault ring.** They start without it
because at four seats it gave Nexus ~41% (the Vault comment in
`gameStateManager.ts`). In Colonies (at the 3 / 4 garrison, 480 games) it gave
them 81% of duels and 79% at three players.

**The Navigators' duel bonus.** With every kit as it plays at four seats,
Verdan won 65.0–66.0% of its duels and 79–83% against the Custodians, 1–2
points over the band. What that edge is made of (seed A, before the fix):

| Variant | Verdan | Verdan beats Nexus | Nexus |
|---|---|---|---|
| Kits as at four seats | 65.5% | 80% | 39.8% |
| Verdan's +2 at +1 | 58.7% | 72% | 42.8% |
| Storms off | 65.8% | 80% | 39.7% |
| Vault off | 70.3% | 89% | 30.3% |
| Sovereignty off | 64.8% | — | 39.8% |

A flat +2 is a bigger share of a duel's income, where region bonuses scale down
to a third (`clamp(players, 2, 12) / 6`) and the flat bonus does not. Scaling
every flat bonus the same way traded Verdan's problem for the Forge's: its +2 is
its base kit, where Verdan's second point pays for Sol's Cradle (§4). So the
duel rule is the Navigators' alone:

| Two players, 1,200 games × 3 seeds | Sol | Rust | Verdan | Nexus | Verdan beats Nexus |
|---|---|---|---|---|---|
| Kits as at four seats | 54.8–55.7 | 39.5–40.0 | **65.0–66.0** | 39.2–39.8 | 79–83% |
| Forge and Verdan at +1 | 59.3–60.5 | **34.5–37.0** | 58.0–61.0 | 43.7–47.0 | 64–74% |
| **Verdan at +1** (shipped) | 54.7–56.7 | 42.3–42.5 | 57.7–59.5 | 41.3–45.3 | 64–74% |

It is the only change at two seats; three and four seats reproduce their
earlier runs exactly.

**Lane weather** (`SIM_EVENTS=1`): two players get 1.7 closures and 1.7 surges a
game, crossed in 68% of the games that open one; every faction stays inside the
band (Sol 48.5, Rust 53.3, Verdan 57.2, Nexus 41.0%). Three players get no
surges at all — both gaps are already bridged, so the round's draw leaves the
card out — and 2.4 closures; Nexus drops to 25.0%, still inside the band.

Commands, from `backend/`:

```sh
SIM_PLAYERS=2 SIM_GAMES=1200 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_PLAYERS=3 SIM_GAMES=1200 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_PLAYERS=2 SIM_COLONY_GARRISON=4,6 SIM_SOVEREIGNTY_ROUNDS=3 SIM_GAMES=960 SIM_THRESHOLD=60 \
  pnpm exec tsx scripts/simGalaxyBalance.ts        # a sweep row
SIM_PLAYERS=2 SIM_FACTION_PATCH='{"helion_navigators":{"colony_reinforce_bonus":{}}}' \
  SIM_GAMES=1200 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts  # before the duel bonus
```

## 8. Schism — eight players (`SIM_PLAYERS=8`)

At eight seats every world is shared by two houses of its faction, each on one
half of it (`state/galaxySchism.ts`); the design is in
[docs/GALACTIC_AGE_MODES.md](../../docs/GALACTIC_AGE_MODES.md). The sim deals
every faction twice. Each block of eight games starts from a seeded shuffle of
the eight houses and rotates it a seat per game, so every house sits in every
seat once a block while the blocks vary who sits next to whom. Win rates are
per house (baseline 12.5%) and, in the faction table, per seat of that faction.

Shipped (`SCHISM_HALVES`, `SCHISM_TUNING`):
- the halves: Sol west / east, Verdan and Rust by lane side, Nexus's Vault Ward
  against its Berth Ring;
- house bonuses in units a turn: Western Mandate +3, Dawnrim Navigators +1,
  Duskrim Navigators +2, Tharsis Syndicate +3, Hellas Syndicate −1, Ward and
  Berth Custodians −1;
- the Custodian houses open at 3 (Ward) and 2 (Berth) units a tile, not 4;
- Concord 3 rounds, Lane Crown +2, Lane Sovereignty 5 lanes for 3 rounds.

**1,200 games per seed, live defaults (threshold 60, cap 90), A / B / C:**

| Metric | Concord (default) | Civil War |
|---|---|---|
| Avg game length | 40.2 / 40.6 / 41.1 | 39.7 / 39.6 / 39.5 |
| Decisive (not turn-limit) | 97.6 / 98.0 / 97.9% | 97.8 / 98.2 / 97.8% |
| Won by Lane Sovereignty | 41.3 / 44.2 / 42.7% | 41.9 / 44.7 / 47.2% |
| Territory-leader@turn-10 wins (baseline 12.5%) | 38.6 / 36.6 / 38.5% | 38.8 / 44.1 / 42.6% |
| First seat wins (baseline 12.5%) | 13.7 / 13.3 / 10.9% | 13.9 / 14.3 / 14.9% |
| Lane end-owner changes per game | 162 / 165 / 164 | 158 / 156 / 156 |
| Lane Crown worn (the winner wore it) | 83–87% (76–80%) | 84–87% (77–80%) |
| First house out, turn (by its own world's other house) | 14.7–15.0 (48–50%) | 14.0–14.1 (45–49%) |
| Faction win rate per seat: Sol / Rust / Verdan / Nexus | 12.5 / 11.0 / 11.2 / 15.3% | 14.2 / 10.5 / 10.8 / 14.5% |

| House | Wins, Concord (A / B / C) | Wins, Civil War | Eliminated (Concord) | Wore the Crown (Concord) |
|---|---|---|---|---|
| Western Mandate | 15.7 / 14.8 / 11.7% | 18.3 / 15.1 / 17.8% | 53.3 / 53.6 / 52.5% | 17.3 / 17.9 / 15.3% |
| Eastern Mandate | 11.2 / 11.0 / 10.6% | 10.0 / 12.1 / 11.8% | 69.3 / 68.8 / 69.3% | 14.4 / 15.3 / 14.8% |
| Dawnrim Navigators | 15.0 / 14.4 / 13.2% | 11.5 / 12.2 / 10.3% | 37.5 / 39.0 / 39.7% | 9.3 / 9.9 / 8.3% |
| Duskrim Navigators | 6.8 / 8.5 / 9.3% | 11.4 / 10.2 / 9.3% | 29.6 / 31.4 / 29.6% | 8.3 / 9.8 / 11.5% |
| Tharsis Syndicate | 13.1 / 12.9 / 14.3% | 11.5 / 12.3 / 11.3% | 30.8 / 31.3 / 31.3% | 16.0 / 17.8 / 19.8% |
| Hellas Syndicate | 8.0 / 8.6 / 9.1% | 7.8 / 10.7 / 9.7% | 45.3 / 47.1 / 49.6% | 11.2 / 12.8 / 10.5% |
| Ward Custodians | 14.8 / 15.2 / 16.8% | 12.7 / 13.9 / 14.8% | 46.4 / 47.8 / 47.2% | 19.7 / 20.7 / 22.2% |
| Berth Custodians | 15.5 / 14.7 / 15.1% | 16.9 / 13.7 / 14.9% | 48.5 / 47.8 / 47.3% | 20.3 / 21.7 / 21.3% |

**The gate** is the four-player gate scaled to eight seats:
- Decisive ≥ 80%: passes.
- Every faction within ±28% of 1/8 per seat (9.0–16.0%): passes on every
  seed, with Nexus at 14.9–16.0% the closest.
- Sovereignty a real ending but not the only one: passes, at 41–47%.
- Lanes changing hands: passes.
- Per house, averaged over the seeds:
  - Concord: all eight within ±40% (7.5–17.5%); six within ±28%. Duskrim
    (8.2%) and Hellas (8.6%) sit just under.
  - Civil War: seven within ±28%; the Western Mandate is at 17.1%.
- The four-player elimination limit (30%) does not carry over. With one winner
  in eight, most houses end eliminated; the rates are in the table and in §9.

Two, three and four seats are unchanged: seed A reproduces §2 and §7 to the
decimal.

### How it got there

**As first drawn, nothing evening the halves out** (480 games, seed A): the
houses ran 1.3–35.2%. Every world's two houses split on geometry, and after the
Concord the stronger ate the weaker:
- Western Mandate 1.3%, Eastern 22.7%. The Eastern Mandate eliminated the
  Western in 37% of games: Maghreb borders four western tiles.
- Tharsis 1.9%, Hellas 13.8%.
- Dawnrim 4.8%, Duskrim 12.5%.
- Spire Custodians 7.9%, Berth 35.2%. This was the first Nexus split, the
  Spire Walk against the Berth Ring.

The house rules barely moved it (seed A, 480 games):

| Change | Houses | Sovereignty |
|---|---|---|
| As drawn (Concord 3, Crown +2) | 1.3–35.2% | 47.1% |
| Civil War | 3.1–28.1% | 43.5% |
| Concord 1 / 5 rounds | 2.1–26.3% / 1.7–30.4% | 42.9 / 47.3% |
| Lane Crown 0 / +4 | 1.9–32.3% / 1.5–36.3% | 45.4 / 48.8% |

**Every other split, screened** (240 games each; one world's every connected
equal split with two gateways a half, the others as drawn):
- **Sol, 18 splits.** Every split other than west / east breaks bonus regions,
  and both Sol houses lose (3–8% each where they come out even).
- **Nexus, 3 splits.** The Vault Ward against the Berth Ring evened the two
  Custodian houses (15.4 / 18.8%), so it ships.
- **Rust, 55 splits.** None rescues the Verdan-facing house: its lanes lead only
  to one Verdan house, whose lanes lead only back.
- **Verdan, 23 splits.** The one that shipped gives each house three border
  tiles. The first, with Cinder Bloom on the Dawnrim side, gave the Dawnrim a
  salient into three Duskrim tiles.

**Opening units, then units a turn.**
- A local search over per-half opening units reached a house spread (RMS
  around 12.5%) of 3.8. That needed the West at 6 units a tile against the
  East's 2.
- A player would break the Concord in round one against a house that thin; the
  AI never does, so the sim cannot see it. So the compensation moved into a
  per-turn house bonus, with openings even except the Custodians'.
- Grids at 960 and 1,200 games, then three seeds for the finalists, chose the
  shipped numbers: RMS 2.7 over three seeds.
- Rejected on the way:
  - the Custodian houses with no per-turn penalty (Nexus 17–18% a seat, at 3
    or 4 units a tile);
  - a penalty on one Custodian house only (the other took its place);
  - and the first Verdan split (Duskrim 7–8% whatever its bonus).

**Seed A of the shipped board, one number moved** (1,200 games):

| Change | Length | Sovereignty | Houses | RMS | Crown worn | First out by own world |
|---|---|---|---|---|---|---|
| Shipped (Concord 3, Crown +2, 3 rounds) | 40.2 | 41.3% | 6.8–15.7% | 3.3 | 83.0% | 49.0% |
| Civil War | 39.7 | 41.9% | 7.8–18.3% | 3.3 | 85.8% | 48.4% |
| Concord 1 round | 39.9 | 42.7% | 8.6–16.9% | 2.7 | 85.8% | 49.5% |
| Concord 5 rounds | 42.3 | 39.3% | 7.8–16.4% | 3.6 | 83.5% | 48.7% |
| Lane Crown 0 | 40.7 | 42.2% | 7.9–16.4% | 3.1 | 83.0% | 48.6% |
| Lane Crown +4 | 41.0 | 44.6% | 7.8–15.6% | 3.0 | 83.0% | 49.0% |
| Sovereignty 2 rounds | 39.2 | 54.2% | 6.8–15.8% | 3.3 | 81.9% | 49.0% |
| Sovereignty 4 rounds | 41.0 | 30.8% | 7.2–15.8% | 3.2 | 83.3% | 49.0% |

- Neither the Concord's length nor the Crown's size moves the balance beyond
  noise.
- The Concord stays at 3, the ordinary truce's length.
- The Crown stays at +2: at 0 the Crown is a label, and +4 moves nothing.
- Sovereignty stays at 3 rounds: at 2 it takes over.

## 9. Open

- **Sol is the most often eliminated seat** (~25%; 29.1–29.6% with
  Sovereignty off, just inside the 30% limit). Verdan's +2 reinforcements are
  paid for mostly by Sol. The next Sol lever should be defensive.
- **Only the Forge-die switch is balance-free** (§3); the Cradle, Storms, Vault
  and master switches each fail the gate and are last resorts for a rule that
  is actually broken.
- **Verdan's +2 exists to pay for the Cradle**, and the Cradle switch cannot
  reach it. Switching the Cradle off in production would leave Verdan with a
  bonus it no longer needs.
- **The snowball**: turn-10 leader at ~62%.
- **Region bonus totals are no longer equal**: Rust 10, Verdan 14, Sol and Nexus
  12. The design principle was 12 per world; the geography now carries the
  difference.
- **Verdan against the Custodians** is still the most lopsided duel, 64–74%
  (§7), though inside the gate since the duel bonus.
- **Five to seven players** have no board yet; the create route, the join cap
  and game start hold the era to two to four, or eight (docs/GALACTIC_AGE_MODES.md).
- **The Schism's house numbers were tuned against the AI** (§8), which never
  breaks a truce and drafts everything onto one tile. Houses played by people
  may want them retuned; the per-turn form was chosen so a retune never needs a
  lopsided opening.
- **The Schism's elimination rates** are those of an eight-player game: the
  Eastern Mandate ends eliminated in ~69% of games. Nothing in the four-player
  gate covers that yet.

## History

- **2026-09-30 (Schism):** eight seats on the Galactic Age, two houses to every
  world (§8). Halves authored per world; per-turn house bonuses and lighter
  Custodian openings even them out. Concord (a 3-round truce) or Civil War; the
  Lane Crown pays +2. Every faction within the gate on every seed; houses at
  8.2–15.6% averaged over three seeds. Two, three and four seats unchanged.
- **2026-09-30 (Colonies duel bonus):** at two seats the Helion Navigators
  draft +1, not +2 (`colony_reinforce_bonus`). Verdan 65.5 → 58.6% of its
  duels, against the Custodians 81 → 70%; every faction at 41–60%, so two
  players pass the gate. Halving the Forge's +2 as well was measured and
  rejected (Forge 34.5–37%). Three and four seats unchanged.
- **2026-09-30 (Colonies):** two and three seats on the Galactic Age. The
  worlds nobody calls home open neutral (garrison 5 gateway / 7 inland); three
  seats bridge the ring's gaps all game; Lane Sovereignty needs 5 rounds at two
  seats. The sim runs every seat count (§7). Three players pass the gate; two
  pass it but for Verdan at 65–66%. Four players unchanged.
- **2026-09-27 (Home Worlds option):** the plain-lanes configuration ships as
  an admin-only lobby option, Home Worlds (default on). Off: scattered start,
  factions off, plain lanes, no Lane Sovereignty, no catch-up (§6).
- **2026-09-27 (plain lanes + catch-up, sim only):** −1 reinforcement per N
  tiles over a quarter. −1 per 2 matches home-world length (27.0 turns) with the
  leader still winning ~70%; −1 per 1 leaves 10.5% of games undecided.
- **2026-09-27 (plain lanes at threshold 70, sim only):** 25.9 turns, turn-10
  leader still wins ~78.5%. The threshold moves the finish, not the snowball.
- **2026-09-27 (plain lanes, sim only):** scattered start, factions off,
  Sovereignty off, lanes fight like any border (§6). 22.7 turns against 27.1;
  turn-10 leader wins ~79%.
- **2026-09-27 (no home worlds, sim only):** `SIM_SCATTERED=1` measured (§6).
  With kits as shipped it fails on Forge and Sol; with Forge's and Verdan's
  `reinforce_bonus` at 0 it passes the win-rate gate, 3–4 turns shorter, but the
  turn-10 leader wins ~76%.
- **2026-09-27 (Cradle muster):** Sol's inert Cradle (deploy cap + population)
  replaced by the muster (every 5th round, Sol tiles under 2 units gain 1);
  Verdan `reinforce_bonus` 0 → 2 to pay for it. Sol 22.5 → 23.9, Rust
  29.7 → 26.3, Verdan 20.1 → 20.9, Nexus 27.7 → 28.8. Passes the gate on every
  seed; the Cradle switch now fails it.
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
