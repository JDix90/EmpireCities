# World War II — The Manhattan Project: Design Package

**Status: Phases 0 to 3 shipped dark; every flag is OFF.** Measured: custom WW2 games are ready to promote with all three phases together; Full Game is not, for hard and expert bots (§5). This package makes the World War II era's showpiece weapon something players actually see: reachable before the game is decided, used by the bots, and repeatable at a price that bites the leader. It is written against the systems that exist today, with file references, so each phase is an engineering task rather than an idea. Decisions already taken are marked **decided**; the rest are proposals for the sim to settle.

Companion reading: [GALACTIC_AGE_BUILDINGS.md](GALACTIC_AGE_BUILDINGS.md) (the per-turn, priced power pattern and its measurements, §6, and the note in §9 this package picks up), [space-age-moon/README.md](space-age-moon/README.md) (position-gated, fuel-priced powers), `backend/scripts/eraBalanceTuning.md` (the era-advancement sim), `backend/src/game-engine/eras/ww2.ts`, `backend/src/game-engine/abilities/techAbilities.ts`, `backend/src/game-engine/abilities/executeTechAbility.ts`.

---

## 0. Why

### 0.1 What the bomb is today

The Atom Bomb is the WW2 tree's tier-4 node, Manhattan Project (`ww2_atom_bomb`, 20 TP), behind Panzer Tactics. Once per game (`GAME_SCOPED_ABILITIES`), in the attack phase, it turns one enemy territory neutral with 1 unit, razes its buildings and naval units, and zeroes its stability (`executeTechAbility.ts`). The next attack can walk in.

| Tier | Node | TP | Prerequisite | Gives |
|---|---|---|---|---|
| 1 | Motorization | 5 | — | +1 reinforcement |
| 1 | Bunker Network | 4 | — | Palisade |
| 1 | War Industry | 4 | — | Workshop |
| 1 | Radio Communications | 3 | — | +1 reinforcement |
| 2 | Tank Divisions | 9 | Motorization | +1 attack die |
| 2 | Maginot-Line Fortifications | 8 | Bunker Network | Fortress |
| 2 | Mass Munitions | 7 | War Industry | Laboratory, +2 TP/turn |
| 2 | Tactical Air Support | 8 | Radio | Air Strike |
| 3 | Panzer Tactics | 13 | Tank Divisions | +1 attack die, Double Blitz |
| 3 | Fortress Europe | 13 | Fortifications | Citadel |
| 3 | Radar Network | 11 | Mass Munitions | Research Center, +3 TP/turn |
| 4 | **Manhattan Project** | 20 | **Panzer Tactics** | **Atom Bomb** |

### 0.2 What is wrong

1. **It arrives after the game is decided.** The path is 47 TP down the tank line, whose nodes add no tech income. Base income is 1 TP per 5 territories held (`collectProduction`); on the 42-territory WW2 map that is about 2 TP a turn at four seats and about 1 at six. Rough arithmetic for a player who heads straight there, before Phase 0 measures it:

   | Turn the bomb arrives | Tank line, today |
   |---|---|
   | four seats, straight down the tank line | about 24 |
   | four seats, detouring through Mass Munitions and a Laboratory first | about 14 |
   | six seats, with the same detour | about 21 |

2. **Full Game never asks for it, and leaving the era wipes it.** The classic spine's gate out of WW2 is two tier-2 techs, one tier-3 tech and two buildings (`eraAdvancement/spines.ts`). Manhattan is not on it, and `executeAdvanceEra` clears `unlocked_techs`, so the rational player advances instead of spending 20 TP on a weapon. An undetonated bomb does carry forward as one legacy charge (`getCarryableLegacyAbility`).
3. **Bots never fire it.** No AI path selects `atom_bomb`; the comment above the Dyson Beam parity block in `gameSocket.ts` notes that tech-unlocked strikes "still sit idle in a bot's hands". The research scorer (`selectAiTechResearch`) values attack, defence, income and reinforcement numbers, so a node whose only payload is an ability scores below everything else and is bought last, if ever. In a game against bots the bomb never falls on anyone.
4. **Once per game is one moment.** Even when it arrives it is a single event, so there is no decision about when to spend it again or how to answer it.
5. **Its name is taken twice.** The WW2 wonder (`WW2_WONDER`, `wonder_manhattan`, +2 reinforcements a turn) is also called the Manhattan Project.

### 0.3 What the repo has already learned

