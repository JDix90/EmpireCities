# Galactic Age — Buildings, Garrisons and Lane Powers: Design Package

**Status: proposed. Nothing in it is implemented.** It specifies a phased, flag-gated package that makes the Galactic Age's buildings read as the era's own, ties them to its tech tree, and gives production points somewhere to go. It is written against the systems that exist today, with file references, so each phase is an engineering task rather than an idea. Decisions already taken are marked **decided**; the rest are proposals for the sim to settle.

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

---

## 6. Phase 4 — Lane powers (**decided: per turn, PP-priced**)

Each power is a `TERRITORY_ABILITY_DEFS` entry with two new descriptor fields, validated in `executeTechAbility` beside `techCost` and `helium3Cost`: `productionCost` (PP charged after the effect succeeds, as He-3 is) and `requiresBuilding` (a building category that must stand on the source tile, checked at use time). The galaxy tree gains `unlocks_ability` on four nodes. Opening prices are knobs.

| Power | Unlocked by | Standing on the source | PP | Effect |
|---|---|---|---|---|
| Lance Battery | Disruption Net | a defence building on a gateway | 5 | Removes 2 units from the enemy gateway across that lane, to a floor of 1, before you cross (`unitReduction`, lane-adjacent targets only) |
| Orbital Muster | Battle Fabricators | an industry building | 6 | Places 3 units on that tile (`ownPlacement`), once a turn |
| Surge Projector | Gate Engineering | Jump Gates on both worlds | 10 | Opens a one-crossing lane across a ring gap between those two gates, this attack phase only |
| Seal Breaker | Gravity Brake Doctrine | a defence building on a gateway | 4 | Your next crossing from here ignores a Nebula Closure or an Emergency Seal (`selfBuff: 'ignore_lane_seal'`, the Mandate's kit at a price) |
| Harden / Forward | Lattice Logistics | any building | 6 | Phase 3, listed here because it is bought the same way |

Rules all five share: once per turn each (`scope: 'turn'`); a captured source tile takes the power with it (Phase 2) and the captor may use it next turn; Lane Sovereignty, the Vault and lane weather are unchanged by any of them except where the table says. Orbital Muster is the one place PP becomes units; it is gated by a building on purpose so it is a position, and its price is the first thing the sim should move if the Forge's share climbs.

**Surge Projector is the power to distrust.** Attack-carrying gate lanes paid the leader by 13 points (§0.3). A single crossing at a price is a much smaller thing than a permanent lane, but it needs its own sim arm before anyone believes it, and it ships last within the phase.

AI: an `aiLanePowers.ts` beside `aiMoonPowers.ts`, choosing targets and leaving validation to `executeTechAbility`. Fire Lance Battery before a planned crossing when the far gateway holds more units than the lane cap can reasonably beat; Orbital Muster on the gateway facing the most enemy units; Seal Breaker only when a seal is actually on the lane; Surge Projector only when the gap world holds a weakly held gateway. The tech budget rule (`aiTechBudget.ts`) already reserves TP; add a PP reserve for the power the bot means to fire.

---

## 7. Phase 5 — World buildings and the toll

One building per world rule, so each world's rule has a decision attached, and one economic building for corridors. Rust needs nothing new: the forge die and half-price builds are already its identity.

| Building | Where | PP | Effect |
|---|---|---|---|
| Habitat Dome | Sol III | 5 | This tile musters to 3 instead of 2 (`muster_threshold` +1 on the tile) |
| Storm Shelter | Verdan Reach | 5 | This tile's storm threshold is 18 instead of 12 (`storm_threshold` +6 on the tile), so a defended gateway on Verdan is possible |
| Vault Conduit | a Gate Ring tile on Nexus Station | 6 | +1 TP/turn while its owner holds the whole Vault |
| Toll Beacon | any gateway | 6 | +1 PP/turn while the lane it anchors is its owner's corridor |

Each is its own `BuildingType`, its own category (one per tile), unlocked by the tree's tier-1 economic root. All four are gateway or world-bound, so Phase 2 governs them on capture. The world rules read them through `getWorldRules` with a per-tile override, the one place each rule already reads its threshold.

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

- **2026-10-03:** Phase 1 shipped dark (#518): `BUILDING_DISPLAY_BY_ERA`, `GALAXY_AGE_TECH_TREE_V2`, `techNodeBuildingUnlocks`, behind `galaxy_buildings_v2_enabled`. Phase 2 shipped dark (#519): `state/orbitalBuildings.ts` behind `galaxy_orbital_buildings_enabled`, with `SIM_ORBITAL` and the PP-banked line in the galaxy sim. Its first measurement failed the §8 gate; the surviving-set split traced it to the inherited Jump Gate's lane, and the rule now cuts that lane on capture (`severJumpGateLinks`).
- **2026-10-02:** written after the Galactic Age tutorial track shipped (#507 to #514), from a read of the tree, the catalog, the economy tick, the capture rule, the AI's build order and the balance notes. Decided in review: gateway buildings survive capture; garrison doctrines are defence-only and attack-only, separate and exclusive; powers are per turn with a PP price.
