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

## 6. Open

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
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows (`GALAXY_REQUIRED_PLAYERS = 4`): the one-faction-per-world
  start fires only for four seats with four distinct factions, and the Vault
  start assumes it.

## History

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