- **The Moon** (space-age-moon §3.8): tech points injected as a reward moved nothing. What moved play was a power gated on something held, checked at use time, and paid in a resource players run short of.
- **The galaxy lane powers** (GALACTIC_AGE_BUILDINGS §6): "per turn with a price, never once per game" worked, but Seal Breaker and Surge Projector failed the win-share line because bots fire them only when the crossing is already likely to succeed. Repeatable powers drift toward the leader unless the price bites the leader.
- **The Jump Gate** (GALAXY-BALANCE §4): power bought with production paid the leader (turn-10 leader 55% → 68%) until it was cut.

### 0.4 Design principles

1. **Reach first, scope second.** A repeatable bomb changes nothing in a game that ends before tier 4.
2. **The bomb is priced in production and costs the user something beyond the price**, so a runaway leader cannot convert surplus into a chain of detonations.
3. **The bomb has a catch-up built in**: the first detonation makes it cheaper for everyone behind.
4. **The AI must be able to play it.** Each phase ships with its AI rule and is measured on bot usage.
5. **One knob per phase, dark-launched.** Every phase is a flag in `FLAG_CODE_DEFAULTS` (envOptIn, OFF), baked into `GameSettings` at create so a flip never re-rules a match in progress, with its toggle in Admin → Config.

### 0.5 Decisions

- **decided:** the package targets tech-on custom games **and** Full Game.
- **decided:** the bomb is for both denying ground and taking it.
- **decided:** the bomb becomes usable more than once per game, at a price.

---

## 1. Package overview

| Phase | Name | Delivers | Flag | Setting |
|---|---|---|---|---|
| 0 | Measure first | A WW2 economy harness: custom WW2 games and the Full Game climb, with research, building, faction abilities and the bomb; the shipped rules recorded as the control | — | harness only |
| 1 | The bots and the bomb | Hard and expert bots research toward Manhattan and fire the bomb as it stands today, then walk in | `ww2_bomb_ai_enabled` | `ww2_bomb_ai` |
| 2 | The science line | Manhattan Project's prerequisite moves from Panzer Tactics to Radar Network | `ww2_manhattan_science_enabled` | `ww2_manhattan_science` |
| 3 | The atomic arsenal | The bomb becomes per turn, priced in PP with an escalating price, leaves fallout, costs the bomber stability at home, and proliferates | `ww2_atomic_arsenal_enabled` | `ww2_atomic_arsenal` |

Each setting is baked at create for every game, because the WW2 tree is played both in a WW2 game and on the classic climb; the setting is read only where the WW2 tree is. Phase 1 is the bots learning the weapon that ships, so its measurement separates "bots cannot use it" from "the rule is wrong" before either rule changes.

---

## 2. Phase 0 — Measure first

There is no harness that plays a WW2 economy. `simFactionBalance.ts` neither researches nor builds, and `simEraBalance.ts` climbs from Ancient with factions off and reports nothing about the bomb. Phase 0 adds `backend/scripts/simWw2Balance.ts`, built from the two:

- **`SIM_MODE=custom`** (default): a WW2 game on `era_ww2` with economy and tech on, factions on (the six WW2 factions, one each, rotated per game), expert bots, a 90-turn cap. `SIM_PLAYERS` lowers the seat count; `SIM_FACTIONS=0` plays it without kits.
- **`SIM_MODE=full`**: the Full Game climb as the lobby creates it, minus naval, events and cards: Ancient start on `era_ancient`, the `standard` preset (classic spine), economy, tech and stability on, factions off, `era_advancement_max_lead: 2`, a 150-turn cap.
- Every turn mirrors `processAiTurn`'s pure-engine order: build, research, advance (full mode), draft with the faction's draft ability, the attack phase with the faction's strike or buff, then fortify. Phase 1's bomb runs through the same AI module the socket calls.
- Engine randomness is seeded per game (`seededEngineRandomness.ts`) and every run ends with a `Run digest`, so a re-run of one configuration on one seed is the same run, and two arms differ only by what changed.

It reports, beside the usual length, decisiveness, turn-10 leader and per-faction lines:

- **reach**: the share of games in which anyone researches Manhattan Project, the turn it first lands, and, in full mode, the share of seats that research it before leaving WW2;
- **use**: detonations per game, the share of Manhattan holders who fire, the turn of the first detonation, the win share of seats that fire, and how many detonations were followed by a capture of the tile;
- **Phase 3 lines**: PP spent on bombs, fallout attrition, proliferation discounts taken.

