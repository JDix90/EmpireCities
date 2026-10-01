# Galactic Age modes — one map, a game for every seat count

**Status:** built. Step 1 (Colonies, two and three players), step 2 (the
Schism, eight players, with the Concord and Civil War), step 3 (teams: Allied
houses at eight and 2v2 at four) and step 4 (the Partial Schism, five to seven
players) are built and measured. The Galactic Age is admin-only; nothing here is
player-facing until it opens.

Every other era plays classic Risk on its own map. The Galactic Age has one map,
four worlds in a ring, and it plays differently depending on how many seats the
game has. The core stays the same (draft, attack, fortify, cards, the corridor
rules, the world rules), and each seat count gets its own start and a few rules
of its own. That gives the era its own identity without giving up the game's.

## The board all modes share

`database/maps/era_galaxy.json`: four worlds of 16 tiles each, one per faction.
Their home regions decide which is whose.

| World | Faction | World rule |
|---|---|---|
| Sol III | Stellar Mandate | the Cradle: every fifth round, Sol tiles under 2 units muster 1 |
| Verdan Reach | Helion Navigators | storms shed units from over-stacked tiles |
| Rust Belt | Forge Syndicate | the forge: +1 defence die with a defence building |
| Nexus Station | Void Custodians | the Vault: its Gate Ring starts neutral; whoever holds it earns tech and an Emergency Seal on any lane |

The worlds sit in a ring, **Sol – Verdan – Rust – Nexus – Sol**. Two authored
lanes join each neighbouring pair, eight in all. Each lane lands on a gateway
tile, four per world, two facing each neighbour. **Sol–Rust and Verdan–Nexus are
the ring's gaps**, with no lane between them. The world rules belong to whoever
holds the tiles, not to a faction, so they keep working however the worlds are
split.

## Modes by seat count

| Seats | Mode | Start | Status |
|---|---|---|---|
| 2 | **Colonies** | Two home worlds; the other two open neutral and garrisoned | built |
| 3 | **Colonies** | Three home worlds; the fourth opens neutral, and two extra lanes join every world to every other | built |
| 4 | **Classic** | One home world each | shipped |
| 4 | **2v2** | One home world each, in two teams: Sol and Rust against Verdan and Nexus | built |
| 5–7 | **Partial Schism** | One to three worlds shared by two houses; a house alone on each other world, its other half unclaimed (with Allied houses, held whole) | built |
| 8 | **Schism** | Every world shared by two houses, as rivals or, with Allied houses, as four teams | built |

The create route, the join cap and game start hold the era to 2–8 seats
(`backend/src/modules/games/lobbyCapacity.ts`). Before the Partial Schism, five
to seven had no board and were refused; they once got a scattered start across
worlds no seat could reach.

## Colonies (two and three players) — built

**Rules**

- Every player opens on their faction's whole home world, as at four seats.
- Each world nobody calls home opens as a **colony**: every tile neutral, 5 units
  on a gateway and 7 inland. A Vault ring keeps its authored 6, whether it sits
  on a colony or a home world.
- **Three players:** both of the ring's gaps are bridged for the whole game. The
  bridges land on the gateways a Lane Surge would use. Without them, the middle
  seat of the three borders both rivals and never touches the colony.
  - The bridges are engine-added lanes (`source: 'galaxy_mode'`). They carry
    attacks, obey the lane dice cap and can be Emergency-Sealed, but Lane
    Sovereignty counts only the eight authored lanes.
  - With both gaps permanently open, the Lane Surge card is left out of the
    event deck, since it would have nowhere to open.
- **Lane Sovereignty** stays 5 of the 8 lanes, but a two-player streak must run
  **5 rounds** instead of 3.
  - A streak breaks on a rival's turn, so the rounds set how many rival turns it
    has to survive: (rounds − 1) × (seats − 1).
  - That is six at four seats and four at three. At two seats with three rounds
    it would be two, and Sovereignty ended 63% of duels. Five rounds restores
    four.
