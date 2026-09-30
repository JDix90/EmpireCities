# Galactic Age modes — one map, a game for every seat count

**Status:** in progress. Step 1 (Colonies, two and three players) is built and
measured. Steps 2–4 are the agreed design, not yet built. The Galactic Age is
admin-only; nothing here is player-facing until it opens.

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
| 5–7 | **Partial Schism** | One to three worlds shared by two houses | planned (step 4) |
| 8 | **Schism** | Every world shared by two houses | planned (step 2) |

The create route, the join cap and game start hold the era to 2–4 seats until
Schism exists (`backend/src/modules/games/lobbyCapacity.ts`). Five or more used
to get a scattered start across worlds no seat could reach.

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
- **Home Worlds off** deals the scattered start at any seat count, and there are
  no colonies.

**Balance** (1,200 games × 3 seeds, live defaults;
[GALAXY-BALANCE.md §7](../backend/scripts/GALAXY-BALANCE.md) has every table
and the sweeps behind each number):

| | Two players | Three players |
|---|---|---|
| Game length | 23.4 turns | 26.1 turns |
| Won by Lane Sovereignty | 45% | 38% |
| Turn-10 leader wins | 73.5% | 62% (four players: 62%) |
| Faction win rates | Sol 55, Rust 40, **Verdan 65.5**, Nexus 39.5% | 25–39%, all inside the band |

- **Three players pass every gate.**
- **Two players pass every gate except Verdan,** 1–2 points over the band, and
  Verdan beats the Custodians in 80% of duels. The measured cause is Verdan's
  flat +2 reinforcements. In a duel, region bonuses scale down to a third while
  that +2 doesn't. Four players need the +2 to pay for Sol's Cradle, so any fix
  belongs to Colonies. The candidate is scaling flat faction bonuses with the
  seat count, the way region bonuses already scale.
- **Rejected: handing a seated Custodian their Vault ring.** It gave them 81%
  of duels.

**Code:**
- `backend/src/game-engine/state/galaxyModes.ts`: layout, garrisons, bridges.
- `galaxyRing.ts`: the ring geometry it shares with the Lane Surge.
- `state.galaxy_mode`: what a game was dealt.
- `LANE_SOVEREIGNTY_ROUNDS_BY_SEATS` in `victory/laneSovereignty.ts`.

## House relations — planned (steps 2–3)

Schism puts two houses on one world. A single lobby setting decides how they
start:

- **Concord (default).** The two houses on a world begin under a truce, using
  the existing truce system. That gives them a few rounds to face outward before
  deciding when to betray. Breaking the Concord carries the ordinary truce-break
  rules, so the betrayed house gets its defence and retaliation dice.
- **Civil War.** The houses start hostile, for chaos from turn one.
- **Allied.** The two houses are a team:
  - they cannot attack each other;
  - they win together (the engine already supports more than one winner, since
    secret-mission alliances use it);
  - they share vision under fog, and the game screen shows them as a team.

Concord is the default because it protects the opening. In the balance data the
turn-10 leader wins about 62% of four-player games. A house crushed by its
co-world rival in round two is effectively out, and that is miserable in an
eight-player game.

## Schism (eight players) — planned (step 2)

- **Two houses per world, split by lane side.** Each house holds the half of its
  world whose two gateways face one neighbour. Every house then has an enemy
  across its lanes and a rival at home.
- **Shared kits.** Both houses on a world play that world's faction: same
  abilities, different colours and names ("Mandate Loyalists" and "Mandate
  Secessionists"). Four new rival factions stay an option for later.
- **The Lane Crown.** Hold all four of your world's gateways and you control
  every lane off your world. The prize might be +2 reinforcements and an
  upgraded world rule; its numbers come from the sim. Lose a gateway, lose the
  Crown. It is **Schism-only**: in a four-player game everyone holds their whole
  world from turn one, so it would change the classic game's balance.
- **The Nexus Schism.** The two Nexus houses start either side of the neutral
  Vault, so the lane-sealing prize becomes a civil war.
- **Unification** (open question): eliminating your co-world house could hand
  you their kit ability or a permanent Crown.

Eight is the first Schism count because every world is split the same way. That
makes it the most symmetric case, and so the easiest to balance first.

## Allied houses — planned (step 3)

The team rules above, built once and used by every mode: shared victory, no
attacks between allies, shared vision under fog, and a team display. It also
unlocks **2v2 on the four-player board** almost for free.

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
    (`LANE_SOVEREIGNTY_ROUNDS_BY_SEATS`, `COLONY_GARRISONS`) that the balance
    sim can patch.
- **Every mode is measured before it opens.** `simGalaxyBalance.ts` runs any
  seat count (`SIM_PLAYERS`), rotates every faction line-up and seat, and
  reports win rates as a share of the games each faction played.
- **The gate** is four players' gate scaled by seat count:
  - decisive in 80% of games or more;
  - each faction within ±28% of 1/players;
  - no faction eliminated in more than 30% of games;
  - lanes changing hands;
  - Sovereignty a real ending, not the only one.

Built this way, other eras could adopt modes of their own later without a
rewrite. Whether any should is a separate discussion.

## Build order

1. **Colonies (two and three players)**, the seat guard, per-seat Sovereignty
   and sims at every count. **Done.**
2. **Schism at eight**, with shared kits, the Lane Crown, and Concord / Civil
   War.
3. **Allied houses**: shared victory, no friendly attacks, shared vision, team
   UI. This also enables 2v2 at four.
4. **Partial Schism (five to seven)**.

Every step is admin-only and measured on the balance sim before it merges.