**Shipped:** `backend/scripts/simWw2Balance.ts`. Custom mode plays the Quick Match default ending, Conquest (domination or 65% of the board): the custom lobby's own default is domination with no turn cap, and six bots never resolve it inside 90 turns, so a harness on it would measure only the cap. Full mode plays Full Game's own defaults (`DEFAULT_FULL_GAME_PREFS`): four seats, medium bots, the full-board ending, a 150-turn cap. Naval, events and cards are off in both, as in the other harnesses.

**The control (1,000 games per cell on each of three seeds, `ww2-a`, `ww2-b` and `ww2-c`, averaged):**

| | Custom, 6 seats | Custom, 4 seats | Full Game, 4 seats |
|---|---|---|---|
| length | 48.7 | 30.4 | 108.0 |
| decisive | 89.8% | 96.4% | 61.0% |
| turn-10 leader | 47.3% | 61.4% | 30.8% |
| PP banked at game end, per seat | 219 | 155 | 1,105 |
| games where anyone researches Manhattan | 80.2% | 50.7% | 17.8% |
| ...first on turn | 30.0 | 25.0 | 43.6 |
| seats that research it | 60.9% | 34.5% | 5.4% |
| bombs fired | 0 | 0 | 0 |

| Faction win rate, custom | Germany | Soviet Union | USA | UK | Japan | China |
|---|---|---|---|---|---|---|
| 6 seats (fair share 16.7%) | 26.4% | 9.9% | 9.7% | 44.0% | 2.6% | 7.3% |
| 4 seats (fair share 25%) | 48.4% | 8.3% | 31.5% | 28.4% | 15.4% | 17.9% |

What the control says:

- **Bots reach the bomb and never use it.** Expert bots research Manhattan in four custom games out of five at six seats, around turn 30 of a 49-turn game, and fire it in none.
- **Full Game passes WW2 by.** 87.5% of seats reach WW2, on turn 29.5, and 93% of those leave it after 8.7 turns; 6.1% research Manhattan while they are there. The bomb is researched in 17.8% of Full Games, first on turn 43.6.
- **The WW2 factions are far apart with the economy on.** The UK wins 44% at six seats and Japan 2.6%; Germany wins 48% at four. That is the control's own spread, outside this package's scope, and the bands below are read against it, as the galaxy's were. It is noted in §7.

---

## 3. Phase 1 — The bots and the bomb

**Rule:** none changes. The bomb stays once per game behind Panzer Tactics.

**AI** (`backend/src/game-engine/ai/aiAtomBomb.ts`, called by `processAiTurn` and the harness):

- **Research.** Hard and expert bots treat Manhattan as a goal once their tree reaches its tier-3 prerequisite's line, the way the Space Age bots walk the lunar ladder: research the deepest affordable node on the path, and save tech points for the next one rather than spending them elsewhere when it is within reach. Medium buys it when it is the cheapest node left, as today. Easy does not research.
- **Firing.** In the attack phase, before its attacks, a bot holding an unused bomb fires it at the best target, scored as units destroyed plus the value of the buildings razed, with a bonus for a target it can walk into this turn and for an enemy capital. Because a once-per-game weapon should not be spent on a small stack, it fires only when the best target is worth at least a threshold the sim sets, or at any target when it is the last turn of a capped game.
- **Taking.** If a bot holds a stack next to the tile it bombed, the walk-in is added to the head of its attack plan, so the neutral 1-unit tile is taken this turn.

**Gate:** the §6 lines, plus the usage line: bots fire the bomb in most games in which they hold it.

**Shipped (dark):** `ai/aiAtomBomb.ts` behind `ww2_bomb_ai_enabled`, baked as `settings.ww2_bomb_ai` in every game that can play the WW2 tree (a WW2 game, or any climb). `selectAiTechResearch` takes the bomb's path before its score, for hard and expert bots only; `processAiTurn` fires the bomb after the faction strike and before the attacks, through `executeTechAbility`, spends a carried charge as the human handler does, puts out a seat the bomb left with nothing (`applyBombElimination`), shows the strike to the table, and puts the walk-in at the head of the plan. A bot never bombs a truce partner or a shielded seat. `AI_BOMB_MIN_VALUE` (8: units, plus two per building, plus two for a walk-in and three for a capital) keeps a once-per-game bomb for a target worth it, except on a capped game's last turn.

**Measured (same seeds and cells):**

