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

**Every table in §2 and §5 is 1,000 games at expert with a 90-turn cap**, on
`main` after the far-world redesign (2026-09-27), seeds
`borderfall-galaxy-balance` (A), `…-B` and `…-C`. §3 and §4 keep the history
that got here; rows from before the redesign are marked.

## 1. The harness, and the four bugs it had

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

**The harness is near-deterministic, not exact.** Dice and AI jitter are seeded,
but a few engine paths still draw from unseeded `crypto`: an AI target pick
(`ai/aiBot.ts`), stability's rebellion and population rolls, and a start-shuffle
tie-break. Repeat runs of one seed have differed by about a point per faction;
read differences under a point as noise.

## 2. Where the era stands (after the far-world redesign, live defaults)

Corridors ON, world rules ON, Lane Sovereignty ON, threshold 60 + cap 90.

| Metric | A | B | C |
|---|---|---|---|
| Avg game length | 27.8 | 27.9 | 28.2 turns |
| Decisive (not turn-limit) | 99.3% | 99.7% | 99.2% |
| Won by Lane Sovereignty | 34.3% | 30.9% | 33.4% |
| Won by threshold | 65.0% | 68.8% | 65.8% |
| Territory-leader@turn-10 wins | 58.2% | 59.7% | 57.3% |
| Lane end-owner changes per game | 99.2 | 98.9 | 99.4 |
| Vault (Gate Ring) held at end | 61.5% | 63.6% | 62.2% |
| …of which by the Custodians | 43.0% | 42.5% | 43.0% |
| Games that opened a Jump Gate lane | 99.9% | 100% | 99.9% |

| Faction | World | A | B | C | avg | eliminated (A/B/C) |
|---|---|---|---|---|---|---|
| stellar_mandate | Sol | 20.3% | 21.5% | 21.1% | **21.0%** | 17.4 / 19.3 / 20.2% |
| forge_syndicate | Rust | 30.4% | 27.7% | 29.6% | **29.2%** | 5.6 / 7.6 / 6.6% |
| helion_navigators | Verdan | 25.5% | 26.3% | 24.5% | **25.4%** | 8.9 / 9.3 / 10.2% |
| void_custodians | Nexus | 23.8% | 24.5% | 24.8% | **24.4%** | 9.9 / 11.4 / 10.5% |

### The gate

The exit bar from Phase 3 onward: decisive ≥ 80%, every faction within 18–32%,
no faction eliminated in more than 30% of games, lanes changing state at least
six times per game. Phase 5 adds "Sovereignty ends at least a quarter of decisive
games"; Phase 6 adds "gates built in at least half of games" and "a surge lane is
crossed when it appears".

**Everything passes on every seed.** The spread is 20.3–30.4% against 16.6–30.9%
before the redesign, and Forge, which sat under the floor on seed A, is now the
strongest seat.

### Read

1. **Geography, not the alphabet, decides the fronts.** Each far world now has
   chokepoints its rules act on: Rust's fortress plate and three rift crossings,
   Verdan's ring and storm straits, Nexus's shell with the Vault at its hub.
2. **Forge turned from the weakest seat to the strongest** (17.9% → 29.2%). Its
   home world is now a fortress: Verdan's lanes land on dead ends of the west
   plate, and its fort dice finally have somewhere to matter.
3. **Sol is now the weakest seat** at 21.0%, and the most often eliminated
   (17–20%). Sol III itself did not change; its neighbours got harder to
   break into.
4. **The Vault is the centre of Nexus.** Somebody holds it at the end of ~62% of
   games, and the Custodians do in ~43%, up from ~34% before the redesign.
5. **The snowball is unchanged**: the turn-10 leader wins ~58% (58.8% before).
6. **Two ways to win, both live.** Sovereignty ends about a third of games.

## 3. What each phase moved

Threshold-60 default. Phase 0–4 rows predate the jitter fix, so treat them as
±3 points. Phase 5–6 rows are 400-game 3-seed averages on the old board;
phase 7 rows are 1,000 games on the redesigned board.

