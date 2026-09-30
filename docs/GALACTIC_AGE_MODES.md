# Galactic Age modes — one map, a game for every seat count

**Status:** in progress. Step 1 (Colonies, two and three players), step 2
(the Schism, eight players, with the Concord and Civil War) and step 3 (teams:
Allied houses at eight and 2v2 at four) are built and measured. Step 4 is the
agreed design, not yet built. The Galactic Age is admin-only; nothing here is
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
| 5–7 | **Partial Schism** | One to three worlds shared by two houses | planned (step 4) |
| 8 | **Schism** | Every world shared by two houses, as rivals or, with Allied houses, as four teams | built |

The create route, the join cap and game start hold the era to 2–4 seats or 8
(`backend/src/modules/games/lobbyCapacity.ts`). Five to seven have no board yet;
they used to get a scattered start across worlds no seat could reach.

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
- **The lobby.** "Schism (eight players)" asks for eight seats and shows the
  House Relations choice. It needs Home Worlds.
  - The game starts once all eight seats are filled, with AI opponents plus
    the invited players.
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
- `lobbyCapacity.seatsPerFaction`: two seats per faction in a Schism lobby.

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
  two houses are one side: four sides of two, each sharing a faction, its kit
  and its world.
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

## Partial Schism (five to seven players) — planned (step 4)

One to three worlds are shared; the rest stay single-owner. Still to decide:
- which worlds split (fixed or random);
- a catch-up bonus for houses on a split world, which start with half a world;
- balance at each count separately.

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
    `LANE_SOVEREIGNTY_ROUNDS_BY_SIDES`, `TEAM_TUNING`) that the balance sim can
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

## Build order

1. **Colonies (two and three players)**, the seat guard, per-seat Sovereignty
   and sims at every count. **Done.**
2. **Schism at eight**, with shared kits, the Lane Crown, and Concord / Civil
   War. **Done.**
3. **Allied houses**: shared victory, no friendly attacks, shared vision, team
   UI. This also enables 2v2 at four. **Done.**
4. **Partial Schism (five to seven)**.

Every step is admin-only and measured on the balance sim before it merges.