- **The Helion Navigators draft +1 in a duel, not +2.**
  - Their second point pays for Sol's Cradle at four seats. In a duel, region
    bonuses shrink to a third and a flat bonus doesn't, so it made them the
    strongest seat.
  - Kits the board changes are data on the faction: `colony_reinforce_bonus`,
    keyed by seat count.
- **Home Worlds off** deals the scattered start at any seat count, and there are
  no colonies.

**Balance** (1,200 games × 3 seeds, live defaults;
[GALAXY-BALANCE.md §7](../backend/scripts/GALAXY-BALANCE.md) has every table
and the sweeps behind each number):

| | Two players | Three players |
|---|---|---|
| Game length | 23.5 turns | 26.1 turns |
| Won by Lane Sovereignty | 45% | 38% |
| Turn-10 leader wins | 72% | 62% (four players: 62%) |
| Faction win rates | Sol 56, Rust 42, Verdan 59, Nexus 43% | 25–39% |

- **Both counts pass every gate**, with every faction inside the band.
- **Verdan against the Custodians** is still the most one-sided duel, at 64–74%.
  It was 79–83% before the Navigators' duel bonus.
- **Rejected: halving every flat faction bonus in a duel.** It fixed Verdan and
  broke the Forge (34.5–37%), whose +2 is its base kit.
- **Rejected: handing a seated Custodian their Vault ring.** It gave them 81%
  of duels.

**Code:**
- `backend/src/game-engine/state/galaxyModes.ts`: layout, garrisons, bridges.
- `galaxyRing.ts`: the ring geometry it shares with the Lane Surge.
- `state.galaxy_mode`: what a game was dealt.
- `LANE_SOVEREIGNTY_ROUNDS_BY_SEATS` in `victory/laneSovereignty.ts`.
- `colony_reinforce_bonus` on the faction (`eras/galaxyage.ts`), read by
  `factionReinforceBonus`.

## House relations — Concord, Civil War and Allied (built)

Schism puts two houses on one world. A single lobby setting, **House Relations**
(`galaxy_house_relations`), decides how they start:

- **Concord (default) — built.** The two houses on a world begin under a truce,
  using the existing truce system, for the first **3 rounds** (the first round
  counts). That gives them time to face outward before deciding when to
  betray. Breaking the Concord carries the ordinary truce-break rules: the
  betrayed house defends that attack with an extra die, then gets an extra die
  for its next attack on the breaker. The AI keeps every truce, so an AI house
  never breaks it. The territory panel shows the rounds left.
- **Civil War — built.** The houses start hostile, for chaos from turn one.
- **Allied — built (step 3).** The two houses are one team, on the team rules
  below: they never attack each other, share vision and regions, and win
  together. There is no Concord and no Lane Crown between them.

Concord is the default because it protects the opening. In the balance data the
turn-10 leader wins about 62% of four-player games. A house crushed by its
co-world rival in round two is effectively out, and that is miserable in an
eight-player game.

## Schism (eight players) — built

**Rules** (`backend/src/game-engine/state/galaxySchism.ts`)

- **Every faction is dealt to two seats.** A seat's pick stands while its
  faction has a seat left. When three seats pick one faction, two keep it at
  random, and the rest take the seats left over, shuffled. The waiting room
  lets two players pick each faction.
- **Two houses per world, on authored halves.** Each house opens on one half of
  its faction's home world, drawn at random: eight connected tiles, or six on
  Nexus Station, whose Gate Ring stays neutral. Each half holds two of the
  world's four gateways.
  - **Rust and Verdan** split by lane side, so each house faces one neighbour.
  - **Sol** splits west and east along its bonus regions (the Americas and the
    Atlantic arc against the Crescent and the Asian rim). Each Sol house has
    one lane to Verdan and one to Nexus. Sol's lane-side split cuts three of
    its four regions.
  - **Nexus Station** cannot split by lane side: its four gateways alternate
    around the Vault. Its two houses start either side of the neutral Vault
    (the Vault Ward and the Berth Ring), each with one lane to Rust and one to
    Sol. The lane-sealing prize between them becomes a civil war.