| Phase | Sol | Rust | Verdan | Nexus | Decisive | Turns |
|---|---|---|---|---|---|---|
| 0 · grind-faithful harness, era as found | 41.3 | 13.8 | 16.0 | 29.0 | 86.5 | 45.4 |
| 3 · corridors: no gate, lane cap, kits rebuilt | 22.5 | 14.5 | 32.0 | 31.0 | 93.0 | ~32 |
| 4 · worlds as characters | 27.8 | 19.3 | 29.5 | 23.5 | 91.5 | 33.8 |
| 5 · Lane Sovereignty | ~28 | ~16 | ~33 | ~24 | 97 | 27 |
| 6 · Jump Gates + lane weather | 25.8 | 18.2 | 27.1 | 29.0 | 96.6 | 30.1 |
| 6, re-measured before the redesign (1,000 g × 3) | 25.0 | 17.9 | 27.3 | 29.8 | 99.6 | 26.9 |
| 7 · far-world redesign (this tree) | **21.0** | **29.2** | **25.4** | **24.4** | 99.4 | 28.0 |
| 7 with `SIM_SOVEREIGNTY=0` (seed A) | 21.7 | 30.6 | 25.4 | 22.3 | 99.4 | 28.3 |
| 7 with `SIM_EVENTS=1` (seed A) | 20.7 | 34.7 | 22.2 | 22.4 | 98.7 | 29.7 |
| 7 with `SIM_WORLD_RULES=0`, before the Vault-start fix (seed A) | 12.6 | 21.1 | 25.4 | 40.9 | 99.2 | 28.0 |
| 7 with `SIM_WORLD_RULES=0`, Vault start kept (A / B / C avg) | 31.6 | 40.6 | 13.4 | 14.5 | 99.6 | 26.4 |

The Sovereignty kill switch still leaves a balanced game (turn-10 leader 63%
without it, 58% with it, so Sovereignty is still doing its catch-up job).

**The world-rules kill switch no longer does, and the Vault was only part of
it.** At first the switch also removed the Vault's neutral garrison and the
Custodians' home bonus, so they started owning all 16 Nexus tiles and won 40.9%.
The starting layout now follows the map whatever the switch says: the Gate Ring
starts neutral and the Custodians get their +1, while the switch still turns off
the Vault's payouts (tech, Emergency Seal, AI weighting) and every other world
rule. That restored the start but not the balance: Forge 39–41%, Verdan 13–14%,
Nexus 12–16% across the three seeds.

**So the switch is now split per rule.** `galaxy_world_rules_enabled` stays
the master, and under it each rule has its own flag, default ON:
`galaxy_rule_cradle_enabled`, `galaxy_rule_storms_enabled`,
`galaxy_rule_forge_enabled` and `galaxy_rule_vault_enabled`. Games bake the
switched-off ones at create as `settings.world_rules_disabled`. Switching off
the Vault stops its payouts; the ring still starts neutral, as above.

One rule off at a time through that switch (`SIM_WORLD_RULES_OFF`, 1,000 games
per seed):

| Rule off (A / B / C) | Sol | Rust | Verdan | Nexus | Leader@10 | Gate |
|---|---|---|---|---|---|---|
| none (live) | 20.3 / 21.5 / 21.1 | 30.4 / 27.7 / 29.6 | 25.5 / 26.3 / 24.5 | 23.8 / 24.5 / 24.8 | 58.2 / 59.7 / 57.3% | pass |
| Sol's Cradle | 20.1 / 21.9 / 21.8 | 29.9 / 30.4 / 29.9 | 26.3 / 22.5 / 24.5 | 23.7 / 25.2 / 23.8 | 58.7 / 58.9 / 59.1% | **pass** |
| Rust's Forge die | 18.6 / 16.5 / 17.9 | 31.5 / 28.9 / 27.8 | 26.6 / 27.5 / 26.2 | 23.3 / 27.1 / 28.1 | 61.1 / 58.6 / 57.5% | fail: Sol |
| Nexus Vault | 22.5 / 25.0 / 25.3 | 35.3 / 31.6 / 35.3 | 26.9 / 26.8 / 23.5 | 15.3 / 16.6 / 15.9 | 59.9 / 60.1 / 64.2% | fail: Rust, Nexus |
| Verdan's Storms | 31.2 / 26.9 / 29.4 | 37.6 / 33.2 / 35.3 | 14.4 / 17.8 / 14.3 | 16.8 / 22.1 / 21.0 | 71.9 / 68.4 / 69.1% | fail: all but Sol |