| | Custom 6: control | Phase 1 | Custom 4: control | Phase 1 | Full Game: control | Phase 1 |
|---|---|---|---|---|---|---|
| length | 48.7 | 48.0 | 30.4 | 26.4 | 108.0 | 108.2 |
| decisive | 89.8% | 91.8% | 96.4% | 98.7% | 61.0% | 60.9% |
| turn-10 leader | 47.3% | 47.0% | 61.4% | **64.1%** | 30.8% | 31.1% |
| PP banked | 219 | 122 | 155 | 64 | 1,105 | 1,093 |
| games where anyone researches Manhattan | 80.2% | 75.2% | 50.7% | 42.0% | 17.8% | 17.8% |
| bombs fired per game | 0 | 2.98 | 0 | 0.91 | 0 | 0.20 |
| holders who fire | — | 100% | — | 100% | — | 100% |
| seats that fire win | — | 25.0% | — | 44.1% | — | 14.7% |
| detonations walked into the same turn | — | 17.0% | — | 33.5% | — | 52.8% |

| Faction win rate, custom 6 | Germany | Soviet Union | USA | UK | Japan | China |
|---|---|---|---|---|---|---|
| control | 26.4% | 9.9% | 9.7% | 44.0% | 2.6% | 7.3% |
| Phase 1 | 23.8% | 10.5% | 10.3% | 42.6% | 4.1% | 8.6% |

Reading the gate:

- **Usage passes.** Every bot that holds the bomb fires it, and the seats that fire win 25% at six seats and 44% at four, under 60%.
- **Six seats pass every line.** Games are as long, more decisive, the turn-10 leader is flat, and every faction moves toward its fair share.
- **Four seats fail the snowball line.** The turn-10 leader wins 2.7 points more often, on every seed (+3.8, +2.9, +1.2). With three rivals a once-per-game wipe is a kill shot, and the seat that reaches tier 4 first is usually the one already ahead. Games end four turns sooner. That is the rule's doing more than the bots': Phase 3 changes the rule, and Phase 1 is promoted with it or after it, not alone.
- **Full Game barely moves**, because its default bots are medium and medium does not pursue the bomb.
- **PP banked falls by half** in custom games: bombs raze the industry that would have earned it.

---

## 4. Phase 2 — The science line

**Rule:** Manhattan Project's prerequisite becomes Radar Network (`ww2_radar`) instead of Panzer Tactics. Its cost stays 20 TP.

The science line pays for itself: Mass Munitions adds 2 TP a turn and opens the Laboratory, and Radar adds 3 TP a turn and opens the Research Center. The path costs 42 TP instead of 47, and the player walking it earns its tech income on the way. In Full Game it overlaps the gate out of WW2 (Mass Munitions is a tier-2 node, Radar a tier-3 one), so the bomb sits about two turns past the gate, and "advance now or finish the bomb first" becomes a real decision. Rough arithmetic, to be replaced by Phase 0's numbers:

| Turn the bomb arrives | Tank line, today | Science line |
|---|---|---|
| path cost | 47 TP | 42 TP |
| four seats | about 14 | about 10 |
| six seats | about 21 | about 16 |

**Engine:** the tree option rides `eraTechTreeOptions` and `getEraTechTree`, like the galaxy's options; `validateResearch` reads the node from the game's own tree so a prerequisite an option moved is the one enforced. The tree route takes the option, so the client draws the line the server enforces.

Panzer Tactics keeps its attack die and Double Blitz; it simply stops leading anywhere.

**Shipped (dark):** `ww2TechTree({ manhattanScience })` in `eras/ww2.ts` behind `ww2_manhattan_science_enabled`, baked as `settings.ww2_manhattan_science` wherever the WW2 tree can be played. `eraTechTreeOptions` selects it, `validateResearch` now reads the node from the game's own tree (every other option keeps ids, costs and prerequisites, so no other game reads a different rule), the tree route takes `?manhattan=science`, and the client asks for it, so the tech panel draws the line the server enforces. The Phase 1 bots walk whichever line the game plays.

**Measured, with Phase 1 (same seeds and cells):**

| | Custom 6: control | Phase 1 | Phases 1 + 2 | Custom 4: control | Phase 1 | Phases 1 + 2 |
|---|---|---|---|---|---|---|
| length | 48.7 | 48.0 | 48.4 | 30.4 | 26.4 | 29.4 |
| decisive | 89.8% | 91.8% | 92.4% | 96.4% | 98.7% | 97.6% |
| turn-10 leader | 47.3% | 47.0% | **38.1%** | 61.4% | 64.1% | 62.6% |
| PP banked | 219 | 122 | 173 | 155 | 64 | 142 |
| games where anyone researches Manhattan | 80.2% | 75.2% | **99.7%** | 50.7% | 42.0% | **96.0%** |
| ...first on turn | 30.0 | 31.3 | **15.5** | 25.0 | 25.2 | **11.6** |
| bombs fired per game | 0 | 2.98 | 5.15 | 0 | 0.91 | 2.98 |
| seats that fire win | — | 25.0% | 19.4% | — | 44.1% | 32.0% |

