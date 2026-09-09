# Space Age — The Moon Race: Design Package

**Status: design-archive → proposed. Phases 0, 1 and 2a done (2026-09-09).** No gameplay phase is implemented; Phase 0's prerequisites are complete and its measurements are recorded in §2. It specifies a phased, flag-gated package that turns the Space Age Moon from a cost centre into the keystone of the era, and it is written against the systems that exist today so each phase is an engineering task rather than an idea.

Owner of the questions this answers: the Space Age review session (PRs #253–#274). Companion reading: [PLAYER_GUIDE.md § Space Age Moon ladder](../PLAYER_GUIDE.md), `backend/src/game-engine/state/moonAccess.ts`, `backend/scripts/simSpaceAgeBalance.ts`.

---

## 0. Why

### 0.1 What the Moon is today

| | |
|---|---|
| Tiles | 9, region `lunar_surface`, bonus **+6** |
| Access | `sa_lunar_expansion` **+** a `launch_pad` **+** (`space_station_launched` **or** `wonder_space_elevator`) — or the Lunar Pioneers faction from turn one |
| Ladder | `sa_orbital_recon → sa_launch_pad_tech → sa_space_station → sa_lunar_expansion`: four techs, two builds |
| Lanes | three authored orbit lanes from Earth anchors (`na_launch_base`, `euro_spaceport`, `asia_cosmodrome`) plus a lane from every Launch Pad to its nearest landing zone |
| Reward | the +6 region bonus, and nine tiles that threaten nobody |

Meanwhile the era's most dramatic powers — `dyson_beam` (a global 4-unit strike), `swarm_strike`, `sa_singularity_war` — sit on the **Earth** side of the tree. A rational player ignores the Moon.

### 0.2 What the sims already told us

`games.routes.ts:146` records the measurement that led to the current defaults: *Space Age ~93% of medium games hit the 80-turn cap and domination never fired in 120 games.* The response was `applyOrbitGatedVictoryDefaults`: a **60% threshold** win plus a **90-turn** leader-wins backstop.

Two corrections that matter for this design:

- **"Domination never fired" is not a Moon finding.** `checkVictory` returns `last_standing` unconditionally at line 986 the moment one player remains, and elimination is immediate on losing a last tile (`executeLandAttack.ts:207`). Holding every tile implies every rival is already eliminated, so `domination` can never be the reported condition on *any* map. It was never diagnostic.
- **The shipped configuration has not been measured.** `simSpaceAgeBalance.ts` defaults to `SIM_MAX_TURNS=80` with no threshold — the pre-fix ruleset. The 93% figure describes a game nobody plays any more. Phase 0 fixes that before anything is built on top of it.

### 0.3 What is actually wrong

The Moon is expensive to reach, contributes nothing to winning that Earth doesn't contribute better, and — the structural flaw — **the cost to contest it equals the cost to reach it**. Once one player lands, every rival still needs the full ladder to dislodge them. That is what makes any Moon-based reward risk becoming *first-to-Moon-wins*.

### 0.4 Design principles

Every phase below is held to these; where a rule exists only to satisfy one of them, it says so.

1. **Contestable.** The cost to *contest* an occupied Moon must be lower than the cost to *discover* it.
2. **Partial rewards.** The Moon must matter at 3 tiles, not only at 9. Two players on the Moon is a live state, not a failure state.
3. **Cost the abstainers.** The strongest incentive is not a bigger prize for the winner; it is making it expensive to ignore. This is what Tribute is for, and why it is a knob rather than a default.
4. **Legible.** Counters and countdowns on the HUD. The Moon inset (now minimizable, #266) should earn its screen space by mid-game.
5. **The AI must be able to play it.** A Moon design shipped into a game where bots never contest the Moon hands every human Moon-rusher an uncontested win. See Phase 0.
6. **One knob per PR, dark-launched.** Every phase is a flag in `FLAG_CODE_DEFAULTS`, baked into `GameSettings` at create so the engine stays pure and a flip never re-rules a match in progress — the `space_age_frontiers_enabled` pattern — with its kill switch visible in Admin → Config once promoted.

---

## 1. Package overview

| Phase | Name | Delivers | Flag | New engine surface |
|---|---|---|---|---|
| 0 ✅ | Prerequisites | AI Moon launch guarded; shipped ruleset measured as the control | — | none (test + harness) |
| 1 ✅ | Helium-3 economy | Per-tile lunar income; a sink so it's worth something on day one; partial rewards | `space_age_moon_helium3_enabled` (dark) | `PlayerState.helium3`, income tick, one draft ability |
| 2a ✅ | The gated tier | `dyson_beam` moved behind Moon control and priced in He-3; **Orbital Drop** (reinforcement) | `space_age_moon_gated_tier_enabled` (dark) | `requiresMoonTiles` / `helium3Cost` on the ability descriptor |
| 2b | Drop Assault | The drop that can take a tile: telegraphed, resolved from a virtual origin | same flag | attack resolution from a transient source |
| 3 | Lunar Hegemony | A Moon-only victory with reset-on-loss and a relaxed contest gate | `space_age_moon_hegemony_enabled` | new `VictoryType`, clock state, `contest` access mode |
| 4 | Orbital Blockade | Lane seals for Space Age, reusing the Galactic mechanic; anchor lanes only | `space_age_moon_blockade_enabled` | create-boundary change, seal cost, lane filter |
| 5 | Lunar Missions | Space Age secret-mission branch | `space_age_moon_missions_enabled` | two `SecretMission` kinds + generator branch |
| knob | Tribute | Tech-point tithe on Earth-only players | `space_age_moon_tribute_enabled` (**default OFF**) | income-tick transfer |

**Player-facing surface:** one lobby toggle, **Moon Race**, which enables whichever phases have shipped. The per-phase flags are operator kill switches, not player choices — six checkboxes in a lobby would be the wrong product.

**Order is load-bearing.** Phase 1 without 2 is a resource with one sink; Phase 3 without 1 is a hold-the-Moon race with no reason to hold three tiles; Phase 4 without 3 is a defensive tool with nothing to defend. Phase 5 is independent and can land any time after 1.

---

## 2. Phase 0 — Prerequisites

### 2.1 The AI's Moon launch — ✅ already fixed, now guarded

**This section was wrong when written, and the correction matters.** It claimed the AI launch fails in production. It does not: the ordering was fixed in **ae02c66 (2026-07-13)**, and in `processAiTurn` the launch block runs at `gameSocket.ts:5379`, before the phase transition at `:5395`. The claim came from `simSpaceAgeBalance.ts`'s docstring, which still described the bug as live — it was written before the fix and never updated. Reading the harness comment instead of the socket code is how a stale comment became a design prerequisite.

Measured, not assumed: in 60 games on the shipped ruleset, **100% of games see a station launched** (avg first launch turn 17.0) and **100% see a Moon tile captured** (avg first capture turn 24.1). Bots reach the Moon.

What was genuinely missing is a **guard**. The five existing socket tests all drive `game:use_ability` as a human, so none of them would notice the block moving back; the fix was protected by a comment. Phase 0 adds an AI-path test that drives a real AI turn end to end and asserts the launch happened. Verified by reintroducing the bug: the new test fails with *"the bot finished the ladder and held a pad but never launched"* while all five human tests still pass.

The design's assumption — that bots contest the Moon — holds. It is now enforced rather than hoped for.

### 2.2 Measure the shipped ruleset

Run `simSpaceAgeBalance.ts` three ways, 60 games each, `SIM_SEED=phase0`, 4 players, medium.

**Results (2026-09-09, commit 0e344f9):**

| Run | Knobs | Decisive | Condition split | Median length |
|---|---|---|---|---|
| A — baseline | defaults (`SIM_MAX_TURNS=80`, no threshold) | **1.7%** | `turn_limit` 59 · `last_standing` 1 | 81 |
| B — **shipped** | `SIM_THRESHOLD=60 SIM_MAX_TURNS=90` | **23.3%** | `threshold` 14 · `turn_limit` 46 | 91 |
| C — shipped + factions | B + `SIM_FACTIONS=1` | **28.3%** | `threshold` 17 · `turn_limit` 43 | 91 |

**The threshold fix landed, and is not sufficient.** Decisive endings went from 1.7% to 23.3% — a real improvement, and the reason the default exists. But **77% of games still run to the 90-turn cap**. The era's ending is still mostly "whoever was ahead when the clock stopped".

Run A also revises the number this era has been quoted against: at the pre-fix ruleset the cap rate is **98.3%**, not the ~93% recorded in `games.routes.ts`. That comment predates the frontier tiles being seeded by default (63 tiles rather than 55), which is the likely cause.

Two further readings that shape the phases below:

- **Moon presence already correlates with winning, weakly.** The end-game Moon-tile leader won 45.5% of run B against a 25% baseline — but that drops from 63.6% in run A, because a threshold win can be taken on Earth. The Moon is a good place to be, not a reason to win.
- **Lunar Pioneers are not dominant.** Per-faction win rates in run C: Climate Alliance 35.0%, Solar Caliphate 30.0%, **Lunar Pioneers 27.5%**, Sino-Pacific 22.5%, Terran Federation 17.5%, Corporate Enclave 17.5% (baseline 25%). Pioneers sit +2.5 over baseline, well inside the ±8 band the Phase 1 gate allows. The outliers are Climate Alliance high and Terran/Corporate low — a faction-balance question, not a Moon one.
- **Reaching the Moon is not the bottleneck; profiting from it is.** Corporate Enclave reaches the Moon in 95% of its games with the highest average holding (2.88 tiles) and wins 17.5%. That is the design thesis in one row.

**Not yet measured:** whether a `turn_limit` winner was already leading at turn 40. The harness reports a turn-10 leader correlation but nothing at turn 40; adding it is a small change to the reporting block and is worth doing before Phase 3, whose gate is about whether the cap is truncating live contests.

These numbers are the **control group** for every phase gate below.

### 2.3 Harness

Add to `simSpaceAgeBalance.ts`: `SIM_MOON_HELIUM3`, `SIM_MOON_TIER`, `SIM_MOON_HEGEMONY`, `SIM_MOON_BLOCKADE`, `SIM_MOON_MISSIONS`, `SIM_MOON_TRIBUTE` (each `=1` sets the corresponding game setting), `SIM_HEGEMONY_TURNS` (the clock length). Add to the report: He-3 income per player per game, games with ≥2 players holding Moon tiles, Hegemony clocks started / reset / completed, seals placed, drops fired. Extend the CSV.

`SIM_MOON_HELIUM3` and `SIM_MOON_TIER` are in (Phases 1 and 2a); `SIM_MOON_TIER=1` implies the economy, mirroring the engine. Two metrics print **unconditionally** so a control run reports them too: games with 2+ players on the Moon, and games where any player held ≥3 Moon tiles — the latter is the denominator §4.5 scores usage over.

**Replicates, not single runs.** The AI's score jitter comes from `Math.random`, which the harness does not seed (it seeds dice and setup only), so one 60-game run of a configuration is a draw, not a measurement — roughly ±8 points on the decisive rate. Run each arm ≥5 times with a shared seed set and report the mean with its range.

---

## 3. Phase 1 — The Helium-3 economy

### 3.1 The resource

`PlayerState.helium3?: number`. A **new field**, not `special_resource` — that one is era-advancement gold (`advanceEra.ts:113`) and reusing it would let a Moon-holder buy era advances with lunar income.

### 3.2 Income

At the owner's income tick, each owned `lunar_surface` tile yields He-3:

| Tile | He-3 / turn | Why |
|---|---|---|
| `moon_polar_north`, `moon_polar_south` | **2** | Polar ice — and they are the hubs: North Polar Basin touches three tiles. Making the poles the prize creates a natural fight inside the Moon rather than a sweep |
| every other Moon tile | **1** | |

Full Moon = **11 He-3/turn**. Stockpile cap **30** (a hoard past that is a runaway waiting to happen; the cap also bounds AI planning). Both numbers are tunables; see §9.

### 3.3 The Phase 1 sink — Lunar Export

Phase 1 must be worth something on its own or it is dead until Phase 2 ships. The cheapest sink using existing machinery:

**`lunar_export`** — draft-phase ability (`techAbilities.ts` descriptor: `scope: 'turn', phase: 'draft'`), converts up to **5 He-3 → 5 tech points** per turn, 1:1. Requires ≥1 Moon tile. This makes three Moon tiles equal to a `sa_fusion_power` worth of tech income, which is the partial reward in one number.

Once Phase 2 ships, players face a real choice — export for tech, or bank for the drop — which is the point.

### 3.4 Region bonus

`lunar_surface` keeps **+6** for full control. It is now the least interesting Moon reward, which is correct.

### 3.5 Lunar Pioneers

They start with Moon access and +2 defence dice there (`spaceage.ts:79`). He-3 makes their opening stronger. **Do not pre-nerf**; Phase 0's factions run gives the baseline, and Phase 1's gate (§3.7) has an explicit Pioneers criterion.

### 3.6 AI — one half shipped, one half measured and rejected

**Shipped:** the bot fires `lunar_export` whenever He-3 ≥ 5 and it holds lunar ground, mirrored in both `gameSocket.processAiTurn` and the sim. Only on a full load, so its one use per turn is not spent on a single point.

**Rejected, on evidence:** this section also asked for a Moon tile's He-3 yield to be scored in the AI's attack valuation, weighting the poles. It was built — `attackObjectiveBonus` gained `helium3YieldOf(target) * 1.4`, sized against the capital bonus of 3 — and it made the game distinctly worse:

| AI Moon weight | Moon-tile leader won | Decisive endings |
|---|---|---|
| 1.4 (as designed) | 59.3% | **13.3%** |
| 0.5 | 56.1% | 21.7% |
| **0 (shipped)** | **32.1%** | **30.0%** |
| *He-3 off entirely* | *46.6%* | *26.7%* |

Weighting lunar ground pulled bots into fights over a sideshow: they spent turns on the Moon instead of on the Earth conquest that actually ends games, so decisive endings halved and the Moon-leader correlation inflated. The effect is monotonic in the weight, so there is no small safe value.

The Moon is contested without the thumb on the scale — 95% of games see two or more players holding lunar tiles either way — because the ladder and the region bonus already pull bots there. **The pull toward the poles belongs in Phase 2**, where He-3 buys real powers and the AI's ability planning will value it for what it can do, rather than in the attack scorer valuing it for its own sake.

### 3.7 UI

**Shipped:** the HUD resource strip gains an **He-3** counter beside tech points, shown whenever the setting is on — from turn one, not once the player has some. A resource you only discover after already earning it is not an incentive to go and get it.

**Deferred:** the Moon-inset tile-count badge and the per-tile yield in the territory panel. Both are worth having and neither is load-bearing for the gate; they belong with Phase 2's HUD work, when there is a spend to show alongside the stock.

### 3.8 Gate to Phase 2 — measured 2026-09-09

60 games, `SIM_SEED=phase0`, 4p medium, threshold 60 / 90 turns, against a **matched control on the same commit** with the flag off.

| | Control | Phase 1 | |
|---|---|---|---|
| Decisive endings | 25.0% | 23.3% | within noise |
| Decisive endings (factions) | 35.0% | 43.3% | within noise |
| Moon-tile leader won | 33.3% | 36.8% | within noise |
| 2+ players on the Moon | 95.0% | 95.0% | — |
| First Moon capture (turn) | 24.3 | 23.9 | within noise |
| Lunar Pioneers win share | 30.0% | 22.5% | mean 25.0%, so −2.5 |
| He-3 exported per game | — | 375.6, in 100% of games | the sink fires |

**Verdict: passes as written, and the honest read is "neutral".** Nothing regressed, the mechanic works end to end, and the era's core numbers did not move. That is what §1 predicted — *"Phase 1 without 2 is a resource with one sink"* — so it is a reason to build Phase 2, not a reason to stop.

Two things the run taught us about the gate itself:

- **The ≥40% shared-Moon criterion was never discriminating.** The control also scores 95%: two players end up on the Moon regardless, because the ladder and the region bonus already send them. Phase 2 and 3 should measure *how long* the Moon stays shared, not whether it ever is.
- **Roughly 375 tech points a game were injected and nothing moved.** Tech points are not a mid-game bottleneck for these bots, which makes Lunar Export a weak reward *and* a weak risk. That is fine for a placeholder sink, and it is more evidence that the interesting spend is Phase 2's, not this one's. Adjusting the export ceiling between 1 and 5 changed nothing outside noise, so §9's `Lunar Export per turn` bound is not a useful tuning lever — leave it at 5.

---

## 4. Phase 2 — The gated tier

### 4.1 Move `dyson_beam` behind the Moon

Today `sa_dyson_array` (tier 4, prereq `sa_quantum_grid`, cost 26) grants +8 TP/turn **and** unlocks `dyson_beam` — `{ scope: 'turn', phase: 'attack', unitReduction: 4, minTargetUnits: 1 }`, no adjacency, i.e. already a global strike.

**Change (ability, not tech):** `sa_dyson_array` keeps its tech income; the ability descriptor gains two fields:

```ts
dyson_beam: { ..., requiresMoonTiles: 1, helium3Cost: 6 }
```

The tech ladder is untouched, so an Earth-only player still gets the +8 TP — but the beam itself needs a foothold on the Moon and lunar fuel. Rationale for gating the ability rather than re-parenting the tech under `sa_lunar_expansion`: it keeps `sa_dyson_array` a sensible Earth pick and puts the *dramatic* thing, not the *economic* thing, on the Moon.

Rename in the strike copy: "Dyson Beam" → keep the name; the lore is that the collector is on the Moon.

### 4.2 Orbital Drop

The fantasy: land a force anywhere on Earth. The danger: it collapses Earth geography. Two variants, shipped in order.

**2a — Orbital Reinforcement (ships first).** Draft-phase ability using the existing `ownPlacement` descriptor:

```ts
orbital_drop: { label: 'Orbital Drop', scope: 'turn', phase: 'draft',
                requiresMoonTiles: 3, helium3Cost: 8, ownPlacement: { units: 3, anyOwned: true } }
```

Place 3 units on **any territory you already own**, anywhere. This is a teleport reinforcement — strong, geography-bending, but it cannot take a tile by itself. `ownPlacement` already supports `requiresMoon`; `anyOwned` is the one new option (today's placements are adjacency-bound by the caller).

**2b — Drop Assault (the target).** Attack-phase; spend **10 He-3** to land 3 units on an **enemy or neutral Earth territory** and resolve a normal attack from a virtual origin. **Telegraphed:** the drop is declared during the player's draft phase and lands at the *start of their next turn*, with a visible marker on the target for every player in between. The defender's counterplay is to reinforce the marked tile. Cooldown: `scope: 'game'`-style cooldown of **3 own-turns** (a new `cooldownTurns` descriptor field). Requires **≥3 Moon tiles** at declaration *and* at landing; losing the foothold cancels the drop and refunds nothing.

This is the only genuinely new engine piece in the package: `executeLandAttack` takes a `fromId`; the drop needs a virtual origin whose units are the dropped stack. Specify it as a wrapper that materialises a transient source, calls the existing resolver so dice, modifiers, elimination and card draw all behave, then discards survivors that did not capture (they are lost — a failed drop is a real loss).

**Why 2a first:** it ships the He-3 sink and the "anywhere on Earth" feel with zero new resolution code, and the sims then tell us whether 2b's geography collapse is a problem before it is built.

### 4.3 Threshold bookkeeping

`requiresMoonTiles` is checked at use time against live ownership, so a player who loses tiles mid-turn loses the ability mid-turn. That is intended: the Moon is a *position*, not a *credential*.

### 4.4 AI

Bank He-3 for `dyson_beam` when an enemy stack ≥ 6 units borders an owned tile; use `orbital_drop` (2a) to reinforce the weakest owned tile under threat when He-3 ≥ 8 and export would be wasted. 2b: drop-assault a tile that would complete a region bonus, when the AI holds ≥5 Moon tiles.

### 4.5 Gate to Phase 3 — measured 2026-09-09

Beam and drop usage both non-zero in ≥60% of games where any player holds ≥3 Moon tiles; the Moon-holder's win share rises versus Phase 1 but stays **below 60%** in 4-player games (above that, the tier is a win button and costs go up before Phase 3 starts); games with ≥2 players on the Moon do not fall.

**Measured over 5 replicates × 60 games per configuration** (4p medium, threshold 60 / 90 turns, seeds s1–s5 shared across configurations). Mean, with the replicate range in brackets:

| | flag off (today) | Phase 1 | Phase 2a |
|---|---|---|---|
| Dyson Beam fired, of reachable games | — | — | **99.7%** [98.3–100] |
| Orbital Drop used, of reachable games | — | — | **99.7%** [98.3–100] |
| Moon-tile leader won | 37.6 [33.3–43.1] | 43.5 [37.5–47.1] | **52.0** [41.4–59.6] |
| Peak-Moon leader won | 29.7 [26.7–33.3] | 36.4 [26.7–41.7] | 39.7 [23.3–48.3] |
| Games with 2+ on the Moon | 92.0 [90.0–98.3] | 92.0 [88.3–96.7] | 92.3 [86.7–98.3] |
| Decisive endings | 32.0 [25.0–43.3] | 24.7 [20.0–35.0] | 26.7 [16.7–36.7] |
| He-3 exported per game | — | 384.6 | **7.5** |
| Beams / drops per game | — | — | 33.9 / 32.4 |

**All three criteria pass.** Usage is near-total rather than marginal, the Moon-holder's win share rises 43.5 → 52.0 and stays under the ceiling, and shared-Moon games are flat.

Four things the run taught us, all of which change how later phases should be measured:

- **The harness is not deterministic, and single runs were never evidence.** `computeAiTurn` takes its score jitter from `Math.random` (aiBot.ts:111) and the sim seeds only dice and setup, so a 60-game run of one configuration varies by roughly ±8 points on decisive endings. Phase 1's gate was reported from one run per arm; re-measured with replicates its decisive rate is 24.7 [20.0–35.0] against an off-control of 32.0 [25.0–43.3], which is a *worse* point estimate than the 23.3 vs 25.0 recorded at the time. **Every future phase gate takes replicates**, and §13's single-run figures should be read as one draw each.
- **The Moon-holder correlation is mostly not caused by the tier.** It is already 37.6% with every flag off, because the player holding the Moon is usually just the strongest player. The tier adds ~8 points on top of that.
- **Price is not the lever for it.** Raising the beam 6 → 10 and the drop 8 → 14 cut drops per game from 32.4 to 10.6 and moved the Moon-holder win share not at all (52.0 → 51.4, with peak-Moon *up* at 44.3). Same shape as Phase 1's export-ceiling result: §9's costs are not a useful dial for the win correlation, and the initial values stand. If the win share ever does need pulling down, the lever is who can hold the Moon, not what holding it costs.
- **The tier ate Phase 1's sink.** He-3 exported per game falls 384.6 → 7.5, because a bot that can fire a power banks for it instead of converting. Phase 1 measured those ~385 tech points as changing nothing, so nothing measurable was lost — but Lunar Export is now close to vestigial for the AI, and §8's Tribute knob has correspondingly less to bite on.

### 4.6 What 2a actually shipped, versus this design

- **`anyOwned` was not needed.** §4.2 called for a new `ownPlacement` option because "today's placements are adjacency-bound by the caller". They are not: the executor's `ownPlacement` branch validates ownership and nothing else, so "any territory you own, anywhere" is what it already did. Orbital Drop is `ownPlacement: { units: 3 }` plus the Moon gate, with no new placement option.
- **The gate is enforced by a wrapper, not per-branch.** `executeTechAbility` now checks the requirement before anything mutates and charges the He-3 only after the effect reports success, so a use rejected for a bad target or the wrong phase costs nothing. The alternative was getting that right in a dozen separate branches.
- **Phase 2 requires Phase 1 in code, not just by convention.** Both powers are priced in He-3, so the tier flag without the economy flag would not gate `dyson_beam` — it would delete it. `areMoonPowersEnabled` requires both.
- **The AI's first tech-unlocked strike.** The existing AI parity blocks cover faction abilities only, so before this a bot holding `nuclear_strike` or `orbital_strike` never fired it. Phase 2a adds that for `dyson_beam` alone, scoped to the flag so the control run stays today's game. Widening it to the other strikes is its own change and its own measurement.
- **Phase 1 had no human path.** Abilities are surfaced in the UI by walking the tech tree for `unlocks_ability`, and Lunar Export deliberately has no unlocking tech, so no button ever rendered and only bots used the sink. Fixed here for both Moon-ground powers; a lunar tile count now feeds the ability panels.

---

## 5. Phase 3 — Lunar Hegemony

### 5.1 The victory

A new `VictoryType`: **`lunar_hegemony`**. Hold **all 9** `lunar_surface` tiles at the end of your turn for **6 consecutive own-turns** (`HEGEMONY_TURNS`, tunable). The check is the existing `control_regions` semantics against `lunar_surface`, run at end of turn.

Placement in `checkVictory`: inside the per-player loop after `threshold`, before `capital` — same precedence as the other alternates. `last_standing` still pre-empts, which is fine: a player who also cleared Earth has won either way.

`applyOrbitGatedVictoryDefaults` adds `lunar_hegemony` to the default list alongside `threshold` when the flag is on and the caller chose no conditions. Explicit lobby choices still win.

### 5.2 The clock

```ts
state.lunar_hegemony?: { owner_id: string; turns_held: number; started_turn: number }
```

- Starts when a player ends a turn holding 9/9.
- Increments at the end of each of that player's own turns while 9/9 holds.
- **Resets to zero the moment any Moon tile leaves the holder** — checked on capture (`onCapture` in `executeLandAttack`) and at end of every round, so an event card that flips a tile also resets it.
- Cleared if the holder is eliminated.

**Legibility (principle 4):** a HUD banner for every player — *"⟨name⟩ holds the Moon · Hegemony in N turns"* — and a countdown badge on the Moon inset. The threat has to be readable by the people who need to answer it. `buildChronicle.ts` gains a `lunar_hegemony` case: *"They held the Moon long enough that Earth stopped mattering."*

### 5.3 The contest rule — "the race is over, the war begins"

This is the rule that exists to satisfy principle 1, and the package fails without it.

`getOrbitAccessResult` gains a mode, **`contest`**: when the flag is on **and any player holds ≥1 Moon tile**, every other player's Moon access requirement drops to **`sa_launch_pad_tech` + an owned `launch_pad`**. No Space Station, no Lunar Expansion. Their Launch Pad lane already reaches the nearest landing zone (`launchPadLaneConnections`).

Discovery cost stays four techs and two builds. Contest cost becomes two techs (`sa_orbital_recon → sa_launch_pad_tech`) and one build. The first lander earns a head start, not a fortress.

`formatOrbitAccessError` gets the matching copy: *"The Moon is contested — you need Launch Pad tech and a Launch Pad to join the fight."*

### 5.4 Interactions

- **Threshold-60 and turn cap:** both remain. Hegemony is a *third* decisive route, which is the whole reason it exists — it decouples the end-game from the 54-tile Earth grind. Clock length 6 against a 90-turn cap leaves room for two full attempts.
- **Lunar Pioneers:** Moon access from turn one makes them the natural Hegemon. Tunable: `HEGEMONY_TURNS_PIONEERS = HEGEMONY_TURNS + 2`. Apply only if Phase 3 sims show Pioneers completing Hegemony at more than **1.5×** the faction mean.
- **Blockade (Phase 4):** a Hegemon will seal lanes; the contest rule's Launch Pad lanes are deliberately unsealable (§6.3), so the clock can always be attacked.

### 5.5 AI

Pursue Hegemony when holding ≥6 Moon tiles and the nearest rival Moon presence is ≤2 tiles. Hold: when the clock is running, weight Moon-tile defence above Earth expansion. Break: every other AI, when a rival's clock is ≤3, prioritises (in order) attacking a lane-adjacent Moon tile, building a Launch Pad if it lacks one, researching `sa_launch_pad_tech` if it lacks that.

### 5.6 Gate to Phase 4

Hegemony fires in **10–35%** of games (below 10 it is decorative; above 35 it dominates); **≥50% of started clocks are reset at least once** (it is being contested); decisive rate up versus Phase 0 control; `turn_limit` share down.

---

## 6. Phase 4 — Orbital Blockade

### 6.1 Reuse

Everything needed exists for the Galactic Age: `state.lane_blockades`, `canSealLane`, `isLaneSealedForPlayer`, `tickLaneBlockades`, `GALAXY_LANE_SEAL_DURATION = 3`, and the `lanes_contestable_enabled` setting. Space Age is deliberately blocked from it at the create boundary (`games.routes.ts:200`, keyed on `isGalacticAge`).

### 6.2 Changes

1. **Create boundary:** allow `lanes_contestable_enabled` for Space Age when `space_age_moon_blockade_enabled` is on. The Moon Race lobby toggle sets it.
2. **Cost:** sealing costs **3 He-3** in Space Age (Galaxy stays free). Ties defence to the economy; a Hegemon spending on seals is a Hegemon not spending on beams.
3. **Duration:** `SPACE_AGE_LANE_SEAL_DURATION = 2` (Galaxy's 3 is tuned for a bigger board).
4. **Endpoint ownership** (already required by `canSealLane`): from the Moon end, hold the landing-zone tile; from Earth, hold the anchor. Both are existing "endpoints".
5. **Seal drops when the owner loses both endpoints.** New check in `tickLaneBlockades`; today a seal outlives its owner's presence.

### 6.3 Which lanes — the deliberate exclusion

`syncLaunchPadLanes` writes Launch Pad lanes into `map.connections` with `type: 'orbit'` and `source: 'launch_pad'`, so `isOrbitLane` **would** let them be sealed. **They must not be.** Add to `canSealLane`: in Space Age, only lanes with `source !== LAUNCH_PAD_LANE_SOURCE` — the three authored anchor lanes — are sealable.

This is principle 1 applied to Phase 4: the anchors are the *convenient* routes and can be denied; the Launch Pad lanes are the *contest* route and stay open. A Hegemon can make you build a pad; a Hegemon cannot lock you out.

### 6.4 Earth consequences

Sealing an anchor lane makes the anchor tile itself strategic — capture `euro_spaceport` and the seal's Earth endpoint changes hands, dropping it under §6.2(5). There are now Earth fights *about* the Moon, which is the second-order effect the package wants.

### 6.5 Gate

Seals used in ≥40% of games with a running Hegemony clock; **Hegemony completion rate does not rise by more than 5 points** versus Phase 3 (if seals make the clock uncontestable, the exclusion in §6.3 is not doing its job and the anchor lanes need a shorter duration).

---

## 7. Phase 5 — Lunar missions

### 7.1 Reuse first

Two of the four wanted missions need **no new kinds**:

| Mission | Existing kind |
|---|---|
| Hold both polar basins | `{ kind: 'capture_territories', territory_ids: ['moon_polar_north', 'moon_polar_south'] }` |
| Control the whole Moon | `{ kind: 'control_regions', region_ids: ['lunar_surface'] }` |

### 7.2 Two new kinds

```ts
| { kind: 'lunar_foothold'; tiles: number }              // hold ≥ tiles Moon territories (3 or 5)
| { kind: 'lunar_denial'; target_player_id: string }     // you hold ≥1 Moon tile and target holds 0
```

`isMissionComplete` gains both cases. `lunar_denial` is the asymmetric one: it gives a player a reason to go to the Moon *against someone*, which spreads the table's Moon interest across different targets instead of one race.

### 7.3 Generator

`assignSecretMissions` (`victory/missions.ts`) gains a branch guarded exactly like the era-advancement branch — *gated so the RNG stream for non-Space-Age games is unchanged*: when the map is Space Age and the flag is on, a `roll < 0.30` slot picks uniformly from the four lunar missions (denial only when a valid target exists). The existing PR that stopped missions targeting unseeded frontiers already guarantees Moon tiles are seeded neutral and valid targets.

### 7.4 Gate

Independent of the others; ship when `isMissionComplete` tests pass and a 60-game `SIM_MOON_MISSIONS=1` run shows lunar missions completing at a rate within ±10 points of the existing mission mean.

---

## 8. The knob — Tribute (default OFF)

`space_age_moon_tribute_enabled`. A player holding **≥6** Moon tiles levies **1 tech point per turn from each player holding 0 Moon tiles**, transferred at the tithe-payer's income tick, visible as a line item.

This is principle 3 — cost the abstainers — and it is the most direct incentive in the package. It is a knob and not a default because it is also the most resented mechanic here: a player who chose an Earth strategy is being taxed for it. **Turn it on only if** the Phase 3 gate shows games with ≥2 players on the Moon falling *below* the Phase 1 number — i.e. the table has learned to let one player have the Moon. If that never happens, this never ships.

---

## 9. Tunables

All initial values; every one is expected to move after the phase's sim run.

| Name | Initial | Phase | Bounds worth trying |
|---|---|---|---|
| He-3 per ordinary tile | 1 | 1 | 1–2 |
| He-3 per polar basin | 2 | 1 | 2–3 |
| He-3 stockpile cap | 30 | 1 | 20–40 |
| Lunar Export per turn | 5 | 1 | 3–6 |
| `dyson_beam` He-3 cost | 6 | 2 | 4–10 |
| `dyson_beam` Moon tiles | 1 | 2 | 1–3 |
| Orbital Drop He-3 cost (2a / 2b) | 8 / 10 | 2 | 6–14 |
| Orbital Drop Moon tiles | 3 | 2 | 2–5 |
| Drop Assault cooldown | 3 own-turns | 2 | 2–5 |
| `HEGEMONY_TURNS` | 6 | 3 | 4–8 |
| `HEGEMONY_TURNS_PIONEERS` | +2 | 3 | +0 to +3 |
| Seal He-3 cost | 3 | 4 | 2–5 |
| `SPACE_AGE_LANE_SEAL_DURATION` | 2 | 4 | 1–3 |
| Lunar mission roll weight | 0.30 | 5 | 0.2–0.4 |
| Tribute threshold / amount | 6 tiles / 1 TP | knob | 5–7 / 1–2 |

---

## 10. Flags, settings, and rollout

### 10.1 Per phase

Each phase adds, following the `space_age_frontiers_enabled` pattern:

- an entry in `FLAG_CODE_DEFAULTS` (`backend/src/config/featureFlags.ts`), **`envOptIn` while dark**, promoted to `envOptOut` once the phase gate passes on staging;
- a getter on the flags object;
- **baked into `GameSettings` at create** (`games.routes.ts`), so the engine reads the setting and stays pure, and a flip never changes a match in progress;
- an Admin → Config kill switch (`CLIENT_FEATURE_FLAGS` in `AdminPage.tsx`) — every flag that defaults ON needs it visible;
- a sim knob (§2.3).

Backend-only flags stay out of `getClientFeatureFlags()`; the client reads the baked game setting.

### 10.2 The lobby

One toggle, **Moon Race**, on Space Age era games. Sets every shipped phase's game setting. Off = today's game exactly. Ranked: off until Phase 3's gate has passed on production data, then on.

### 10.3 One PR per phase

Each phase is one PR off `main`, dark-launched, with its sim run and gate numbers in the PR body. Phase 2b (Drop Assault) is its own PR after 2a. Promotion to ON is a separate one-line PR once staging has been checked — leaving it OFF in code while prod runs on an override is how the repo starts lying about what players see.

---

## 11. Risks

| Risk | Where it would show | Mitigation already in the design |
|---|---|---|
| He-3 compounding runaway | Phase 1 gate: Moon-holder win share | stockpile cap; Export is 1:1 not multiplicative; costs in §9 scale up |
| First-to-Moon-wins | Phase 3 gate: clock reset rate | the contest rule (§5.3); unsealable pad lanes (§6.3) |
| Lunar Pioneers dominate | every gate's faction criterion | Pioneers clock offset (§5.4); their +2 def is the knob to touch next |
| Drop collapses Earth geography | Phase 2 gate; player reports | 2a before 2b; telegraphed landing; cooldown; cost |
| AI cannot contest the Moon | everywhere | resolved: bots launch in 100% of games and capture Moon tiles in 100% (§2.1–2.2), and an AI-path socket test now guards the ordering |
| Six flags, one feature | ops confusion | one lobby toggle; flags are kill switches only |
| Moon fights invisible on phones | Phase 3 | HUD banner + inset badge specified as part of the phase, not a follow-up |

---

## 12. What this document does not decide

- Exact He-3 iconography, strike animation for a Moon-sourced beam, and the sound of a drop. Product/art.
- Whether Hegemony should be available in **Galactic Age** on Sol III. The mechanics port; the question is whether the Galactic Age wants a second decisive route. Left to the Galactic Age review.
- Whether `special_resource` should be renamed `gold` while a second resource is being added. Tempting; out of scope.

---

## 13. Measurement summary

Every gate above compares against the **Phase 0 shipped-ruleset control** (§2.2), 60 games, fixed seed, `SIM_PLAYERS=4 SIM_DIFFICULTY=medium`, each phase run both with and without `SIM_FACTIONS=1`. A phase does not promote to ON without its gate numbers in the PR. If a gate fails, the tunables in §9 move first; the mechanic is cut only if two tuning passes fail.