What each switch costs:

- **Cradle:** free. The only rule that can go on its own and stay inside the
  gate on every seed.
- **Forge die:** Sol drops just under the floor (16.5–18.6%). It barely moved on
  seed A alone, but across three seeds it costs Sol about three points, while
  Rust itself barely moves. Why is not yet understood.
- **Vault:** the Custodians lose their prize (15–17%) and Forge overshoots.
- **Storms:** load-bearing, as above. They stop a stack rolling round the
  Twilight Ring; without them Forge overruns Verdan and the snowball jumps to
  ~70%.

A switch that fails the gate is still the right tool for a rule that is
actually broken: a few points of balance against a bug in a live game. The
table says what each one costs.

Events on is not the live default. On the new board it pushes Forge to 34.7%,
over the 32% ceiling, so turning events on for this era would need its own pass.

## 4. The tuning that got here, and what it cost

Phase 6 rows are 400 games × 3 seeds on the old board; phase 7 rows are 1,000
games × 3 seeds on the redesigned one.

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

**Sol's Cradle world rule measured as inert** (Phase 6, old board; not
re-measured since the redesign, which did not touch Sol). Removing `population_growth_mult`
changed nothing on two of three seeds; removing `deploy_cap_bonus` changed
nothing on any (the deploy cap only binds below 50 stability, which the AI rarely
reaches). Sol's identity is currently carried by Blockade Runner and by position.
Giving that world a rule that actually fires is the clearest next balance job.

## 5. Lane weather (`SIM_EVENTS=1`)

Events are off by default for this era, so weather is measured on its own run.

| Metric | 1,000 g, seed A |
|---|---|
| Nebula Closures per game | 2.4 |
| Lane Surges per game | 2.4 |
| Games opening a surge where somebody crossed it | 91.5% |
| Surge crossings total | 6515 |

A harness bug surfaced here too: the socket clears `active_event` once it has
broadcast the card, and with no socket the sim left it set, re-applying the same
instant card every round (11.6 "closures" per game where the deck can deal about
4). The sim now clears it the way `broadcastEventCard` does.

## 6. Open

- **Sol at 21.0%**, the weakest seat and the most often eliminated (17–20%).
  Inside the band, but the next lever should be Sol's.
- **Sol's Cradle rule does nothing measurable** (§3, §4). A rule that fires
  would be the natural place for that lever.
- **Only the Cradle switch is balance-free** (§3). The master and the Storms,
  Vault and Forge switches each push a faction out of the gate; each is a
  last resort for a broken rule, not a tuning knob.
- **Rust's Forge die matters more to Sol than to Rust** (§3): without it Sol
  loses about three points while Rust barely moves. Not yet explained.
- **Events on pushes Forge over the ceiling** (34.7%, seed A).
- **The snowball**: turn-10 leader at ~58%.
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows (`GALAXY_REQUIRED_PLAYERS = 4`): the one-faction-per-world
  start fires only for four seats with four distinct factions, and the Vault
  start assumes it.
- **The harness's remaining randomness** (§1): about a point of run-to-run noise.

## History

- **2026-09-27 (Phase 7, far-world redesign):** Verdan, Rust and Nexus rebuilt
  from authored specs, one PR each, each measured on 1,000 games × 3 seeds
  before merging; Vault `home_unit_bonus` back to 1 and Nexus tech 0.084.
  Sol 25 → 21, Rust 18 → 29, Verdan 27 → 25, Nexus 30 → 24.
- **2026-09-10 (Phases 5–6):** Lane Sovereignty, Jump Gates and lane weather;
  Vault bonus removed, Forge reinforce 2, Sol research discount removed.
- **2026-09-09 (Phases 0–4):** grind-faithful harness; Nexus tech yield 0.05 →
  0.0625 (it floored to zero); corridors replaced the Hyperspace Chart gate;
  worlds got their rules. Sol 41 → 28, Rust 14 → 19.
- **Pre-fix baseline (obsolete):** the pre-densification map on the
  single-exchange harness — stellar_mandate 2.0% / 1.2%, forge_syndicate 36% /
  33%, helion_navigators 35% / 41%, void_custodians 27% / 25%; ~45% of games hit
  the cap.