| Faction win rate | Germany | Soviet Union | USA | UK | Japan | China |
|---|---|---|---|---|---|---|
| custom 6: control | 26.4% | 9.9% | 9.7% | 44.0% | 2.6% | 7.3% |
| custom 6: Phases 1 + 2 | 15.0% | 9.8% | 15.1% | 37.6% | 8.0% | 14.6% |
| custom 4: control | 48.4% | 8.3% | 31.5% | 28.4% | 15.4% | 17.9% |
| custom 4: Phases 1 + 2 | 40.8% | 6.3% | 41.4% | 26.3% | 19.3% | 15.8% |

The science line **alone** changes no bot game: its runs reproduce the control's digests on every seed in every mode, because a bot that is not pursuing the bomb buys Manhattan last on either line. What it changes is the path for a player who wants the bomb, human or a Phase 1 bot. Full Game with its default medium bots is therefore unchanged by Phases 1 and 2 together.

Reading the gate:

- **Reach passes, by a mile.** Someone holds the bomb in almost every custom game, first on turn 15.5 at six seats and 11.6 at four, against 30 and 25 behind Panzer Tactics.
- **Six seats improve on every line.** The turn-10 leader falls nine points, on every seed (39.3, 38.1, 36.8 against 46.2, 48.5, 47.2); every faction but the UK moves toward its fair share, and Japan triples. A bomb in everyone's hands by mid-game is the catch-up the era did not have.
- **Four seats are near flat.** The turn-10 leader is 1.2 points over the control (+1.0, +3.3, −0.7 by seed), within a standard error and half Phase 1's rise; decisiveness is up and games a turn shorter. The USA rises ten points and Germany falls eight.
- **Seats that fire win 19% at six seats and 32% at four**, against fair shares of 17% and 25%.

---

## 5. Phase 3 — The atomic arsenal

**Rule** (numbers are proposals for the sim):

| | Today | Arsenal |
|---|---|---|
| Uses | once per game | once per turn, in the attack phase |
| Price | none | **15 PP for a player's first detonation, +5 PP for each one after** (15, 20, 25, …) |
| Target | an enemy territory, units → 1 neutral, buildings razed | the same |
| Fallout | none | the tile carries **fallout for 3 rounds**: whoever holds it loses 1 unit at each round start (never below 1), and it pays no production or tech income |
| Home cost | none | in a game with stability, **every territory the bomber holds loses 10 stability** |
| Proliferation | none | after the first detonation by anyone, **Manhattan Project costs half** for every player who has not researched it |
| Full Game carry | an undetonated bomb carries one legacy charge | a player who holds Manhattan when they advance carries one charge; it fires without the PP price, with fallout and the home cost |

Why each piece:

- **Deny and take (decided).** The detonation leaves the tile neutral with one unit, so the bomber, or anyone next to it, can walk in this turn; fallout makes holding it cost a unit a round and earn nothing for three rounds. Denying is leaving it; taking is paying the fallout. Verdan's storm attrition (`applyStormAttrition`, `worldRules.ts`) is the same round-start mechanic, and fallout ticks beside it.
- **Escalating price.** The first bomb is affordable; a chain of them is not. Production is the economy's spending currency, and the leader's surplus is exactly what a flat price would let them convert.
- **Home cost.** Stability already throttles production and deploy caps (`stabilityManager.ts`); a bomber's empire pays in the currency the era advancement gate also reads.
- **Proliferation.** Historically grounded and mechanically a catch-up: whoever bombs first arms the players behind them.
- **Economy off.** A tech-on game without the economy earns no tech points at all, and the lobby never makes one (§7), so the PP price needs no fallback.

**Engine:** `abilities/atomicArsenal.ts` owns the price, the escalation (`PlayerState.atom_bomb_uses`), the requirement check before anything mutates and the charge after success, as the Moon's and the lanes' costs do in `executeTechAbility`. Fallout is `TerritoryState.fallout_rounds`, ticked once per round in `advanceToNextPlayer` beside the storms, read by `collectProduction` and `validateBuild`. `isGameScopedAbility` asks the game, so the bomb is game-scoped without the setting and per turn with it. Proliferation is a term in `getEffectiveTechCost`.

**AI:** the Phase 1 module fires when the purse covers the price, and asks more of each target as the price climbs.

**Client:** the ability button names the price, says once per turn, and describes the fallout; the territory panel names a fallout tile's rounds left, the way it names a garrison doctrine (per-tile states are not drawn on the map today); the tech tree shows Manhattan's discounted price.