- **Shared kits.** Both houses on a world play that world's faction: the same
  abilities, told apart by colour and house name (Western and Eastern Mandate,
  Dawnrim and Duskrim Navigators, Tharsis and Hellas Syndicate, Ward and Berth
  Custodians). Four new rival factions stay an option for later.
- **House bonuses.** The halves are not the same ground. Each half carries a
  bonus in units a turn, recorded on the house when the board is dealt:

  | House | Units a turn | Why |
  |---|---|---|
  | Western Mandate | +3 | its border with the east is four tiles long against the east's two |
  | Duskrim Navigators | +2 | its lanes lead only to Tharsis, which grinds it down |
  | Dawnrim Navigators | +1 | holds the richer Verdan regions, but faces both Sol houses |
  | Tharsis Syndicate | +3 | its lanes lead only to the Duskrim house |
  | Hellas Syndicate | −1 | faces the two Custodian houses, and eats Tharsis without it |
  | Ward / Berth Custodians | −1 each | the Custodians' kit and the Vault at their door |

  The two Custodian houses also open lighter: the Ward at 3 units a tile, the
  Berth at 2. At four seats the Custodians get 4 a tile for starting without
  the ring; here neither house would hold it whole anyway.
  - The compensation is per turn wherever it could be. A house that opened far
    larger than its rival could break the Concord in round one, which the AI
    never does and a player would.
  - Opening units were tried first and rejected for that reason: evening out
    Sol that way needed the West at 6 units a tile against the East's 2.
- **The Lane Crown.** Hold all four of your world's gateways (your own two and
  your rival's) and you draft **+2 a turn** while you keep them. Lose one, and
  you lose the Crown.
  - It is **Schism-only**: at four seats everyone holds their whole world from
    turn one, so it would change the classic game.
  - The upgraded world rule once suggested for it was not needed.
- **Lane Sovereignty** is unchanged: 5 of the 8 lanes, held for 3 rounds.
- **The lobby.** "Schism (five to eight players)" asks for eight seats and
  shows the House Relations choice. It needs Home Worlds.
  - The game plays the board for however many seats are filled when it starts,
    with AI opponents plus the invited players: the Partial Schism at five to
    seven, the Schism at eight.
  - Started with two to four seats, it plays that count's board instead.
- **Unification** (still open): eliminating your co-world house could hand you
  their kit ability or a permanent Crown.

**Balance** (1,200 games × 3 seeds, live defaults;
[GALAXY-BALANCE.md §8](../backend/scripts/GALAXY-BALANCE.md) has every table
and the search behind each number):

| | Concord (default) | Civil War |
|---|---|---|
| Game length | 40.6 turns | 39.6 turns |
| Won by Lane Sovereignty | 43% | 45% |
| Turn-10 leader wins (baseline 12.5%) | 38% | 42% |
| First seat wins | 12.6% | 14.4% |
| Faction win rate per seat | Sol 12.5, Rust 11.0, Verdan 11.2, Nexus 15.3% | 10.5–14.5% |
| House win rates | 8.2–15.6% | 9.4–17.1% |

- **Every faction passes the gate** on every seed.
- **Houses:** the halves are not the same ground, and it shows at the edges.
  Under the Concord every house is within ±40% of its 12.5%; six are within
  ±28%. Duskrim (8.2%) and Hellas (8.6%) sit just under.
- **Without compensation** the houses ran 1.3–35.2%. The Concord's length and
  the Crown's size barely moved that; the split per world and the house
  bonuses did.
- **Tuned against the AI**, which never breaks a truce. Houses played by people
  may want the numbers revisited, and the per-turn form keeps any retune off
  the opening.

**Code:**
- `galaxySchism.ts`: the halves and their numbers, the deal, the Concord and
  the Crown.
- `state.galaxy_mode`: the houses dealt, with their bonuses, the relations, the
  Concord rounds and the Crown's worth. A retune never changes a game in
  progress.
- `lobbyCapacity.seatsPerFaction`: two seats per faction in a lobby of five
  seats or more.

## Teams — Allied houses and 2v2 (built)

