# Galactic Age balance — measured state

Headless AI-vs-AI balance for the **64-territory** Galactic Age map
(`database/maps/era_galaxy.json`: 4 worlds × 16 territories, 8 hyperspace lanes
in a symmetric ring, 16 gateway tiles). Tool:
[`simGalaxyBalance.ts`](./simGalaxyBalance.ts).

```sh
# from backend/ — the live create defaults for this era are threshold 60% + cap
# 90 + Lane Sovereignty, so this is the meaningful run:
SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_GAMES=400 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-B \
  pnpm exec tsx scripts/simGalaxyBalance.ts        # …and two more seeds
SIM_GAMES=400 SIM_THRESHOLD=60 SIM_SEED=borderfall-galaxy-balance-C \
  pnpm exec tsx scripts/simGalaxyBalance.ts
SIM_EVENTS=1     SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts  # lane weather
SIM_SOVEREIGNTY=0 SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # kill switch
SIM_WORLD_RULES=0 SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # kill switch
SIM_MAP=/tmp/variant.json SIM_GAMES=400 SIM_THRESHOLD=60 pnpm exec tsx scripts/simGalaxyBalance.ts # knob sweep
```

Knobs: `SIM_MAP` (variant map file), `SIM_GAMES`, `SIM_DIFFICULTY`,
`SIM_MAX_TURNS`, `SIM_SEED`, `SIM_CSV`, `SIM_THRESHOLD`, `SIM_GRIND`,
`SIM_CORRIDORS`, `SIM_WORLD_RULES`, `SIM_SOVEREIGNTY`, `SIM_EVENTS`. 4 players,
one per galaxy faction, faction↔seat rotated per game. Factions ON, naval OFF,
era advancement OFF, stability ON, events OFF (the era's own system defaults are
economy + tech + factions).

**Every table below is 400 games at expert with a 90-turn cap**, measured on the
Phase 5–6 tree (2026-09-10), seeds `borderfall-galaxy-balance` (A),
`…-B` and `…-C`. Every row is reproducible from the commands above.

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
  now passes a seeded stream, and two identical runs are byte-identical. Any
  single-faction tuning done before that fix should be treated as noise.

## 2. Where the era stands (Phases 3–6, live defaults)

Corridors ON, world rules ON, Lane Sovereignty ON, threshold 60 + cap 90.

| Metric | A | B | C |
|---|---|---|---|
| Avg game length | 29.9 | 29.0 | 31.3 turns |
| Decisive (not turn-limit) | 97.3% | 97.0% | 95.5% |
| Won by Lane Sovereignty | 40.5% | 43.0% | 38.5% |
| Won by threshold | 56.8% | 54.0% | 57.0% |
| Territory-leader@turn-10 wins | 60.8% | 61.3% | 60.8% |
| Lane end-owner changes per game | 105.2 | 97.1 | 107.0 |
| Vault (Gate Ring) held at end | 68.0% | 66.5% | 64.5% |
| Games that opened a Jump Gate lane | 100% | 99.8% | 100% |

| Faction | World | A | B | C | avg | eliminated (A/B/C) |
|---|---|---|---|---|---|---|
| stellar_mandate | Sol | 26.3% | 25.8% | 25.3% | **25.8%** | 10.8 / 15.3 / 13.0% |
| forge_syndicate | Rust | 19.5% | 17.8% | 17.3% | **18.2%** | 9.8 / 10.8 / 9.0% |
| helion_navigators | Verdan | 24.8% | 28.0% | 28.5% | **27.1%** | 13.5 / 13.3 / 12.3% |
| void_custodians | Nexus | 29.5% | 28.5% | 29.0% | **29.0%** | 7.0 / 7.0 / 12.0% |

### The gate

The exit bar from Phase 3 onward: decisive ≥ 80%, every faction within 18–32%,
no faction eliminated in more than 30% of games, lanes changing state at least
six times per game. Phase 5 adds "Sovereignty ends at least a quarter of decisive
games"; Phase 6 adds "gates built in at least half of games" and "a surge lane is
crossed when it appears".

Everything passes except one detail worth stating plainly: **Forge averages 18.2%
but sits at 17.8% and 17.3% on two of the three seeds**, a few tenths under the
floor. It is the closest the seat has been (12–14% before this pass) and the
weakest point in the era; §4 lists what was tried.

### Read

1. **Two ways to win, both live.** Sovereignty ends ~40% of games and the
   headcount ~56%, which is the split the design wanted: a victory about the
   network that does not crowd out the one about the map.
2. **Lanes are the board.** A lane's end-owner pair changes ~100 times a game.
3. **Nexus is the strongest seat** at 29%, on the back of the Vault — held by
   someone at the end of two games in three, and by the Custodians in ~30%.
4. **The snowball is still there**: the turn-10 leader wins ~61% of games against
   a 25% baseline. Sovereignty was supposed to give trailing seats a second way
   in and only partly does.

## 3. What each phase moved

Threshold-60 default. Phase 0–4 rows predate the jitter fix, so treat them as
±3 points; Phases 5–6 are 3-seed averages on the deterministic harness.

