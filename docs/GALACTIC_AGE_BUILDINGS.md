# Galactic Age — Buildings, Garrisons and Lane Powers: Design Package

**Status: Phases 1 to 5 have shipped dark, each behind its own flag, and none is promoted; each phase's section records what shipped and how it measured.** It specifies a phased, flag-gated package that makes the Galactic Age's buildings read as the era's own, ties them to its tech tree, and gives production points somewhere to go. It is written against the systems that exist today, with file references, so each phase is an engineering task rather than an idea. Decisions already taken are marked **decided**; the rest are proposals for the sim to settle.

Companion reading: [GALACTIC_AGE_MODES.md](GALACTIC_AGE_MODES.md) (the boards), [space-age-moon/README.md](space-age-moon/README.md) (the precedent for position-gated, fuel-priced powers), `backend/scripts/GALAXY-BALANCE.md` (every number the era has been tuned on), `backend/src/game-engine/eras/galaxyage.ts`, `backend/src/game-engine/state/economyManager.ts`, `backend/src/game-engine/abilities/techAbilities.ts`.

---

## 0. Why

### 0.1 What the galaxy's buildings are today

The galaxy uses the game-wide catalog (`DEFAULT_BUILDING_COSTS`, `BUILDING_DISPLAY` in `packages/shared`) with one native addition. The tech tree (`GALAXY_AGE_TECH_TREE`) names five of them.

| Building id | Shown as | PP | Effect | Galaxy tech that unlocks it |
|---|---|---|---|---|
| `production_1` | Workshop (I) | 3 | +1 PP/turn | Battle Fabricators (tier 2, 11 TP) |
| `production_2..4` | Foundry, Manufactory, Industrial Complex | 6, 10, 15 | +2, +4, +7 PP/turn | **none** (free once the Workshop stands) |
| `defense_1` | Palisade (I) | 3 | +1 defence die | Disruption Net (tier 2, 10 TP) |
| `defense_2..3` | Fortress, Citadel | 6, 10 | +2, +3 defence dice | **none** (free once the Palisade stands) |
| `tech_gen_1` | Laboratory (I) | 4 | +2 TP/turn | Solar Foundries (tier 3, 16 TP) |
| `tech_gen_2` | Research Center (II) | 8 | +4 TP/turn | Dyson Slice (tier 4, 24 TP) |
| `jump_gate` | Jump Gate | 12 | A private lane between two of your worlds; moves units, carries no attack | Gate Engineering (tier 2, 10 TP) |
| `wonder_hyperlane_anchor` | Hyperlane Anchor | 22 | Your lane crossings roll full dice | no tech; any player may raise their era's wonder |

The tree also grants flat tech income on its own nodes (+2, +4, +7 TP/turn on Battle Fabricators, Solar Foundries and Dyson Slice), and the Vault pays its holder +2 TP/turn.

### 0.2 What is wrong