The team rules belong to the engine, not to a board
(`backend/src/game-engine/state/teams.ts`), and every board that deals teams
plays by them. A game has teams when `state.teams` lists its sides. A game
without them plays free-for-all, and every team helper answers as if nobody had
an ally, so nothing about a free-for-all game changes.

**The rules**

- **No friendly fire.** Nothing a player can aim at another player's ground can
  be aimed at an ally's: an attack, a blitz, a Fleet Attack, a strike, the bomb,
  a Drop Assault, Influence.
  - The engine refuses it where each act resolves, and the socket refuses it
    with a reason (`ALLY_TARGET`).
  - The AI never plans it, and an ally's border is as quiet to it as its own.
  - An event card that picks an opponent never picks an ally, and a truce is
    only ever offered to an enemy.
- **An opening ceasefire.** No side attacks another until every seat has had
  its first turn (`CEASEFIRE`); neutral ground stays open. Without it the side
  that moved first won 65% of 2v2 games.
- **Seats alternate.** The seats are reordered so the sides take turns in
  rotation (A B C D A B C D, or A B A B). Back to back, a side would play two
  turns running.
- **Shared regions.** A region a side holds whole between its members pays its
  bonus once, to the member holding the most of it (a tie goes to the earlier
  seat).
- **Shared lanes.** An ally's gateway counts as your own. A lane with one end
  each is the side's corridor for Lane Sovereignty, and an ally's lane seal
  lets you through.
- **Shared vision.** Under fog a player sees whatever an ally sees.
- **Shared victory.** A side wins together:
  - the last side standing wins;
  - domination and the threshold count the side's territories together;
  - the capital reading needs every living capital in the side's hands;
  - Lane Sovereignty, the Lunar Hegemony and Transcendence win for the side
    when any member completes them. Each member keeps their own Sovereignty
    streak on the side's corridors, and the rounds a streak needs are set by
    the number of sides, not seats;
  - when every human's side is out, or the turn cap passes, the leading side
    wins;
  - an eliminated member wins with their side, and is paid as a winner;
  - resigning concedes for your side: the last human to resign credits the
    leading other side.
- **No secret missions.** A mission is a win of one's own, and one could name an
  ally to eliminate, so a team game drops the condition. The lobby greys it out.

**The boards** (`state/galaxyTeams.ts`)

- **Allied houses:** the Schism's House Relations set to Allied. Each world's
  two houses are one side: at eight seats four sides of two, each sharing a
  faction, its kit and its world. At five to seven seats a player alone on a
  world is a side of one, holding it whole (see the Partial Schism).
  - No Concord and no Lane Crown: between them the two houses hold their whole
    world from turn one.
  - Tuned per world, both houses alike (`ALLIED_TUNING`), in units a turn: Sol
    −1, Verdan 0, Rust +3, Nexus +1. Every house opens at the standard count;
    the halves' own numbers settle a rivalry these houses do not have.
  - Lane Sovereignty needs 3 rounds, as at four players.
  - The waiting room says to pick the same faction as a friend to share a side.
- **2v2:** the lobby's "2v2 (four players)", with Home Worlds on. The home
  worlds pair **across the ring's gaps**: Sol and Rust against Verdan and Nexus
  (the Stellar Mandate and the Forge Syndicate against the Helion Navigators
  and the Void Custodians).
  - Every lane is a front, and every player borders both enemies. Paired with
    a neighbour instead, Verdan's side won nine games in ten.
  - A player's faction is their side.
  - Lane Sovereignty needs 5 rounds, as in a duel.
  - Switching 2v2 on moves the lobby's threshold default from 60% to 75%: a
    side starts on half the map.
  - Started with two or three players, the game plays that count's board.

**What players see**

- The start briefing has a Teams section: your side, who you face and the
  rules. Win conditions are phrased for the side.
- The HUD lists the players under their sides. Map control and Lane
  Sovereignty count the side's territories and corridors.
- The territory panel marks an ally's ground, offers nothing hostile there,
  names the member who collects a shared region, and explains the ceasefire.