**Shipped (dark):** behind `ww2_atomic_arsenal_enabled`, baked as `settings.ww2_atomic_arsenal` wherever the WW2 tree can be played. The numbers live in one shared table (`WW2_ATOMIC_ARSENAL`, `atomBombPrice` in `packages/shared`) that the server, the territory panel and the bots read.

- `state/atomicArsenal.ts`: the price, fallout (`markFallout`, `applyFalloutAttrition`, ticked once per round in `advanceToNextPlayer` beside the storms), and proliferation (`proliferatedTechCost`, read by `getEffectiveTechCost`).
- `abilities/atomicArsenal.ts`: the purse checked before the detonation and charged after it, in `executeTechAbility` beside the Moon's and the lanes' costs. A charge carried past WW2 pays no price.
- `executeTechAbility`: the bomb records no game-scoped use under the arsenal and stamps fallout. `isGameScopedAbility(abilityId, state)` asks the game, so the socket's once-per-turn bookkeeping applies to it.
- `collectProduction` skips a fallout tile; `validateBuild` refuses to build on one.
- `getCarryableLegacyAbility` carries a charge for a holder who has already detonated.
- The bots fire when they can pay and ask two more points of value of each target for every bomb they have dropped (`aiBombMinValue`).
- The client offers the bomb once per turn with its price, names a tile's fallout in the territory panel, and prices Manhattan at half in the tech tree once anyone has detonated, so its Research button opens when the server would sell.

With the setting off nothing changes: the harness's control reproduces its digest byte for byte with all of this in place.

**Measured (same seeds and cells).** The arsenal is measured as the package would ship, on top of Phases 1 and 2, and on top of Phase 1 alone, to see what the science line does for it.

| Custom, 6 seats | control | Phases 1 + 2 | Phases 1 + 3 | All three |
|---|---|---|---|---|
| length | 48.7 | 48.4 | 50.0 | **51.2** |
| decisive | 89.8% | 92.4% | 91.4% | 93.5% |
| turn-10 leader | 47.3% | 38.1% | 41.2% | **27.5%** |
| PP banked at game end, per seat | 219 | 173 | 25 | 15 |
| bombs per game | 0 | 5.15 | 11.27 | 17.89 |
| holders who fire | — | 100% | 89.1% | 86.8% |
| seats that fire win | — | 19.4% | 26.4% | 21.9% |
| detonations walked into the same turn | — | 11.1% | 23.6% | 24.0% |
| bombs per firing seat | — | 1 | 3.98 | 3.94 |
| PP paid per firing seat | — | — | 103 | 102 |
| Manhattan bought at half price | — | — | 75.8% | 78.7% |

| Custom, 4 seats | control | Phases 1 + 2 | Phases 1 + 3 | All three |
|---|---|---|---|---|
| length | 30.4 | 29.4 | 26.0 | 29.0 |
| decisive | 96.4% | 97.6% | 98.9% | 99.4% |
| turn-10 leader | 61.4% | 62.6% | **65.9%** | 60.9% |
| PP banked at game end, per seat | 155 | 142 | 28 | 21 |
| bombs per game | 0 | 2.98 | 3.18 | 10.55 |
| holders who fire | — | 100% | 94.3% | 92.2% |
| seats that fire win | — | 32.0% | 44.6% | 34.2% |
| detonations walked into the same turn | — | 21.8% | 34.0% | 33.0% |
| bombs per firing seat | — | 1 | 3.43 | 3.76 |
| PP paid per firing seat | — | — | 82 | 93 |
| Manhattan bought at half price | — | — | 57.2% | 68.2% |

| Faction win rate | Germany | Soviet Union | USA | UK | Japan | China |
|---|---|---|---|---|---|---|
| custom 6: control | 26.4% | 9.9% | 9.7% | 44.0% | 2.6% | 7.3% |
| custom 6: all three | 10.5% | 7.5% | 21.4% | 22.5% | 19.1% | 19.1% |
| custom 4: control | 48.4% | 8.3% | 31.5% | 28.4% | 15.4% | 17.9% |
| custom 4: all three | 35.6% | 5.6% | 43.9% | 20.8% | 27.1% | 17.1% |

**Full Game.** Its default bots are medium, and medium does not pursue the bomb, so the default cell barely sees it. Hard and expert are choices in the Full Game picker, so the climb was also run with expert bots, the setting in which this package actually plays out there.