1. **The gating is inverted.** `isBuildingTechUnlocked` (`eraAdvancement/buildingHeritage.ts`) treats a building no node names as freely buildable. The galaxy tree names only the tier-I buildings, and names them at tier 2 or deeper, so the first tier of a family costs a mid-tree tech and every tier above it is free. The classic eras gate all three defence tiers; the galaxy gates one.
2. **The opening economy has nothing to buy.** A 16-system home world earns about 9 PP a turn from turn one (`collectProduction`: 1 PP per 3 systems plus the world's `production_bonus`), and the first building unlock is three to five turns of research away. The Hyperlane Anchor has no tech gate, so the rational opening is to bank for the wonder.
3. **Space to Stars arrives with a different rulebook.** The Space Age gates the Workshop and the Palisade at tier 1 for 4 TP each, and heritage (`legacy_building_unlocks`) carries those rights into the galaxy. A native galaxy start pays 10 to 11 TP at tier 2 for the same two buildings.
4. **The names are from the wrong millennium.** Workshop, Foundry, Palisade, Citadel, Laboratory on a board of gateways and hyperspace lanes. `BUILDING_DISPLAY` is era-agnostic.
5. **Buildings ignore every system the era is about.** Lanes, corridors, seals, lane weather, the Vault, colonies, the world rules: none reads a building, except the Rust forge die (`worldDefenseBuildingBonusDice`) and Rust's half-price builds.
6. **Capture razes everything but wonders** (`onTerritoryCapture`). Gateways change hands about 70 times a game (GALAXY-BALANCE §2), so the tiles the era fights over are the worst tiles to build on.
7. **The galaxy tree unlocks no ability.** Every other tree has `unlocks_ability` nodes feeding `TERRITORY_ABILITY_DEFS`; the galaxy's actives are the four kit abilities, and the Pathfinder Gate signature that only a Space to Stars arrival ever holds.

### 0.3 What the sims already told us

- GALAXY-BALANCE §4: the economic levers are inert. Rust's production bonus and Forge's gate price "left every faction within 0.1 of live"; a production-to-attack die for the Forge "moved Forge 12.5% → 12.5%"; the Forge's "cheap buildings and half-price gates were already the most-built of the four and did not convert. A production kit needs units, not more buildings."
- GALAXY-BALANCE §4: Jump Gate lanes that carried attacks paid the leader (turn-10 leader 55% → 68%) and were cut to logistics only. Mobility bought with production is the lever most likely to break the era, and the one that most needs the sim.
- space-age-moon §3.8: tech points injected as a reward moved nothing, "because tech points are not what a Space Age player is short of". What moved the Moon was powers gated on ground, checked at use time, and paid in a resource players run out of. In the galaxy that resource already exists and already piles up unspent: PP.

### 0.4 Design principles

1. **Never add dice on a lane.** The 2-die crossing (3 with Lane Charts, lifted by the Anchor) is the era's identity. Anything that strengthens a crossing changes the dice's faces or the defender's count, not the attacker's count.
2. **Powers are positional.** A power needs something standing on the board, checked at use time, so it travels with the ground. The Moon's "a position, not a credential" rule.
3. **PP is the fuel; TP stays research.** A tech unlocks a power once. Each use costs PP.
4. **Every building answers a system the primer already teaches**: lanes, gateways, corridors, seals, weather, the world rules, the Vault.
5. **The AI must be able to play it.** Each phase ships with its AI rule and is measured on bot usage, as the Moon package was.
6. **One knob per PR, dark-launched.** Every phase is a flag in `FLAG_CODE_DEFAULTS`, baked into `GameSettings` at create (the `galaxy_corridors_enabled` pattern) so a flip never re-rules a match in progress, with its kill switch in Admin → Config once promoted. The tutorial track's cards are updated in the same PR as the rule they describe.

---

## 1. Package overview

| Phase | Name | Delivers | Flag | New engine surface |
|---|---|---|---|---|
| 0 | Measure first | Building, PP and Anchor metrics in the galaxy sim; the shipped ruleset recorded as the control | — | harness only |
| 1 | Names and gating | Era-specific building names; every tier gated by the tree like the other eras; Space to Stars parity | `galaxy_buildings_v2_enabled` | a per-era display layer; a v2 gating table |
| 2 | Orbital infrastructure | Buildings on gateways survive capture and change owner (**decided**) | `galaxy_orbital_buildings_enabled` | `TerritoryState.gateway`, a capture-rule branch |
| 3 | Garrison doctrines | Hardened (defence) and Forward (attack) garrisons rolling d8, one per tile, bought with PP (**decided: defence and attack are separate and exclusive**) | `galaxy_garrisons_enabled` | `TerritoryState.garrison_doctrine`, die faces in the resolver |
| 4 | Lane powers | Five per-turn powers, each needing a tech and a building, each priced in PP (**decided: per turn with a price, never once per game**) | `galaxy_powers_enabled` | `productionCost` / `requiresBuilding` on the ability descriptor; `unlocks_ability` on the galaxy tree |
| 5 | World buildings | One building per world rule, and a gateway toll | `galaxy_world_buildings_enabled` | four building ids |

Phases 1 and 2 change no balance on their own and can ship first. Phases 3 to 5 each carry a sim gate (§8) before promotion.

---

## 2. Phase 0 — Measure first

`backend/scripts/simGalaxyBalance.ts` already reports Jump Gates per seat. Add, per seat and per game: buildings built by family and tier, PP banked at game end, the turn the first building went up, whether the Anchor was raised and by which seat, and (once Phase 4 exists) uses of each power. Print them unconditionally so a control run reports them too. Record the shipped numbers in GALAXY-BALANCE as the control every later phase is compared against: the four-faction band (18 to 32%), decisiveness, average length, and the turn-10 leader's win share.

---

## 3. Phase 1 — Names and gating

### 3.1 Names

A per-era display layer in `packages/shared`: `BUILDING_DISPLAY_BY_ERA['galaxy_age']` overriding `BUILDING_DISPLAY` entries, read by `buildingDisplayName(id, withTier, eraId)` with the game-wide names as the fallback. The client passes the viewer's era (the same `playerTechEra` the HUD header shows). The Space Age gets its own layer later by the same route.

| Id | Galaxy name | Note |
|---|---|---|
| `production_1..4` | Fabricator, Orbital Foundry, Shipyard Ring, Dyson Collector | effects unchanged |
| `defense_1..3` | Shield Array, Bastion, Gateway Citadel | effects unchanged |
| `tech_gen_1..2` | Observatory, Lattice Array | effects unchanged |
| `jump_gate` | Jump Gate | unchanged |
| `wonder_hyperlane_anchor` | Hyperlane Anchor | unchanged |

Effect strings stay the shared ones (they are numbers, not flavour). The Codex, the Bonuses modal, the building panel and the combat report all read `buildingDisplayName`, so one layer covers every surface.

### 3.2 Gating

A v2 table consulted by `currentEraTechForBuilding` when the game's settings carry `galaxy_buildings_v2`. Tier I at tier-1 techs, so a player can build on turn two; each later tier behind the matching tier of the tree. The tree's node costs do not change.

| Tree node (tier, TP) | Unlocks today | Unlocks in v2 |
|---|---|---|
| Lattice Logistics (1, 4) | — | Fabricator, Observatory |
| Lane Charts (1, 5) | — | Shield Array |
| Disruption Net (2, 10) | Palisade | Bastion |
| Battle Fabricators (2, 11) | Workshop | Orbital Foundry |
| Gate Engineering (2, 10) | Jump Gate | Jump Gate |
| Solar Foundries (3, 16) | Laboratory | Shipyard Ring, Lattice Array |
| Gravity Brake Doctrine (3, 15) | — | Gateway Citadel |
| Dyson Slice (4, 24) | Research Center | Dyson Collector |

This closes the opening dead zone (a Fabricator is 4 TP and 3 PP away on turn two) and matches the Space Age's tier-1 placement of the first industry and defence buildings, so a Space to Stars arrival and a native start play the same rules. Heritage is unchanged: rights earned in the Space Age stay earned.

---

## 4. Phase 2 — Orbital infrastructure (**decided**)

Buildings on a **gateway** survive capture and pass to the captor, as a captured Jump Gate end already does (`jumpGates.ts`: "an enemy who captures a gate tile inherits that end"). Interior tiles keep today's rule. Wonders keep theirs.

Implementation: mirror gateway membership onto state at init, `TerritoryState.gateway?: boolean`, the way `world_id` and `region_id` are mirrored (`initializeGameState`, from `orbitGatewayTerritoryIds(map)`), because `onTerritoryCapture` has state and no map. In the capture hook, when the setting is on and the tile is a gateway: keep `buildings`, keep `building_eras`, clear the garrison doctrine (Phase 3), raze fleets as today. Colony-mode and surge lanes do not make a tile a gateway; only the eight authored lanes do, which is the set Lane Sovereignty counts.

Why this is the first balance-bearing change: it makes the tiles the era fights over worth developing, and it is what lets Phase 4 anchor powers to buildings without making them a credential you keep once earned.

**Shipped (dark):** `state/orbitalBuildings.ts` behind `galaxy_orbital_buildings_enabled`, baked as `settings.galaxy_orbital_buildings` for every galaxy-rules theater, Space to Stars included (its gateways are stamped when their world arrives). The stamp is written only in a game that plays the rule, so every other game's state is byte-for-byte what it was. The hard and expert AI develop their gateways first under the rule and are unchanged without it. The sim takes `SIM_ORBITAL=1` and reports PP banked at game end and buildings inherited; the build panel names the rule on a gateway. The primer's gateway card and the player guide's capture lines are updated at promotion, with the flag, because a tutorial game bakes the live flags and a card must not describe a rule its game is not playing.

**Measured (4 seats, 1,000 games, seed `borderfall-galaxy-balance`, expert), against the control run without it:**

| | control | as decided | AI gateway-first off | economic buildings only |
|---|---|---|---|---|
| avg length (turns) | 30.3 | 34.0 | 33.9 | 35.5 |
| decisive | 98.9% | 92.7% | 92.6% | 91.1% |
| turn-10 leader win share | 59.5% | 58.8% | 59.3% | 60.6% |
| factions (Sol / Rust / Verdan / Nexus) | 24.8 / 25.6 / 26.6 / 23.0 | 23.3 / 25.7 / 29.8 / 21.2 | 23.1 / 25.9 / 29.6 / 21.4 | 22.7 / 25.7 / 30.2 / 21.4 |
| lane end-owner changes per game | 72.6 | 79.0 | 78.9 | 88.3 |
| PP banked at game end, per seat | 222.6 | 338.3 | 335.8 | 336.5 |
| buildings inherited per seat per game | — | 17.6 | 15.6 | 10.0 |

The bands hold and the snowball does not rise, but as first shipped **the §8 gate was not met**: games ran 3.7 turns longer, decisiveness fell six points (Lane Sovereignty locked less often), and PP banked rose instead of falling. The AI's build order was not the cause (third column), and razing defence works with the garrison did not help (fourth column: longer still, more churn).

**Found (2026-10-03):** the driver is the inherited **Jump Gate's lane**, not the AI's attack scoring (which has no term for a developed tile; buildings reach it only as defence dice in the capture odds) and not the economic buildings. Varying which buildings survive a gateway capture, same seed and seat count:

| surviving set | length | decisive | lane end-owner changes | PP banked |
|---|---|---|---|---|
| nothing (control) | 30.3 | 99.0% | 72.5 | 222 |
| all | 33.9 | 92.8% | 78.9 | 337 |
| all but tech buildings | 34.0 | 92.7% | 78.9 | 339 |
| all but production | 33.9 | 92.6% | 78.6 | 316 |
| all but defences | 35.5 | 91.1% | 88.2 | 337 |
| defences only | 30.6 | 98.1% | 69.1 | 229 |
| Jump Gate only | 35.4 | 91.3% | 88.5 | 319 |
| all but the Jump Gate | 30.6 | 98.1% | 69.2 | 238 |
| all, gate kept but its lane cut on capture | 29.2 | 99.7% | 65.8 | 220 |

Production and tech buildings are neutral (techs researched per seat is 8.3 against 8.4 in every run). Surviving defences settle the ring. The Jump Gate alone reproduces the whole damage, and cutting its lane while leaving the building removes it: a lane between two owners is one nobody can cross (a fortify needs both ends, an attack is refused — 0.1 gate-lane fortifies per seat per game in every run) but it stays in the map's adjacency, so each bot reads the stack at the far end as a threat on the gateway for the rest of the game.

**Decided:** every building on a captured gateway passes to the captor; a Jump Gate passes as a building and loses its lane (`severJumpGateLinks`), to be paired afresh with the captor's next gate. The socket and the sim re-project gate lanes after every capture, which also retires a stale razed-gate lane that used to linger in a live room until the next build (the control below is measured with that fix, which is why it differs slightly from the first table).

**Measured, final rule (1,000 games per cell, seed `borderfall-galaxy-balance`, expert):**

| seats | | length | decisive | turn-10 leader | lane end-owner changes | PP banked | factions |
|---|---|---|---|---|---|---|---|
| 4 | control | 29.6 | 99.2% | 60.6% | 70.9 | 212 | 25.4 / 24.5 / 27.2 / 22.9 |
| 4 | **rule** | 29.2 | 99.7% | 59.8% | 65.8 | 219 | 23.1 / 26.7 / 28.2 / 22.0 |
| 2 | control | 29.0 | 98.5% | 68.6% | 21.9 | 472 | 64.3 / 26.6 / 64.8 / 44.3 |
| 2 | **rule** | 28.9 | 99.1% | 69.1% | 21.0 | 485 | 65.9 / 25.2 / 66.0 / 42.9 |
| 8 | control | 42.9 | 96.9% | 38.3% | 172.0 | 132 | 13.0 / 12.1 / 10.7 / 14.2 |
| 8 | **rule** | 41.2 | 98.5% | 39.9% | 159.9 | 132 | 13.2 / 12.9 / 10.1 / 13.8 |

Factions are Sol / Rust / Verdan / Nexus. Every §8 line holds at every seat count — bands inside 18 to 32% at four seats, the Colonies and Schism bands where GALAXY-BALANCE §7 and §8 put them (the Syndicate's low two-seat number is the control's too), games shorter, more decisive, the snowball flat, the ring settling — except **PP banked**, which is flat to slightly up (+7 per seat at four), as it must be while the phase adds income and nothing to spend it on. That line is Phases 3 and 4's to move; promotion of this phase is not held on it.

---

## 5. Phase 3 — Garrison doctrines (**decided: two, exclusive**)

A doctrine is a property of a tile's garrison, not of its units, so nothing has to track which units are elite through fortifies, splits and losses.

| Doctrine | Applies to | Dice |
|---|---|---|
| **Hardened** | the stack defending this tile | the defender's dice are d8 |
| **Forward** | attacks launched from this tile | the attacker's dice are d8 |

- One doctrine per tile; buying the other replaces it, no refund. Bought in the draft or fortify phase with PP, opening price 6 (a knob), requiring any building on the tile and Lattice Logistics researched, so the tree's economic root has an early payoff.
- Dice **counts** are untouched: a Forward crossing still rolls 2 dice. Each d8 wins its matchup against a d6 about 56% of the time instead of 42%; the sim sets the price from there.
- Capture clears the doctrine (the garrison that held it is gone), on gateways and interior alike. Fortifying units out does not carry it.
- Engine: `TerritoryState.garrison_doctrine?: 'hardened' | 'forward'`; `rollDice` in `combatResolver.ts` takes a per-side face count; `computeLandCombatModifiers` returns `attackerDieFaces` / `defenderDieFaces` beside the dice overrides, so humans and bots resolve identically. Blitz (`executeBlitzAttack`) inherits it. The Ancient legion reroll and the ACW tie reroll keep working on whatever faces are rolled.
- UI: the combat report colours d8 dice differently and names the doctrine in the bonus breakdown; the building panel offers the two as a toggle on tiles that qualify; the Bonuses modal lists doctrines held. The tutorial primer's world card gains a sentence.
- AI (hard and expert): Hardened on a gateway whose far gateway is enemy-held; Forward on the gateway it plans to cross from this turn, bought in the draft phase before the attack. Medium buys Hardened only.

**Shipped (dark):** `state/garrisonDoctrines.ts` behind `galaxy_garrisons_enabled`, baked as `settings.galaxy_garrisons` for every galaxy-rules theater. The shared package holds the names, price, tech and faces (`GARRISON_DOCTRINE_*`) so the server and the panels agree. `resolveCombat` takes per-side faces; with both at six it consumes the d6 stream exactly as before, and a d8 drawn from a d6 roller (the seeded sim, a test, a puzzle queue) is built from two d6s by rejection, so it stays uniform and reproducible. `computeLandCombatModifiers` returns `attackerDieFaces` / `defenderDieFaces`; the executor passes them on and names the doctrine in the result; blitzes and drop assaults inherit both. The AI's capture odds (`combatOdds.ts`) enumerate any face count, so bots price a Hardened target and a Forward source. A doctrine applies only while its tile is held (a stack that went neutral keeps none), is masked under fog like the buildings, and is cleared by every capture. The socket takes `game:set_garrison_doctrine` through the same validator the bots and the sim use; bots buy after the turn's plan and before its attacks, at most two a turn (one for medium), against a running PP budget. The battle report marks d8s and names the doctrine; the building panel offers the toggle and names what blocks it; the Bonuses modal lists the garrisons held. The primer's sentence waits for promotion, as Phase 2's cards do, because a tutorial game bakes the live flags.

**Measured (1,000 games per cell, seed `borderfall-galaxy-balance`, expert, 6 PP), against the control:**

| seats | | length | decisive | turn-10 leader | lane end-owner changes | PP banked | factions (Sol / Rust / Verdan / Nexus) |
|---|---|---|---|---|---|---|---|
| 4 | control | 29.5 | 99.2% | 60.6% | 70.8 | 212 | 25.3 / 24.5 / 27.3 / 22.9 |
| 4 | **doctrines** | 30.2 | 99.1% | 58.3% | 74.2 | 185 | 24.6 / 25.0 / 27.7 / 22.7 |
| 2 | control | 29.0 | 98.5% | 68.6% | 21.9 | 472 | 64.3 / 26.6 / 64.8 / 44.3 |
| 2 | **doctrines** | 28.0 | 99.2% | 68.6% | 20.9 | 405 | 65.3 / 25.8 / 64.2 / 44.7 |
| 8 | control | 42.9 | 96.9% | 38.3% | 172.0 | 132 | 13.0 / 12.1 / 10.7 / 14.2 |
| 8 | **doctrines** | 43.0 | 97.0% | 38.0% | 173.4 | 109 | 13.3 / 12.1 / 10.3 / 14.3 |

| seats | bought per seat per game (H / F) | used in games where a seat could (H / F) | win share of seats that bought (H / F) | d8 exchanges per seat per game (attacking / defending) |
|---|---|---|---|---|
| 4 | 2.6 / 2.6 | 89.8% / 92.9% | 27.3% / 30.4% | 9.7 / 4.0 |
| 2 | 3.0 / 2.8 | 77.7% / 84.5% | 50.6% / 58.6% | 8.0 / 5.2 |
| 8 | 1.8 / 1.9 | 95.5% / 98.0% | 22.2% / 22.6% | 6.9 / 2.5 |

Every §8 line holds at every seat count: the bands are where the control put them (the Schism houses too, Duskrim's low reading included), length moves less than a turn, decisiveness and the turn-10 leader do not move against it, both doctrines are bought in well over 60% of the games where a seat could, the seats that buy them win under 60% of their games, and **PP banked falls** — by 13% at four seats, 14% at two and 18% at eight, the first phase to move that line. Two readings to keep honest: every seat that lives long enough researches Lattice Logistics, so "could" is nearly everyone; and the users' win share is flattered by survival (a seat eliminated early never buys), which is why the two-seat Forward figure, 58.6%, is the one to watch if the price moves down.

---

## 6. Phase 4 — Lane powers (**decided: per turn, PP-priced**)

Each power is a `TERRITORY_ABILITY_DEFS` entry with two new descriptor fields, validated in `executeTechAbility` beside `techCost` and `helium3Cost`: `productionCost` (PP charged after the effect succeeds, as He-3 is) and `requiresBuilding` (a building category that must stand on the source tile, checked at use time). The galaxy tree gains `unlocks_ability` on four nodes. Opening prices are knobs.

| Power | Unlocked by | Standing on the source | PP | Effect |
|---|---|---|---|---|
| Lance Battery | Disruption Net | a defence building on a gateway | 5 | Removes 2 units from the enemy gateway across that lane, to a floor of 1, before you cross (`unitReduction`, lane-adjacent targets only) |
| Orbital Muster | Battle Fabricators | an industry building on a gateway | 6 | Places 3 units on that tile (`ownPlacement`), once a turn. Gateways only since its first measurement — see below |
| Surge Projector | Gate Engineering | Jump Gates on both worlds of a ring gap, and your gateway at one end of it | 10 | Opens the gap to the rival gateway at the other end for one crossing, this attack phase only; taking that gateway closes it |
| Seal Breaker | Gravity Brake Doctrine | a defence building on a gateway | 4 | Your next crossing from here ignores a Nebula Closure or an Emergency Seal (the Mandate's Blockade Runner at a price, but held by the gateway: `pending_seal_breaker_from`) |
| Harden / Forward | Lattice Logistics | any building | 6 | Phase 3, listed here because it is bought the same way |

Rules all five share: once per turn each (`scope: 'turn'`); a captured source tile takes the power with it (Phase 2) and the captor may use it next turn; Lane Sovereignty, the Vault and lane weather are unchanged by any of them except where the table says. Orbital Muster is the one place PP becomes units; it is gated by a building on purpose so it is a position, and its price is the first thing the sim should move if the Forge's share climbs.

**Surge Projector is the power to distrust.** Attack-carrying gate lanes paid the leader by 13 points (§0.3). A single crossing at a price is a much smaller thing than a permanent lane, but it needs its own sim arm before anyone believes it, and it ships last within the phase.

AI: an `aiLanePowers.ts` beside `aiMoonPowers.ts`, choosing targets and leaving validation to `executeTechAbility`. Fire Lance Battery before a planned crossing when the far gateway holds more units than the lane cap can reasonably beat; Orbital Muster on the gateway facing the most enemy units; Seal Breaker only when a seal is actually on the lane; Surge Projector only when the gap world holds a weakly held gateway. The tech budget rule (`aiTechBudget.ts`) already reserves TP; add a PP reserve for the power the bot means to fire.

**Shipped (dark, three of four):** `abilities/lanePowers.ts` behind `galaxy_powers_enabled`, baked as `settings.galaxy_powers` for every galaxy-rules theater. The tree opens the three powers only under the setting (`galaxyAgeTechTree({ powers })`, picked per game by `eraTechTreeOptions`, served by `/api/eras/galaxy_age/tech-tree?powers=1`), so a game without it has no node that unlocks one, and the engine refuses them on every path besides. Prices live in the shared package (`GALAXY_LANE_POWER_COSTS`) so the panel and the server agree; `LANE_POWER_TUNING` is the sim's knob. `executeTechAbility` checks the lane requirement after the Moon's gate, before anything mutates, and charges the PP only once the effect has succeeded, as it charges He-3. Lance Battery is fired on the rival's gateway from yours across an open lane (a sealed lane blocks it), Orbital Muster and Seal Breaker on your own gateway. Seal Breaker arms that gateway (`pending_seal_breaker_from`), and the next crossing from it, by attack, blitz or bot, spends the charge past an Emergency Seal or a Nebula Closure; a crossing over an open lane keeps it. The bots fire them from `ai/aiLanePowers.ts` in the order the section gives, and the doctrine budget now holds back the price of the dearest power a bot holds. The territory panel lists a power only on a tile where the server would take it and shows its price. Surge Projector followed in its own change with its own sim arm, below. The primer's cards wait for promotion, as Phases 2 and 3's do.

The sim gains `SIM_POWERS`, `SIM_POWER_COSTS`, `SIM_MUSTER_UNITS` and `SIM_MUSTER_GATEWAY`, and `SIM_SEALS`: the bots' Emergency Seal, which the harness had never placed, so every earlier galaxy number was measured with no seal on any lane. Seal Breaker has nothing to break without it, so both arms below run with it on, and the control here is not Phase 3's.

**Measured (1,000 games per cell on each of three seeds, `borderfall-galaxy-balance`, `galaxy-b` and `galaxy-c`, averaged; expert, seals on in both arms, the prices above):**

| seats | | length | decisive | turn-10 leader | lane end-owner changes | PP banked | factions (Sol / Rust / Verdan / Nexus) |
|---|---|---|---|---|---|---|---|
| 4 | control | 32.2 | 98.8% | 59.1% | 74.0 | 240 | 22.9 / 25.3 / 26.0 / 25.8 |
| 4 | **powers** | 32.0 | 98.6% | 58.0% | 75.8 | 184 | 22.2 / 24.7 / 27.1 / 26.0 |
| 2 | control | 31.4 | 97.7% | 65.9% | 23.4 | 563 | 59.0 / 23.4 / 64.1 / 53.5 |
| 2 | **powers** | 30.1 | 98.0% | 62.2% | 23.8 | 391 | 56.2 / 23.4 / 60.7 / 59.6 |
| 8 | control | 43.2 | 97.1% | 34.5% | 172.1 | 132 | 12.9 / 11.3 / 9.0 / 16.8 |
| 8 | **powers** | 43.5 | 96.7% | 33.5% | 175.4 | 113 | 13.0 / 10.7 / 9.5 / 16.8 |

| seats | fired per seat per game (Lance / Muster / Breaker) | used where a seat could (L / M / B†) | win share of seats that fired it (L / M / B) |
|---|---|---|---|
| 4 | 3.1 / 6.3 / 0.2 | 87.8% / 90.7% / 95.1% | 30.3% / 33.1% / 63.2% |
| 2 | 3.8 / 14.4 / 0.3 | 63.9% / 93.3% / 94.1% | 52.1% / 58.3% / 70.3% |
| 8 | 1.8 / 1.8 / 0.1 | 95.2% / 78.5% / 95.1% | 24.8% / 31.9% / 56.4% |

† Seal Breaker is eligible when it has something to break: an attack phase with the power unlocked and a seal or closure on a lane from a defended gateway the seat holds to a rival (the sim's "where a seal stood" line). Counted from unlocking, as the other two are, it reads 43.9% / 32.4% / 37.7%, because only about a fifth of the seats that unlock it ever meet a seal.

**Why Orbital Muster fires from gateways only.** As first drafted it fired from any industry tile, and the bots fired it 9.8 times per seat per four-seat game, three free defenders almost every turn. On the first seed four-seat decisiveness fell from 99.0% to 97.9% and eight-seat from 97.3% to 95.3%. Pricing each power out of reach in turn put the fall on Muster (Muster off: 99.3% at four seats, 96.8% at eight). On that seed 9 PP, 12 PP, 2 units and gateways only each recovered most of the four-seat point (98.4 to 98.6%). Price is the wrong lever, though: at 12 PP the bots still banked 130 PP and fired it 8.5 times instead of 9.8. Gateways only cuts it to 6.2, keeps game length at the control's, and makes the muster a position on a lane, as the section always meant. Across three seeds it leaves four-seat decisiveness 0.1 points under the control. `SIM_MUSTER_GATEWAY=0` measures the old shape.

Reading the gate line by line:

- **Bands** hold at four seats (22 to 27%), and the eight-seat table is the control's.
- **Decisiveness** is flat at four seats (−0.1), up at two (+0.3) and down half a point at eight, on every seed, which is about one standard error. The eight-seat dip is the same with Muster priced out, so it belongs to Lance Battery and Seal Breaker together or to noise. It is the line to re-measure before promotion.
- **Length** moves −0.2, −1.3 and +0.3 turns, and the **turn-10 leader** falls at every seat count.
- **Usage**: Lance Battery and Orbital Muster pass everywhere. Seal Breaker passes when its eligibility is a seat that met a seal, and fails if it is counted from unlocking.
- **Win share**: Lance Battery and Orbital Muster stay under 60% everywhere. **Seal Breaker fails as written**: its users win 63.2% at four seats and 70.3% at two. Every seat that met a seal, fired or not, wins 59.7% and 67.9%, and the power fires 0.1 to 0.3 times per seat per game. The seats that met a seal and held win 13% and 31%, because the bot holds only when it cannot win the crossing. That is who reaches a late node with a defended gateway facing a rival's seal, not what the power does. Judging it against seats that met a seal, rather than a flat 60%, is a change to the gate and a call for promotion, not for this measurement.
- **PP banked falls** by 23% at four seats, 30% at two and 14% at eight.

One line outside the gates: at two seats Nexus rises from 53.5% to 59.6% on every seed, and Sol and Verdan fall about three points each, so the spread among the three leading factions narrows from about ten points to under five while the Syndicate stays where the control has it. Muster drives that move too (Muster priced out: Nexus 55.4%).

**Surge Projector shipped (dark), with its own arm.** The lane is state (`state/surgeProjector.ts`, `surge_projector_lane`), projected onto the map copy as a `source: 'surge_projector'` orbit connection the way a Lane Surge is, so the attack path, the lane dice cap and the chart need nothing new. "Between those two gates" became the gap's own lane: the authored ring leaves two gaps (Sol to the Rust Belt, Verdan to Nexus Station), each bridged where a Lane Surge or a Colonies lane would land, between the first gateways of the two worlds (`ringGapLanes`). The power is fired on the rival's gateway at one end, from the player's at the other, and needs the player's Jump Gates on both worlds; a gap something already bridges refuses it. The lane is live only during its owner's attack phase and only until the far gateway falls, because that capture is the one crossing. The socket re-syncs it after the power fires, after every capture, as the attack phase ends and after every turn advance, and `advanceToNextPlayer` clears it, so it can carry neither a fortify nor another seat's attack. No other power reaches across it. Bots open a gap only where their stack beats the far gateway by two after leaving one behind, and plan that crossing first.

Measured as its own arm: all four powers against the three of Phase 4A, 1,000 games per cell on the same three seeds, averaged.

| seats | | length | decisive | turn-10 leader | lane end-owner changes | PP banked | factions (Sol / Rust / Verdan / Nexus) |
|---|---|---|---|---|---|---|---|
| 4 | three powers | 32.0 | 98.6% | 58.0% | 75.8 | 184 | 22.2 / 24.7 / 27.1 / 26.0 |
| 4 | **four** | 32.3 | 98.6% | 57.8% | 81.1 | 178 | 22.6 / 25.0 / 26.2 / 26.1 |
| 2 | three powers | 30.1 | 98.0% | 62.2% | 23.8 | 391 | 56.2 / 23.4 / 60.7 / 59.6 |
| 2 | **four** | 30.6 | 98.0% | 62.9% | 32.1 | 364 | 48.6 / 34.1 / 56.5 / 60.8 |
| 8 | three powers | 43.5 | 96.7% | 33.5% | 175.4 | 113 | 13.0 / 10.7 / 9.5 / 16.8 |
| 8 | **four** | 43.7 | 96.3% | 33.3% | 179.7 | 110 | 13.0 / 10.6 / 9.5 / 17.2 |

| seats | fired per seat per game | seats that unlocked it and met an open gap | used where a gap stood open | far gateway taken | users win | seats that met one and held win |
|---|---|---|---|---|---|---|
| 4 | 0.8 | 33.6% | 79.7% | 93.1% | 70.3% | 61.5% |
| 2 | 1.9 | 47.8% | 62.7% | 96.3% | 65.1% | 62.2% |
| 8 | 0.4 | 22.7% | 76.8% | 95.0% | 71.4% | 63.4% |

- **The snowball the section feared does not appear.** The turn-10 leader does not move at any seat count, decisiveness is flat at four and two seats and 0.3 lower at eight (inside noise), and games run 0.2 to 0.5 turns longer. The lanes change hands more, which is what a bridge across a gap should do.
- **At two seats the Syndicate stops being the low faction**: from 23.4% to 34.1% on every seed, with Sol down to 48.6%. The two-seat spread narrows from about 37 points to about 27. The four-seat bands do not move.
- **Usage** passes when a seat is eligible because a gap stood open to it: 80%, 63% and 77% at four, two and eight seats. Counted from unlocking, two seats fail at 41%, since half the seats that research Gate Engineering never hold both worlds of a gap.
- **Win share fails as written**, as Seal Breaker's does: its users win 65% to 71%. The selection is visible again but weaker. Seats that met an open gap and held win 62% to 63%, so the power adds roughly 3 to 9 points over the seats it could have served. A bot opens a gap only into a weak gateway, and takes it 93% to 96% of the time. If a price moves before promotion it is this one.

A caveat on every number in this section: when it was measured, two runs of the same configuration on the same seed were not byte-identical. The control drifted only in PP banked, by about half a PP per seat, but with PP-spending powers on, individual games diverged. That is why each cell averages three seeds rather than trusting one, and why the arms compare averages. The harness has since been made deterministic (its engine draws are reseeded per game, `backend/scripts/seededEngineRandomness.ts`, and each run ends with a digest that proves it), so a re-measurement reproduces exactly; these numbers carry that run-to-run noise on top of seed noise.

---

## 7. Phase 5 — World buildings and the toll

One building per world rule, so each world's rule has a decision attached, and one economic building for corridors. Rust needs nothing new: the forge die and half-price builds are already its identity.

| Building | Where | PP | Effect |
|---|---|---|---|
| Habitat Dome | Sol III | 5 | This tile musters to 3 instead of 2 (`muster_threshold` +1 on the tile) |
| Storm Shelter | Verdan Reach | 5 | This tile's storm threshold is 18 instead of 12 (`storm_threshold` +6 on the tile), so a defended gateway on Verdan is possible |
| Vault Conduit | a Gate Ring tile on Nexus Station, one per Vault | 6 | +1 TP/turn while its owner holds the whole Vault. One per Vault since the combined measurement — see below |
| Toll Beacon | any gateway, one per lane | 6 | +1 PP/turn while the lane it anchors is its owner's corridor. One per lane since its first measurement — see below |

Each is its own `BuildingType`, its own category (one per tile), unlocked by the tree's tier-1 economic root. All four are gateway or world-bound, so Phase 2 governs them on capture. No Vault tile is a gateway, so a captured Conduit is always razed. The world rules read them through `getWorldRules` with a per-tile override, the one place each rule already reads its threshold.

**Shipped (dark):** `state/worldBuildings.ts` behind `galaxy_world_buildings_enabled`, baked as `settings.galaxy_world_buildings` for every galaxy-rules theater. Each is its own building id and one-per-tile slot; the shared package holds the four ids, prices and effects (`GALAXY_WORLD_BUILDING_*`), so the server, the build panel and the bots read one table. Lattice Logistics opens all four only under the setting (`galaxyAgeTechTree({ worldBuildings })`, `?world=1` on the tree route), appended to what it opens already. `validateBuild` refuses every one of them in a game without the setting, because adding a building id makes it known everywhere and an id no node names counts as free; with the setting it checks the placement before the price. The rules read the Dome and the Shelter in `applyCradleMuster` and `applyStormAttrition` through `tileMusterThreshold` and `tileStormThreshold`, which add nothing in any other game. The Conduit and the Beacon pay in `collectProduction`, flat like the Vault, each once for what it taxes: a Vault carries one Conduit and a lane one Beacon, and a second is refused. The Beacon's corridor is Lane Sovereignty's: both ends of an authored lane held by the owner or an ally. Because the build check and the production tick hold state and no map, each gateway is stamped with its lanes' far ends (`lane_partners`) when it enters play, at init and at a Space to Stars arrival, only in a game with the setting. A world building missing from an older economy snapshot, or from an admin cost override written before it existed, falls back to its own price; every other building's cost resolves as before. Capture follows Phase 2, as the section says.

The bots build them from `ai/aiWorldBuildings.ts`, after border defence and before the production chain, and only where each plainly pays: a Storm Shelter under a stack at the storm line, a Vault Conduit on the best-held Vault tile while holding the whole Vault and it carries none, a Toll Beacon on a gateway whose lane is already their corridor and carries no toll yet, and a Habitat Dome on a thin Cradle tile facing a rival, at most three. The build panel offers each only on a system where it can stand, and says so when the lane or the Vault already carries one (`frontend/src/utils/worldBuildings.ts`); the Bonuses modal lists them, and Admin → Config has the toggle. The primer's cards wait for promotion, as every earlier phase's do. The sim takes `SIM_WORLD_BUILDINGS=1` and reports, per building, how many each seat builds, how many stand at the end, and what the Beacons and Conduits paid.

**Measured, one Conduit a Vault (1,000 games per cell on each of three seeds, `borderfall-galaxy-balance`, `galaxy-b` and `galaxy-c`, averaged; expert, seals on in both arms, on the deterministic harness):**

| seats | | length | decisive | turn-10 leader | lane end-owner changes | PP banked | factions (Sol / Rust / Verdan / Nexus) |
|---|---|---|---|---|---|---|---|
| 4 | control | 32.2 | 98.8% | 59.1% | 74.0 | 240 | 22.9 / 25.3 / 26.0 / 25.8 |
| 4 | **world buildings** | 32.0 | 98.6% | 59.2% | 73.6 | 234 | 23.3 / 24.4 / 25.3 / 27.0 |
| 2 | control | 31.4 | 97.7% | 65.9% | 23.4 | 563 | 59.0 / 23.4 / 64.1 / 53.5 |
| 2 | **world buildings** | 31.4 | 97.1% | 65.4% | 23.2 | 570 | 57.3 / 25.3 / 62.5 / 55.0 |
| 8 | control | 43.2 | 97.1% | 34.6% | 172.0 | 132 | 12.8 / 11.4 / 9.0 / 16.8 |
| 8 | **world buildings** | 42.7 | 97.8% | 34.6% | 169.4 | 111 | 12.8 / 10.3 / 9.6 / 17.3 |

| seats | built per seat per game (Dome / Shelter / Conduit / Beacon) | seats that built one | standing per seat at the end | paid per seat per game |
|---|---|---|---|---|
| 4 | 1.4 / 1.1 / 0.2 / 2.2 | 40% / 42% / 17% / 93% | 0.2 / 0.4 / 0.1 / 0.7 | Beacons 22.9 PP, Conduits 2.8 TP |
| 2 | 0.6 / 1.7 / 0.3 / 3.4 | 23% / 64% / 25% / 100% | 0.2 / 1.4 / 0.2 / 2.6 | Beacons 66.7 PP, Conduits 5.8 TP |
| 8 | 2.5 / 1.3 / 0.1 / 2.1 | 53% / 40% / 12% / 84% | 0.2 / 0.3 / 0.0 / 0.2 | Beacons 10.5 PP, Conduits 1.1 TP |

**Why one Toll Beacon a lane.** As first drafted a beacon could stand at each end of a corridor and both paid, and the bots built one at each end. Beacons then paid 105 PP per seat per game at two seats, and PP banked rose there, from 563 to 571, against the gate. Pricing each building out of reach in turn (`SIM_WORLD_BUILDING_COSTS`) put that on the Beacon: without it, PP banked was 516. A corridor is one corridor, so a lane now carries one toll, at whichever end. That cut the two-seat pay to 65 PP.

**Why one Vault Conduit a Vault.** As first shipped a Conduit stood on every Vault tile and each paid, so a holder with all four tripled the Vault's 2 TP. At four seats that lifted Nexus 2.6 points, inside the band. At eight it lifted the Custodians out of GALAXY-BALANCE §8's house band, and the first write-up of this phase missed it: it checked the bands at four seats only and called every line passed at eight. Measured with orbital infrastructure, the edge grew; pricing the Conduit out of that pair returned Nexus and both Custodian houses to the control, and pricing out the Toll Beacon changed nothing. A Conduit now pays for the Vault, once, and a second is refused:

| eight seats | Nexus per seat | Ward Custodians | Berth Custodians | Hellas Syndicate | houses inside 7.5–17.5% |
|---|---|---|---|---|---|
| control | 16.8% | 15.7% | 17.9% | 9.5% | 6 of 8 |
| world buildings, as first shipped | 18.7% | 18.0% | 19.2% | 8.0% | 5 of 8 |
| world buildings, one Conduit a Vault | 17.3% | 16.8% | 17.8% | 8.1% | 6 of 8 |
| with orbital, as first shipped | 19.1% | 18.1% | 20.2% | 7.5% | 4 of 8 |
| with orbital, Conduit priced out | 16.1% | 15.2% | 17.0% | 8.5% | 6 of 8 |
| with orbital, Beacon priced out | 19.2% | 18.2% | 20.2% | 7.9% | 5 of 8 |
| with orbital, one Conduit a Vault | 17.7% | 17.5% | 17.9% | 7.8% | 6 of 8 |

The cap is not free. The Conduit's tech was also part of what pulled PP banked down at two seats: as first shipped the Conduits paid 18 TP per seat per game there, capped they pay 6, and the two-seat bank rises.

Reading the gate line by line, alone:

- **Bands** hold at four seats (23.3 to 27.0%). At eight, Nexus sits 0.5 points over the control, the house count inside the band is the control's, and the Ward Custodians and the Hellas Syndicate sit a point or so from the control, on opposite sides.
- **Decisiveness** moves −0.5 points at two seats, −0.1 at four and +0.7 at eight; the two-seat dip is about one standard error, as it was as first shipped.
- **Length** stays within a turn, and the **turn-10 leader** does not rise at any seat count.
- **PP banked falls** at four seats (−2.6%) and eight (−15.5%), and **rises at two (+1.2%, on two seeds of three)**: the line this phase does not pass alone.

### Measured with orbital infrastructure (Phases 2 and 5 together)

Most of what the bots build alone does not stand at the end: without orbital infrastructure a captured tile is razed, and these buildings want the contested tiles (a thin frontier, a gateway, a stack in the storms). Phase 2 is the rule that keeps them on gateways, so the two were measured together as well as apart, with the same seeds and harness. No Vault tile is a gateway, so a Conduit is razed on capture either way.

| seats | | length | decisive | turn-10 leader | PP banked | factions (Sol / Rust / Verdan / Nexus) |
|---|---|---|---|---|---|---|
| 2 | control | 31.4 | 97.7% | 65.9% | 563 | 59.0 / 23.4 / 64.1 / 53.5 |
| 2 | orbital | 31.2 | 97.6% | 66.8% | 582 | 59.1 / 24.0 / 64.2 / 52.7 |
| 2 | world buildings | 31.4 | 97.1% | 65.4% | 570 | 57.3 / 25.3 / 62.5 / 55.0 |
| 2 | **both** | 30.9 | 97.6% | 64.9% | 578 | 57.5 / 24.8 / 62.2 / 55.5 |
| 4 | control | 32.2 | 98.8% | 59.1% | 240 | 22.9 / 25.3 / 26.0 / 25.8 |
| 4 | orbital | 30.8 | 99.0% | 60.3% | 238 | 22.1 / 25.1 / 27.4 / 25.5 |
| 4 | world buildings | 32.0 | 98.6% | 59.2% | 234 | 23.3 / 24.4 / 25.3 / 27.0 |
| 4 | **both** | 30.8 | 99.1% | 60.6% | 245 | 23.5 / 23.9 / 25.6 / 27.0 |
| 8 | control | 43.2 | 97.1% | 34.6% | 132 | 12.8 / 11.4 / 9.0 / 16.8 |
| 8 | orbital | 42.1 | 98.2% | 34.9% | 135 | 12.9 / 11.0 / 9.7 / 16.5 |
| 8 | world buildings | 42.7 | 97.8% | 34.6% | 111 | 12.8 / 10.3 / 9.6 / 17.3 |
| 8 | **both** | 41.4 | 98.2% | 35.0% | 130 | 12.3 / 10.6 / 9.3 / 17.7 |

| per seat per game | 2 seats, world | 2 seats, both | 4 seats, world | 4 seats, both | 8 seats, world | 8 seats, both |
|---|---|---|---|---|---|---|
| Toll Beacons built | 3.4 | 3.3 | 2.2 | 1.8 | 2.1 | 1.0 |
| world buildings standing at the end | 4.4 | 5.5 | 1.4 | 3.3 | 0.7 | 2.1 |
| Toll Beacon pay | 67 PP | 69 PP | 23 PP | 33 PP | 11 PP | 20 PP |
| buildings inherited, all kinds | — | 12.2 | — | 21.1 | — | 20.9 |

Keeping them works as meant: more world buildings stand, the Beacons that stand pay for longer, and the bots rebuild fewer. That is also why the pair gives back most of the bank fall world buildings make alone at eight seats.

Reading the gate for the pair:

- **Length** falls at every seat count and **decisiveness** rises at four and eight, flat at two (−0.1).
- **Bands** hold at four seats (23.5 to 27.0%); at eight, as alone, six houses of eight sit inside the band, as in the control, with Nexus 0.9 points over the control and the Ward Custodians outside the band on two seeds of three.
- **The turn-10 leader** rises 1.4 points at four seats (one seed down, two up) and 0.4 at eight, about where orbital infrastructure alone puts it.
- **PP banked rises** at two seats (+2.7%, on every seed) and four (+1.8%, on two seeds of three), and falls at eight (−1.5%). At two seats the pair lands just under orbital infrastructure's own bank, a rise §4 left for Phases 3 and 4 to move; at four it sits above either rule alone.

As first shipped, the pair passed every line at two and four seats and failed the eight-seat house band; with one Conduit a Vault it holds that band and fails the bank at two and four seats, with the turn-10 leader up at four. **Neither Conduit rule passes every §8 line for the pair, and the choice between them is open.**

---

## 8. Measurement and gates

The galaxy sim (`SIM_PLAYERS`, `SIM_EVENTS`, `SIM_SCATTERED`, the Schism and team knobs) runs every phase at 2, 4 and 8 seats against the Phase 0 control, 1,000 games on three seeds as GALAXY-BALANCE does. Each phase promotes only if:

- the four factions stay inside **18 to 32%** at four seats, and the Colonies and Schism bands hold where GALAXY-BALANCE §7 and §8 put them;
- decisiveness does not fall and average length does not rise by more than two turns;
- the turn-10 leader's win share does not rise (the Jump Gate finding is the warning);
- for Phases 3 and 4, borrowing the Moon's usage gate: each doctrine and power is used in at least **60%** of games where a seat is eligible, by bots as well as humans, and the win share of seats that use it stays **below 60%**;
- PP banked at game end falls from the control, which is the whole point.

---

## 9. Out of scope, and noted for later

- **The Atom Bomb's once-per-game scope.** Multiple uses with a cost to the user, such as radiation that poisons the user's own territories, is worth designing, but it is a WW2 and Modern change and is deliberately not part of this package. Its only connection here is that Phase 4 establishes "per turn with a price" as the pattern, and `GAME_SCOPED_ABILITIES` is where the once-per-game rule lives.
- **Unit-level upgrades** (tracking elite units through moves). Phase 3's garrison doctrine is the deliberate substitute; revisit only if doctrines prove too coarse.
- **A new resource.** PP is the fuel. The Moon needed He-3 because TP was the wrong currency there; the galaxy already has the right one.

## History

- **2026-10-03:** Phase 1 shipped dark (#518): `BUILDING_DISPLAY_BY_ERA`, `GALAXY_AGE_TECH_TREE_V2`, `techNodeBuildingUnlocks`, behind `galaxy_buildings_v2_enabled`. Phase 2 shipped dark (#519): `state/orbitalBuildings.ts` behind `galaxy_orbital_buildings_enabled`, with `SIM_ORBITAL` and the PP-banked line in the galaxy sim. Its first measurement failed the §8 gate; the surviving-set split traced it to the inherited Jump Gate's lane, and the rule now cuts that lane on capture (`severJumpGateLinks`, #524). Phase 3 shipped dark (#527): `state/garrisonDoctrines.ts` behind `galaxy_garrisons_enabled`, with `SIM_GARRISONS` / `SIM_DOCTRINE_COST` and the usage lines in the galaxy sim; it passes every §8 line at 2, 4 and 8 seats. Phase 4's first three powers shipped dark: `abilities/lanePowers.ts` behind `galaxy_powers_enabled`, with `SIM_POWERS`, `SIM_SEALS` and the usage lines in the galaxy sim. Orbital Muster moved to gateways only after its first measurement cost a point of decisiveness, and Seal Breaker fails the win-share line as written (§6), #530. Surge Projector followed with its own arm: `state/surgeProjector.ts`, a ring-gap lane for one crossing in its owner's attack phase. It moves no snowball line and lifts the two-seat Syndicate from 23% to 34%, and it fails the win-share line as written. Phase 5 shipped dark: `state/worldBuildings.ts` behind `galaxy_world_buildings_enabled`, with `SIM_WORLD_BUILDINGS` and `SIM_WORLD_BUILDING_COSTS` in the galaxy sim; the Toll Beacon became one a lane after its first measurement raised PP banked at two seats. That write-up called every §8 line passed at 2, 4 and 8 seats, but it had checked the bands at four seats only: at eight, the Vault Conduit lifted the Custodians out of the house band. Measured with Phase 2, pricing the Conduit out traced the edge to it, and a Vault now carries one Conduit that pays once. That holds the eight-seat band and lets PP banked rise at two and four seats (§7); neither Conduit rule passes every line for Phases 2 and 5 together, and the choice between them is open.
- **2026-10-02:** written after the Galactic Age tutorial track shipped (#507 to #514), from a read of the tree, the catalog, the economy tick, the capture rule, the AI's build order and the balance notes. Decided in review: gateway buildings survive capture; garrison doctrines are defence-only and attack-only, separate and exclusive; powers are per turn with a PP price.