- The result screen reads "Team Victory", names the winning side and lists
  every member, the eliminated included, at the top of the standings.

**Balance** (1,200 games × 3 seeds, shipped defaults;
[GALAXY-BALANCE.md §9](../backend/scripts/GALAXY-BALANCE.md) has every table
and the sweeps behind each number):

| | 2v2 | Allied houses |
|---|---|---|
| Game length | 15.9–16.3 turns | 28.6–29.3 turns |
| Won by Lane Sovereignty | 45–48% | 38–40% |
| Side win rates | Sol & Rust 46.5–50.3%, Verdan & Nexus 49.8–53.5% (baseline 50%) | Sol 23.0–25.3, Verdan 26.3–28.9, Rust 25.3–26.7, Nexus 21.4–23.3% (baseline 25%) |
| First seat's side wins | 50.5–53.6% | 24.6–27.3% |
| Turn-10 leader's side wins | about 83% | 63–66% |

- **Both boards pass the gate on every seed**, read by sides: each within ±28%
  of its share.
- **The ceasefire is part of the tuning.** Without it, the side moving first
  won 66% of 2v2 games, and the Allied sides ran 13.9–39.4%.
- **2v2 snowballs**: the side leading at turn 10 wins about 83% of games that
  last about 16 turns.
- **Allied Sol houses end eliminated in about half of games**, though their
  side wins its share.
- **Free-for-all is unchanged**: two, three and four players reproduce main
  exactly, and the Concord Schism matches it as closely as main matches itself.

**Code:**
- `state/teams.ts`: the rules every hostile path checks, and the shared-region
  reading.
- `state/galaxyTeams.ts`: the two boards' deals and the seat order.
- `victory/teamVictory.ts`: the side-by-side reading of every condition.
- `state.teams`: the sides a game was dealt, in seat order.
- `frontend/src/utils/teams.ts`: the client's mirror of the rules.

## Partial Schism (five to seven players) — built

**Rules** (`backend/src/game-engine/state/galaxySchism.ts`)

- **One world splits for each player over four**: one at five, two at six,
  three at seven. A split world is shared as at eight seats: the same halves,
  the same kit, and the Concord or Civil War between its two houses.
- **Which worlds split follows the picks.**
  - A faction picked by two players splits its world.
  - When more factions are picked twice than worlds may split, the pairs that
    stand are drawn, and each other pair gives a seat back.
  - Players without a pick fill in the rest: first a faction nobody holds, then
    a second seat on each world still to split. A world nobody picked splits
    before one a player picked alone, so a lone pick keeps its world where it
    can.
  - With nobody picking, the split worlds are drawn.
- **Every seat is a house on half a world.** A world dealt to one player has one
  house, alone, on a half drawn at random. The other half starts **unclaimed**:
  neutral and garrisoned, like a colony.
  - The garrison is 9 units on each gateway and 11 inland at five seats, 10 and
    12 at six, and 12 and 14 at seven.
  - It thickens as houses alone get rarer. At seven, the one house alone is the
    only seat without a rival at home.
- **Why not whole worlds.** The plan was to deal the other worlds whole, as at
  four seats, and give the houses a catch-up bonus. Measured, a seat on a whole
  world won three to seven times as often as a house, and nothing closed the
  gap:
  - tried: up to +15 units a turn, thicker openings, a lighter whole world, and
    a Concord lasting the whole game;
  - a split world's two houses fight each other, boxed in behind their lanes,
    while a whole world starts with twice the land and all four gateways;
  - the larger bonuses only made the Verdan houses the strongest seats, while
    Sol's and Nexus's stayed near zero.

  Starting every seat on half a world closed the gap at every seat count
  (GALAXY-BALANCE.md §10).
- **Each half has its own numbers**, in units a turn: one for a house with a
  rival, one for a house alone. The eight-seat numbers were measured with a
  rival on every world and do not carry over, and every half opens at the
  standard count.

  | Half | With a rival | Alone |
  |---|---|---|
  | Western Mandate | +5 | +1 |
  | Eastern Mandate | +1 | 0 |
  | Dawnrim Navigators | 0 | +1 |
  | Duskrim Navigators | −2 | −1 |
  | Tharsis Syndicate | −1 | −2 |
  | Hellas Syndicate | +1 | +2 |
  | Ward Custodians | +1 | 0 |
  | Berth Custodians | 0 | 0 |