| Full Game, 4 seats, medium bots (the default) | control | Phases 1 + 2 | All three |
|---|---|---|---|
| length | 108.0 | 108.2 | 108.3 |
| decisive | 61.0% | 60.9% | 61.2% |
| turn-10 leader | 30.8% | 31.1% | 31.1% |
| first advancer wins | 33.0% | 33.1% | 33.6% |
| turn-10 era leader wins | 37.2% | 37.2% | 38.6% |
| peak era spread | 1.81 | 1.81 | 1.81 |
| bombs per game | 0 | 0.20 | 0.58 |
| seats that fire win | — | 14.7% | 18.0% |

| Full Game, 4 seats, expert bots | control | Phase 1 | Phases 1 + 2 | All three |
|---|---|---|---|---|
| length | 68.2 | 57.0 | 51.8 | 47.2 |
| decisive | 71.3% | 81.4% | 85.3% | 89.4% |
| turn-10 leader | 69.4% | 70.5% | 71.0% | 71.9% |
| first advancer wins | 72.7% | 73.7% | 75.2% | **75.3%** |
| turn-10 era leader wins | 88.1% | 89.5% | 90.5% | **91.1%** |
| peak era spread | 1.88 | 1.88 | 1.88 | 1.88 |
| games in which anyone reaches the final era | 47.1% | 39.6% | 35.5% | **26.2%** |
| games where anyone researches Manhattan | 27.2% | 34.1% | 51.5% | 51.5% |
| seats in WW2 that research it there | 21.0% | 26.2% | 43.5% | 44.3% |
| bombs per game | 0 | 0.44 | 0.71 | 1.53 |
| seats that fire win | — | 40.7% | 51.4% | **59.5%** |

**Price.** Two dearer price lines were run on the custom cells with all three phases on, through the harness's `SIM_ARSENAL_PRICE` knob:

| Price, first + step | 15 + 5 (shipped) | 20 + 10 | 25 + 15 |
|---|---|---|---|
| custom 6: length | 51.2 | 51.2 | 49.9 |
| custom 6: turn-10 leader | 27.5% | 29.3% | 31.3% |
| custom 6: bombs per game | 17.89 | 14.07 | 11.78 |
| custom 4: length | 29.0 | 27.6 | 27.5 |
| custom 4: turn-10 leader | 60.9% | 62.7% | **64.2%** |
| custom 4: bombs per game | 10.55 | 7.89 | 6.56 |

**Who fires.** A one-seed probe, logging each detonation's bomber and target without changing the run (its digests match the runs above), counts the share of detonations fired by the seat holding the most territory at that moment:

| | Custom 6 | Custom 4 | Full Game, expert |
|---|---|---|---|
| detonations logged | 18,088 | 10,519 | 1,626 |
| fired by the territory leader | 34.0% | 43.1% | 51.3% |
| ...a uniform seat would be | 16.7% | 25% | 25% |
| aimed at the territory leader | 35.8% | 44.3% | 44.5% |
| fired by the era leader | — | — | 65.9% |

Reading the gate:

- **Usage passes in custom games.** 87% of the bots that research the bomb fire it at six seats and 92% at four, and the seats that fire win 22% and 34%.
- **Six seats: the strongest catch-up this package measured, and half a turn over the length line.** The turn-10 leader falls from 47.3% to 27.5%, on every seed (27.5, 27.8, 27.3 against 46.2, 48.5, 47.2), and every faction but the Soviet Union moves toward its fair share: the UK halves, Japan goes from 2.6% to 19.1%, and the gap between the best and worst faction narrows from 41 points to 15. Decisiveness rises. Games run 2.5 turns longer (+2.4, +2.4, +2.8 by seed), which fails the two-turn line. The bombs themselves are the likely cause, about 18 a game: each leaves a neutral tile that pays nothing for three rounds, and Conquest counts the board.
- **Four seats pass with the science line, and fail without it.** With all three phases the turn-10 leader is half a point under the control (−1.7, +1.8, −1.8 by seed), decisiveness is up and games are a turn shorter. Without Phase 2 the turn-10 leader rises 4.5 points: an arsenal reached late is a kill shot in the hands of whoever got there first. Phase 3 is promoted with Phase 2 or not at all.
- **The price stays at 15 + 5.** Only the dearest line brings six-seat length inside the line (+1.2 turns), and at that price the four-seat leader rises 2.8 points, the failure Phase 1 had alone. A cheap bomb is an equaliser that every seat fires; an expensive one is a rich seat's tool. The half turn at six seats is the cheaper failure to accept.
- **Full Game with its default bots is unchanged** within noise; the era-leader rise is one seed (32.0% to 36.0% on `ww2-a`, unchanged on the others).
- **Full Game with expert bots fails the climb lines.** Each phase raises the first-advancer and turn-10 era-leader shares, by 2.6 and 3.0 points with all three: the first on every seed, the second on two of three; the seats that fire win 59.5%, at the line and over it on one seed (63.0%); and games end 21 turns sooner, so the share in which anyone reaches the final era falls from 47% to 26%. In a climb the bomb belongs to whoever reached WW2 first: a seat level with or ahead of every other in the era race fires two detonations in three. Proliferation, the catch-up that works in custom games, discounts only seats already in WW2, and a seat still in an earlier era cannot research Manhattan at all.