| Phase | Sol | Rust | Verdan | Nexus | Decisive | Turns |
|---|---|---|---|---|---|---|
| 0 · grind-faithful harness, era as found | 41.3 | 13.8 | 16.0 | 29.0 | 86.5 | 45.4 |
| 3 · corridors: no gate, lane cap, kits rebuilt | 22.5 | 14.5 | 32.0 | 31.0 | 93.0 | ~32 |
| 4 · worlds as characters | 27.8 | 19.3 | 29.5 | 23.5 | 91.5 | 33.8 |
| 5 · Lane Sovereignty | ~28 | ~16 | ~33 | ~24 | 97 | 27 |
| 6 · Jump Gates + lane weather (this tree) | **25.8** | **18.2** | **27.1** | **29.0** | 96.6 | 30.1 |
| 6 with `SIM_SOVEREIGNTY=0` (seed A) | 24.8 | 19.5 | 27.5 | 28.3 | 93.5 | 33.5 |
| 6 with `SIM_EVENTS=1` (seed A) | 24.5 | 27.0 | 24.0 | 24.5 | 98.3 | 28.0 |

Both kill switches leave a balanced game rather than the pre-corridor one. The
events-on row is not the live default, but it is the flattest spread the era has
produced — worth remembering if the lobby ever turns events on for this era.

## 4. The tuning that got here, and what it cost

Every number below is 400 games × 3 seeds on the deterministic harness unless
noted.

| Change | Why | Measured |
|---|---|---|
| **Jump Gate lanes carry no attack** | With gate lanes fighting like authored ones, mobility paid the leader: turn-10 leader 55% → 68%, games down to 25.7 turns, Sol 38%, and the Forge Syndicate — whose gates these are — down to 13.5%, because mobility erodes exactly the positional defence a turtle lives on. | Sol 38.0 → 26.5, leader 68 → 60 (200g, seed A) |
| **Vault `home_unit_bonus` removed** | It was Phase 4 compensation for the Custodians starting without the ring; by Phase 6 they were the strongest seat. | Nexus 34.4 → 27.1 avg |
| **Forge `reinforce_bonus` 1 → 2** | The only purely economic kit in the era, and the one that kept losing anyway. Its buildings and half-price gates were already the most-built of the four and did not convert. | Rust 14.3 → 19.5 avg |
| **Sol research discount removed** | The last compounding lever. Sol III is the centre of the ring and worth ~24% on position alone; the discount added ten points on top. | Sol 34.6 → 25.8 avg |

Two things were tried and **rejected on the evidence**:

- **A production-to-attack die for Forge** (+1 attack die from a territory with a
  production building). It moved Forge 12.5% → 12.5%. A balance lever that does
  not move the number it exists for is surface for nothing, so it came out.
- **Capping the AI at two gate worlds** instead of three. Sol 45%, Verdan 14% —
  worse on both ends, and the gate counts barely changed because captured gates
  get rebuilt.

**Sol's Cradle world rule measures as inert.** Removing `population_growth_mult`
changed nothing on two of three seeds; removing `deploy_cap_bonus` changed
nothing on any (the deploy cap only binds below 50 stability, which the AI rarely
reaches). Sol's identity is currently carried by Blockade Runner and by position.
Giving that world a rule that actually fires is the clearest next balance job.

## 5. Lane weather (`SIM_EVENTS=1`)

Events are off by default for this era, so weather is measured on its own run.

| Metric | 400g, seed A |
|---|---|
| Nebula Closures per game | 2.3 |
| Lane Surges per game | 2.3 |
| Games opening a surge where somebody crossed it | 85.8% |
| Surge crossings total | 1828 |

A harness bug surfaced here too: the socket clears `active_event` once it has
broadcast the card, and with no socket the sim left it set, re-applying the same
instant card every round (11.6 "closures" per game where the deck can deal about
4). The sim now clears it the way `broadcastEventCard` does.

## 6. Open

- **Forge at 18.2%** (17.3–19.5 across seeds), the floor of the band. The next
  lever is theirs alone rather than a shared mechanic — the gates were meant to
  be that and turned out to be logistics everyone uses.
- **Sol's Cradle rule does nothing measurable** (§4).
- **The snowball**: turn-10 leader at ~61%.
- **Only four-player games are measured**, because that is the only shape the
  create boundary allows: the one-faction-per-world start fires only for four
  seats with four distinct factions, and the Vault start assumes it.
- **Stability's own randomness** (`cryptoFraction` for rebellions and population)
  is still unseeded. It did not break run-to-run determinism in practice, but it
  is the one remaining source that could.

## History

- **2026-09-09 (Phases 0–4):** grind-faithful harness; Nexus tech yield 0.05 →
  0.0625 (it floored to zero); corridors replaced the Hyperspace Chart gate;
  worlds got their rules. Sol 41 → 28, Rust 14 → 19.
- **Pre-fix baseline (obsolete):** the pre-densification map on the
  single-exchange harness — stellar_mandate 2.0% / 1.2%, forge_syndicate 36% /
  33%, helion_navigators 35% / 41%, void_custodians 27% / 25%; ~45% of games hit
  the cap.