- **The Lane Crown** works as at eight seats: hold all four of your world's
  gateways. For a house alone, that means its own two and the unclaimed half's.
- **The Concord** is only between a split world's two houses.
- **Allied houses.** Every world is one side.
  - A split world's two houses are a side of two, as at eight seats.
  - A player alone on a world holds all of it, a side of one, and nothing is
    unclaimed.
  - A side of two plays two turns a round, and a side's chances turn on which
    sides it faces, so the numbers go board by board, by the worlds that split
    (`PARTIAL_ALLIED_TUNING`, keyed by `schismSplitKey`). A board has one
    number a world, from −4 to +13 units a turn: each house of a side of two
    drafts it, or the seat holding that world whole.
    [GALAXY-BALANCE.md §10](../backend/scripts/GALAXY-BALANCE.md) lists them.
  - A seat whose number outweighs its draft drafts nothing that turn, never a
    negative count (`floorSchismDraft`).
  - The sides are seated so their turns come round as evenly spaced as they
    can: A B C A D at five.
- **Lane Sovereignty** is 5 lanes for 3 rounds, as at eight seats.
- **The lobby.**
  - The Schism switch reads "Schism (five to eight players)". It seats up to
    eight, and the game plays the count seated at the start.
  - Two players may pick one faction in any lobby of five seats or more. The
    waiting room explains how shared factions split.

**Balance** (1,260 games × 3 seeds, live defaults;
[GALAXY-BALANCE.md §10](../backend/scripts/GALAXY-BALANCE.md) has every table
and the screens behind each number):

| | Five players | Six | Seven |
|---|---|---|---|
| Game length (Concord) | 34.9 turns | 37.6 turns | 39.6 turns |
| Won by Lane Sovereignty | 34–38% | 36–39% | 39–43% |
| Turn-10 leader wins | 47–52% (baseline 20%) | 44–46% (16.7%) | 39–45% (14.3%) |
| Faction win rates per seat (Concord) | 17.2–23.3% | 11.9–19.3% | 11.3–16.9% |
| Houses with a rival / alone (Concord) | 19.3–20.1 / 19.9–20.4% | 15.4–16.5 / 16.9–19.2% | 13.8–14.1 / 15.4–17.1% |
| Allied sides | 20.4–31.2% | 19.8–29.1% | 20.9–30.9% |
| Allied, every side of every board | 5.4 points RMS from 25% | 5.4 | 5.1 |

- **Every faction passes the gate on every seed but once.** The Mandate at six
  seats under the Concord won 11.9% on one seed, against a floor of 12.0% (12.8
  and 13.0% on the others). It is the weakest faction at six seats, and at
  seven under the Concord. Under the Concord its two houses on a split world
  win well under their share; in Civil War, close to it.
- **Civil War passes on every seed**: factions at 15.2–22.8% at five seats,
  15.0–18.6% at six and 12.1–16.5% at seven.
- **A house with a rival and a house alone are even** at every count, each
  within ±28% of its share on every seed.
- **Allied passes on every seed**, measured on seeds the search never used.
  Board by board, the sides sit 5.1–5.4 points RMS from 25%, against 8.8–14.7
  with one number a world. At seven seats, a seat holding Rust alone now wins
  14%, not 2%, and one holding Sol alone 24%, not 42%. The least even boards
  are those where two neighbouring worlds both split: there, one unit a turn
  flips which pair wins.
- **Two, three, four and eight players are unchanged**: two to four reproduce
  main exactly, and eight seats match main as closely as main matches itself.

**Code:**
- `galaxySchism.ts`: the deal (`dealSchismFactions`), the board
  (`schismLayout`), the unclaimed halves (`schismUnclaimedTiles`), and the
  numbers (`PARTIAL_SCHISM_TUNING`, `PARTIAL_SCHISM_HALVES`,
  `PARTIAL_ALLIED_TUNING`).