**Recommendation.** Custom WW2 games: promote Phases 1, 2 and 3 together, accepting the half turn at six seats or treating it as the next tuning target. Full Game: do not promote any phase for hard or expert bots as it stands. The bomb there ends the climb early in the era leader's favour, which is the opposite of what the package is for. The fix belongs to the decision in §0.5 rather than to a price, and the options are in §7.

---

## 6. Measurement and gates

The harness runs every phase in custom mode at six and four seats, and in full mode at four seats, 1,000 games on each of three seeds, against the control. A phase promotes only if:

- **custom mode:** the faction bands stay where the control puts them, decisiveness does not fall, average length does not rise by more than two turns, and the turn-10 leader's win share does not rise;
- **full mode:** decisiveness does not fall, the first-advancer and turn-10 era-leader win shares do not rise, and the peak era spread does not widen;
- **reach** (Phases 2 and 3): the share of games in which someone holds the bomb rises;
- **use** (Phases 1 and 3): bots fire it in most games in which they hold it, and the win share of seats that fire stays **below 60%**, read with the galaxy's caveat that a seat that reaches tier 4 is usually already ahead.

---

## 7. Out of scope, and noted for later

- **Tech trees without the economy earn no tech points.** Base tech income is paid inside `collectProduction`, which returns at once when the economy is off, and no WW2 tier-1 node pays tech income. The lobby already knows: ticking Technology Trees ticks Economy and locks it on (`economyRequired`, `LobbyPage.tsx`). The create route does not refuse the pair, so only an API caller can make such a game; a server-side refusal would close it.
- **The WW2 factions with the economy on.** The control's spread (UK 44% and Japan 2.6% at six seats, Germany 48% at four) is the era's own, not this package's. `simFactionBalance.ts`, which plays no economy, sees a much narrower one, so the economy and the tree are where to look first.
- **The wonder's name.** One of the two Manhattan Projects needs another name before Phase 3 is promoted; the wonder is the easier one to rename.
- **Cold War Nuclear Strike and the other tech strikes.** Bots never fire them either. Phase 1's module is the pattern for widening that.
- **Signature mid-game abilities for the other eras.** The same reach-then-scope pattern, once WW2 shows what works.
- **Counterplay buildings** (Radar interception, bunkers that blunt a strike): only if Phase 3 measures the bomb too strong.
- **Full Game.** §5 measures the bomb as a finisher in a climb with hard or expert bots. Three ways forward, each a decision on §0.5's scope before it is code:
  1. **Custom first** (recommended now): bake the three settings only where the game starts in WW2 (`era_id === 'ww2'`), so Full Game keeps today's bomb until a climb rule is measured. One line in `bakeCreateGameSettings`.
  2. **Era peers only**: in a climb, the bomb may target only a seat in WW2 or a later era. The probe in §5 says this reaches part of the problem: 37.5% of Full Game detonations land on a seat in an earlier era, 30.9% on one in the same era and 31.5% on one further ahead.
  3. **Restraint for bots in a climb**: a bot fires only at the seat leading on territory or era. It changes nothing a human does, so it is a bot-game fix, not a balance one.
- **Six-seat length.** All three phases run six-seat games 2.5 turns longer. The next tuning target, if one is wanted, is the bomb's footprint on Conquest (a bombed tile is neutral until someone takes it, and the 65% is of the whole board), not its price (§5).

---

## History

- **2026-10-03:** written after a discussion of the once-per-game abilities: most games end before anyone reaches Manhattan Project. Decided in discussion: tech-on custom games and Full Game are both in scope; the bomb denies and takes ground; it becomes repeatable at a price.
- **2026-10-03:** Phases 0 to 3 shipped dark and measured on 1,000 games per cell on three seeds, with an expert Full Game arm and two dearer price lines. Custom WW2 games pass every line with all three phases except six-seat length (+2.5 turns); the price stays at 15 + 5. Full Game with expert bots fails the climb lines; options in §7.