- `state.galaxy_mode`: every house, with its numbers, and either the unclaimed
  halves' garrison (Concord and Civil War) or the whole worlds (Allied).
- `galaxyTeams.ts`: Allied sides of one and of two, and the seat spacing.

A wilder alternative was considered: **Corsairs**, stateless raiders built
around the lanes. It is shelved as the hardest to balance.

## Modes as data

A mode is a **start layout plus a few rule add-ons**, recorded on the game state
rather than hard-coded as era special cases:

- **The layout** is decided once, at `initializeGameState`, from the seat count
  and the factions' home worlds, and written to `state.galaxy_mode`.
- **Rule add-ons** read the state:
  - lanes a mode opens are projected onto the game's map copy
    (`syncGalaxyModeLanes`, the same discipline as Jump Gate and surge lanes),
    and re-projected when a room is rebuilt;
  - per-seat numbers live in small tables
    (`LANE_SOVEREIGNTY_ROUNDS_BY_SEATS`, `COLONY_GARRISONS`, `SCHISM_HALVES`,
    `SCHISM_TUNING`, `ALLIED_TUNING`, `GALAXY_2V2_PAIRS`,
    `LANE_SOVEREIGNTY_ROUNDS_BY_SIDES`, `TEAM_TUNING`, `PARTIAL_SCHISM_TUNING`,
    `PARTIAL_SCHISM_HALVES`, `PARTIAL_ALLIED_TUNING`) that the balance sim can
    patch;
  - teams are data too: `state.teams` lists the sides, and the engine's team
    rules read it.
- **Every mode is measured before it opens.** `simGalaxyBalance.ts` runs any
  seat count (`SIM_PLAYERS`), rotates every faction line-up and seat, and
  reports win rates as a share of the games each faction played.
- **The gate** is four players' gate scaled by seat count:
  - decisive in 80% of games or more;
  - each faction within ±28% of 1/players (in a team game, each side within
    ±28% of 1/sides);
  - no faction eliminated in more than 30% of games;
  - lanes changing hands;
  - Sovereignty a real ending, not the only one.

Built this way, other eras could adopt modes of their own later without a
rewrite. Whether any should is a separate discussion.

## Real games: the admin report

Every number above was tuned against the AI. The report under
**Admin → Galactic Age** reads the games people actually finish.

**What is recorded.** As a Galactic Age game ends, `finalizeGame` records it
(`recordGalaxyGameResult`, migration 048):
- the board it dealt: the mode, the seat count, the house relations and, on a
  Partial Schism, the worlds that split;
- the ending, the turn count and the seat that moved first;
- each seat's faction, world, house, role and side, and its own board number;
- whether the seat was human or AI (with the AI's difficulty);
- whether it was credited with the win, eliminated or resigned.

Every other game records nothing. The dealt board otherwise lives only in the
game's state snapshots, which are pruned 7 days after the game ends.

**How it reads.** The report (`GET /api/admin/metrics/galaxy`, admin-only) reads
win rates as the balance sim does: per seat, against the seat's fair share of its
game, 1 / sides. Each rate shows a 95% interval and the gate's ±28% band, since
a handful of playtests reads nothing like 1,260 sim games. The report covers:
- faction, role, Schism house, and human against AI;
- the first seat;
- how games ended and the boards played;
- the newest games, seat by seat.

The filters are the window, the seat count, the board and the house relations.
Finished games from before the report started recording are counted but not
described.

## Build order

1. **Colonies (two and three players)**, the seat guard, per-seat Sovereignty
   and sims at every count. **Done.**
2. **Schism at eight**, with shared kits, the Lane Crown, and Concord / Civil
   War. **Done.**
3. **Allied houses**: shared victory, no friendly attacks, shared vision, team
   UI. This also enables 2v2 at four. **Done.**
4. **Partial Schism (five to seven)**: a house alone on each unshared world,
   its other half unclaimed; Allied sides of one and two. **Done.**

Every step is admin-only and measured on the balance sim before it merges.
