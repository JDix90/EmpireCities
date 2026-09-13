# Warfront — real-time strategy mode (experimental design)

> **Status: experimental.** Nothing in this document is scheduled or committed to.
> It records a design exploration from 11–12 September 2026 for a possible second game
> mode. Do not treat any number here as a spec — the economy figures are deliberate
> first guesses for a simulation harness to correct. If you are an agent looking for how
> Borderfall works today, you want [ARCHITECTURE.md](ARCHITECTURE.md), not this file.
>
> **What exists (Slice A, step 1 only):** the simulation core
> [`packages/warfront-sim`](../packages/warfront-sim/README.md), the terrain pipeline
> (`pnpm run build:warfront-terrain` → `database/warfront/`), and the admin gate: the
> `warfront_enabled` flag (off) behind an Admin → Warfront tab whose endpoints require an
> admin server-side. Nothing is playable; steps 2–7 below are not started.
>
> Companion artifact (private, interactive: hoverable map, draggable match timeline):
> <https://claude.ai/code/artifact/a905db1e-90e7-4242-89a3-5fe5c9bc28df>

**Working title:** Warfront.
**One line:** Earth is the map, geography is the rules, history is the flavour.

---

## 1. The thesis

Warfront is a **second game that borrows Borderfall's world**, shipped as a mode. It is
not Borderfall with a battle screen. What does *not* carry over: the turn engine, attack
resolution, the replay format, the AI commander decision loop. What *does*: maps,
provinces, eras, frontiers, victory formats, lobby, accounts, stats, the clip exporter.

Seven design answers ruled out every hybrid:

| Answer | Consequence |
|---|---|
| Base building with workers | A battle has a floor of ~6 minutes before anything meaningful happens |
| Live and symmetric, both players present | No asynchronous sieges; both players' time is conscripted |
| 15–45 minute games | Sequential battles inside a turn-based map need hours |
| Real-time defence required | The Clash-of-Clans pre-placement model is out |
| Real terrain | Coastlines, rivers, elevation, biomes |
| AI commanders command and build | Bots need full macro, not auto-resolve |
| A mode, not a fork | Shares the world and the account, not the engine |

Doing the arithmetic: six players × three commanded battles each is ~2.5 hours run
sequentially. Parallel battle rounds fit the clock but force attacks into perfect
pairings and leave most of the war auto-resolved, which contradicts the second answer.

**What survives is one continuous real-time match where every province is fought over
live.** That game already exists twice — *Rise of Nations* (borders, attrition, ages,
under an hour) and *Northgard* (territory tiles, assigned villagers, ~40 minutes).
Warfront is that game on real geography.

The hybrid's fatal component is the **hand-off**: a turn-based map that suspends into a
separate battle screen puts idle players and a second clock inside a game that must end
in 45 minutes. Removing the hand-off is the entire design. "Focusing on a territory"
becomes a camera move, not a mode switch.

---

## 2. Decision log

All decisions below are confirmed. The twelve marked *(confirmed 12 Sep)* were drafted
overnight against the repo's own map data and ratified the following morning.

### Shape

1. A separate game on Borderfall's world, shipped as a mode.
2. One continuous real-time world. The turn-based game is untouched.
3. Base building with workers, **assigned Northgard-style, never clicked**. Worker micro
   is the APM sink that makes multi-seat FFA unplayable.
4. Live and symmetric. The defender is always present — human or bot.
5. Games of 15–45 minutes. The slice targets 20–25.
6. Real terrain, stylised: coastlines, rivers, two elevation tiers, a few biomes.
   Continuous height is illegible in an RTS; terraces are why StarCraft has cliff levels.
7. AI commanders will command and build. Bots begin as scripted policies driving the
   same command API as humans.
8. Free-for-all as the core, with placement scoring. Teams later, as a format.
9. Vertical slice on Europe, **supporting two to four humans** — a 1v1 cannot prove the
   FFA. (Originally "from day one". Decision 32 keeps the requirement and moves the
   netcode that delivers it behind the solo fun test.)
10. Fixed historical seats per matchup.
11. Sea lanes as the permanent first-release abstraction. No ships.
12. Hidden convoys; lighthouses, ports and scouts are the counter.
13. Britannia is the prize, contestable by all, never a seat.
14. The headless lab is in scope for the slice.
15. **Slice A is the fun test; Slice B adds** the council, doctrines, the Britain region,
    province traits and loot. If A is not fun, B will not save it.
16. Tribes raid border provinces from minute two.
17. Per-seat doctrine hands with historical flavour, drawn from a shared trait library.
18. Marching camps in Slice A — without a counter to attrition, invasion is impossible.
19. Majority of provinces wins outright; otherwise placement at the cap, ties broken by
    cumulative province-minutes.

### Ratified from the overnight draft

20. **Fourth seat is Carthage**, not Germania Superior. *(confirmed 12 Sep)*
21. The slice map is the **western twenty provinces** of the Roman 117 map, not all 41.
    *(confirmed 12 Sep)*
22. Default 1v1 is **Rome vs Gaul**; Rome vs Carthage is the second matchup.
    *(confirmed 12 Sep)*
23. Add the **Tin Route** — one long Atlantic lane, Lusitania to Britannia.
    *(confirmed 12 Sep)*
24. **Eight rules** in Slice A, the truce included, not seven. *(confirmed 12 Sep)*
25. **Food upkeep**: villagers and soldiers eat. *(confirmed 12 Sep)*
26. **Ownership is public; positions are fogged.** *(confirmed 12 Sep)*
27. Disconnects **idle the empire** for the slice; AI takeover arrives with the
    commanders. *(confirmed 12 Sep)*
28. Passes and the forest mask are **hand-curated** for the slice; elevation and rivers
    come from data. *(confirmed 12 Sep)*
29. **15 simulation ticks/second**, snapshots at 10/second, commands scheduled two ticks
    ahead. *(confirmed 12 Sep)*
30. Match cap **25 minutes at four seats, 20 at two**. *(confirmed 12 Sep)*
31. Working title **Warfront**. *(confirmed 12 Sep)*

### Revised on measured evidence

32. **The lab's bots move into Slice A as the live solo opponent, and netcode moves
    after them.** *(13 Sep)* Slice A originally specified two to four humans from day
    one with no bots. A production funnel report made that unsatisfiable: over thirty
    days Borderfall saw 82 landing views, 25 signups, and **D1 retention of 0 out of
    33**. Concurrent players are effectively zero, so every Warfront playtest would
    require recruiting and scheduling people, and the fun question would be answered
    weekly at best. The six policy bots were already scheduled inside Slice A for the
    lab and already drive the same command API a human does, so wiring them in as
    opponents costs almost nothing and turns playtesting into a daily solo loop. Netcode
    is the largest item in the slice and the least urgent while there is nobody to play
    against, so it moves behind them. Nothing is cut; the order changes.

---

## 3. The world of Slice A

The slice does **not** use the Ancient board's Gaul and Hispania — they are far too large
to be RTS objectives. It uses
[`database/maps/community_roman_empire_117.json`](../database/maps/community_roman_empire_117.json),
which already carves the Mediterranean into 41 provinces with real coastlines and
already types every border in its `connections` list: **54 land, 26 sea**. The sea links
are the lanes. Nothing about the world needs drawing.

Slice A uses the **western twenty**: `italia_north`, `italia_central`, `italia_south`,
`sicilia`, `sardinia_corsica`, `tarraconensis`, `baetica`, `lusitania`, `narbonensis`,
`aquitania`, `lugdunensis`, `belgica`, `britannia`, `germania_inferior`,
`germania_superior`, `raetia`, `noricum`, `mauretania`, `numidia`,
`africa_proconsularis`.

### The four seats, measured

Reach counts western provinces within *n* hops by land or lane. Raid exposure is the
count of neutral land borders — where tribes come from. All figures are computed from the
map's own adjacency list, not estimated.

| Seat | Province | Character | 1 hop | 2 hops | 3 hops | Land | Lanes | Raid exposure |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Rome** | Italia et Roma | Spine of Italy, two lanes, islands contested both sides | 4 | 5 | 7 | 2 | 2 | 2 |
| **Carthage** | Africa Proconsularis | One land neighbour, three lanes; the sea power | 4 | 4 | 6 | 1 | 3 | 1 |
| **Gaul** | Lugdunensis | Widest land frontier, Germanic border, one hop from Britannia | 5 | 4 | 6 | 4 | 1 | 4 |
| **Hispania** | Tarraconensis | Richest first ring, lanes to Africa and Sardinia | 6 | 6 | 6 | 4 | 2 | 4 |
| *rejected* | *Germania Superior* | *One hop from Gaul, no coast, only 3 provinces at 3 hops* | *4* | *5* | *3* | *4* | *0* | — |

Every seat is at least two hops from every other. Gaul and Hispania eat the raids;
Rome and Carthage fight over the islands. Four seats, four different games.

### Where the fighting will be

Nearest-seat analysis marks the provinces tied between seats — battlegrounds the map
creates on its own:

- **Sardinia et Corsica** — equidistant from Rome, Carthage and Hispania. A three-way
  island fight, lane-only, from the first minutes.
- **Sicilia** and **Magna Graecia** — between Rome and Carthage. The Punic War, on
  schedule.
- **Narbonensis** and **Aquitania** — between Gaul and Hispania, Pyrenees in the middle.
- **Raetia** — between Rome and Gaul across the Alps. Whoever holds the pass holds the
  door.
- **Britannia** — one hop from Gaul, two or more from everyone else. The Tin Route fixes
  that from the south; Belgica and Germania Inferior are the other doors.

The map is **unfair on purpose, and priced**. Real geography gives Hispania the best
first ring and Gaul the longest frontier. Self-play in the lab measures it; doctrine
exclusives (Slice B) are the dial; starting bonuses do the pricing until then.

---

## 4. The eight rules

Slice A ships with **eight rules a player must know**, every one visible on screen at the
moment it applies, and **every one with a bot policy written before it leaves the
slice**. Uniqueness that bots cannot play is uniqueness only humans can be beaten by.

| # | Rule | What it does | On screen |
|---|---|---|---|
| I | **Colonise, and it costs more each time** | A neutral province joins when a villager plants a seat and pays food. Price rises with holdings, so the leader slows and the small player expands cheaply. | Price on the province panel, red when unaffordable |
| II | **Villagers are assigned, never clicked** | Trained at the seat, assigned to farm/lumber camp/mine by clicking the building. They gather alone, eat every minute, die to raids. | Villager counts per job on the province panel |
| III | **The seat is the province** | Hold the seat, hold the province. Rams reduce it; its tower fires on its own; when it falls a claim takes 45s with a villager present. | Claim timer over the seat, visible to everyone nearby |
| IV | **Terrain is the rule set** | High ground extends range and vision; forests slow cavalry and hide infantry; rivers cross at fords; mountains at passes. | Terrain tiers shaded; fords and passes iconed |
| V | **The sea is a lane, and convoys are hidden** | Embark at a port, arrive after transit. Nobody sees the convoy unless a lighthouse, port or beach scout covers the lane. Landing on a beach you don't own: 20s at half armour. | Revealed convoys show size and arrival; beaches glow during a landing |
| VI | **Tribes raid from minute two** | Every neutral province is a tribe's home. They raid neighbours' border provinces, take villagers and loot, and retreat. Colonising the home ends that source. Raids scale with clock and with the victim's holdings. | Alert with a jump key; raiders always visible inside your borders |
| VII | **Attrition, and the marching camp** | Inside enemy borders your army bleeds. Five+ soldiers can build a camp that stops attrition in its radius; the defender can burn it. Camp first, then rams. | Bleed icon on units; camp radius drawn while it stands |
| VIII | **Truce, with a public countdown** | Propose, both accept, neither can attack. Breaking it starts a one-minute countdown every player sees. Alliances and betrayals with no chat required. | Truce banners on the overview; countdown as a global alert |

Scoring is the format, not a rule to learn: majority of provinces wins outright;
otherwise placement at the cap by provinces held, ties broken by cumulative
province-minutes.

---

## 5. Economy and roster

**Every number below is a first guess anchored to the pacing arc, written so the lab has
something to disagree with.** None should survive a thousand simulated matches unchanged.

### Resources

| Resource | Source | Spends on |
|---|---|---|
| Food | Farms on plains | Villagers, colonisation, soldiers, upkeep |
| Timber | Lumber camps in forest | Buildings, walls, rams, ports |
| Silver | Mines in hills | Soldiers, towers, lighthouses. Britannia's tin counts as silver at double yield |
| Population | Seat gives 10, each house 5 | The real army cap |

**Upkeep:** 3 food/min per villager, 4 per soldier. Starvation bleeds like attrition.
**Start:** seat, 4 villagers, 1 scout, 200 food, 100 timber.
**Colonise:** 80 food × 1.4 per province already held.

### Yields per villager per minute

Farmer 12 food (9 net of their own meal) · Woodcutter 8 timber · Miner 6 silver (12 on
tin) · Builder assigned to a construction, two halve the time.

### Units

| Unit | Role | Cost | Pop | Train | Notes |
|---|---|---|---:|---:|---|
| Villager | Economy | 40 food | 1 | 20s | Assigned to buildings; plants seats |
| Scout | Vision | 30 food | 1 | 10s | Fast, fragile; reveals beaches and lanes it stands on |
| Spear | Line | 40 food, 15 silver | 1 | 15s | Beats cavalry; tougher when 5+ are grouped |
| Archer | Ranged | 40 food, 20 silver | 1 | 15s | Beats spears; range and vision grow on high ground |
| Skirmisher | Raider | 30 food, 10 silver | 1 | 12s | Fastest infantry, loots villagers, loses any straight fight |
| Cavalry | Shock | 80 food, 40 silver | 2 | 25s | Beats archers and skirmishers; slowed by forest |
| Ram | Siege | 100 timber, 40 silver | 3 | 40s | The only thing that reduces a seat in reasonable time |

Combat is a triangle — **spear → cavalry → archer → spear** — plus a raider that loses
every straight fight and a siege engine harmless to units. Terrain *modifies* the
triangle rather than adding to it. No formations, no morale, no healing in the slice.

### Buildings

Seat (planted by colonising; 10 pop, trains villagers and scouts) · House (40 timber, 5
pop) · Farm (40 timber, plains slot) · Lumber camp (30 timber, forest slot) · Mine (60
timber, hills slot) · Barracks (80 timber) · Tower (60 timber, 20 silver; fires on its
own) · Wall/gate (15/25 timber per segment) · Port (80 timber, coastal slot; embark
point, reveals its own lanes) · Lighthouse (40 timber, 20 silver; reveals lanes within one
province) · **Marching camp** (built by 5 soldiers in 30s, no cost, burnable).

Every province has a handful of build slots and resource nodes set by biome, so *where*
you colonise decides *what* you can make.

### Sieges and attrition

Seat 1500 HP; its tower deals 8/s at 6 cells · Ram 30/s against buildings, nothing
against units · Claim 45s with a villager present · Attrition 1% of health per 10s
outside your borders and outside a camp.

---

## 6. A match, minute by minute

The arc the design intends. **The lab's first job is to confirm the simulation actually
produces it; its second is to say where it doesn't.**

| Minute | Phase | A typical empire | Threats | What matters |
|---:|---|---|---|---|
| 0 | Founding | 1 province, 4 villagers, scout leaving | None yet | Second villager, first farm, scout the nearest neutrals |
| 2 | First raid | 6 villagers, colonising the first neutral | First tribal raid on a border lumber camp | Two spears at the seat, then a second colony |
| 4 | The land rush | 3 provinces, 9 villagers, first mine | Raids every 90s from each neutral border | Take the contested neutral before the neighbour |
| 6 | Contact | 4 provinces, barracks, port if coastal | Rival scout on your border; a rusher arrives now | Towers on the shared border, lighthouse on the exposed coast |
| 8 | Raiding season | 5 provinces, ~24 villagers, first cavalry | Skirmishers on your lumber camps; a hidden convoy may be at sea | Trade raids and win the exchange |
| 10 | Rams | Silver funds a siege train | A camp goes up inside your border | Burn the camp, or march before theirs is built |
| 13 | The first siege | Economy plateaus; every slot built | A neighbour reduces a seat; the quiet third player means Britannia | Relief force, or take the prize while they're busy |
| 16 | Betrayal | Loot matters more than new colonies | A truce countdown appears on the overview | One minute to move everything to the right border |
| 20 | The decisive push | Armies at pop cap; food is the constraint | The leader is one province from majority | Take any seat before the cap; every province-minute counts |
| 24 | The cap | Nothing new is built | Everything | Hold for 60 more seconds |

---

## 7. The sea and the prize

No ships in the first release, and yet the sea must be where games are won.

### Lanes

- A lane is a **typed sea link in the map data** — 14 inside the western twenty, three of
  them into Britannia from Lugdunensis, Belgica and Germania Inferior.
- Units embark at a port you own. Transit 1–2 minutes by lane length. Port level caps
  convoy size.
- Own the far port and units walk off. Otherwise they land on a **beach** and spend 20s
  disembarking at half armour. Islands have several beaches so one tower can't seal them.
- A convoy at sea **cannot be attacked** — the fight is always on the shore. A besieging
  army on an island is a commitment, not a raid.

### Hidden convoys and what sees them

- Nothing sees a convoy by default. A **lighthouse** reveals lanes within one province; a
  **port** reveals its own lanes; a **scout on a beach** reveals that beach's lane.
- A revealed convoy shows size and arrival time, which makes a **decoy convoy** toward one
  beach and the real force toward another a genuine play.
- The attacker is blind too — scout the beach or land into a garrison.
- Coastline becomes a cost paid in silver and attention. Walling the Alps and ignoring the
  Channel deserves what lands at Dover.

### The Tin Route

Today only Gaul is one hop from Britannia; everyone else must first take a Channel coast
province. One additional lane fixes it: a long Atlantic crossing **Lusitania → Britannia**,
the tin route Carthaginian traders really sailed from Gades to Cornwall. Three-minute
transit, revealed only by its two ends. **One line in the map's `connections` list.**

### Why the prize must become a region (Slice B)

A single province is first-come, first-owned — the second player to arrive is sieging,
not contesting. A region stays contested because control is partial and rewards are
incremental.
[`database/maps/community_britain_925.json`](../database/maps/community_britain_925.json)
already carries 14 kingdoms with real polygons; merged into ~6 Roman-era provinces they
become a contest.

- Each Britannic province **scores per minute held** and yields tin nowhere else provides.
- Holding a majority of the island for a sustained spell pays a **larger bonus**.
- **Loot**: a mine you overrun pays silver even if you fail to hold it, so a failed landing
  is not a wasted convoy.
- Native tribes there are stronger — a mid-game objective, not a minute-three grab.

In Slice A, Britannia is one high-value province with several beaches, its three lanes,
and the Tin Route.

---

## 8. Free-for-all, made to work

FFA is the harder design and the right one for this world. It fails in four known ways;
each has a mechanical answer in the slice rather than a hope.

| Failure | Answer |
|---|---|
| **Early elimination** | Placement scoring (feeds the existing final-rank field). Elimination is slow by design: capital seats are fortresses, attrition punishes deep invasions, and a player reduced to one province can still raid and score |
| **Kingmaking** | When third beats fourth on your rating, you fight for third instead of gifting first. The truce's public countdown makes alliances real and betrayal telegraphed |
| **Turtling** | Colonisation cost slows the leader but not the turtle, so: raids scale with holdings and frontier length, and the majority format ends on the clock with the turtle losing on points. In the full game, era advancement gates on breadth |
| **Attention** | Alerts with a jump key, self-defending seats and towers, raiders always visible inside your borders, and (Slice B) the council pulse |

**Ownership is public** on the overview — everyone sees who holds what, which is the
strategic information an FFA runs on. **Where the armies are stays fogged.** That split
lets a four-player game be read at a glance and still hide the landing at Dover.

---

## 9. Council and doctrines (Slice B)

Every five minutes the world pauses for 20 seconds. Each player picks one doctrine from a
hand: a shared pool plus two or three **exclusives only their seat can draw**. Truces get
proposed in that window because it's the only time nobody is being raided. It adds a
strategic layer with no second engine.

Three rules keep it balanceable:

1. **Exclusives modify, never add.** They change numbers on existing units and rules. No
   seat gets a unit type the others lack. This is the Age of Empires / Northgard model.
2. **Exclusives are the seat pricing.** Self-play measures the imbalance; exclusives are
   the dial. Weak seats get stronger edges.
3. **A trait library makes it scale.** Horse lords, sea people, mountain folk, miners,
   engineers, raiders. Each seat on each map is tagged with two or three by what it
   actually was, so a new map's seats get identity for the cost of tagging. Bots pick
   doctrines by their seat's traits — which is where AI commanders get personality.

| Seat | Traits | Exclusive doctrines (illustrative) |
|---|---|---|
| Rome | Engineers, Roads, Discipline | **Roads** faster movement inside your borders · **Engineers** cheaper rams, faster camps · **Discipline** grouped spears take less damage |
| Carthage | Sea people, Traders, Mercenaries | **Mariners** shorter transit, bigger convoys · **Silver Trade** richer mines · **Mercenaries** soldiers cost silver only |
| Gaul | Oppida, Horse lords, Forest folk | **Oppida** cheaper walls and towers · **Chariots** faster cavalry · **Forest Warriors** infantry hidden in woods until they strike |
| Hispania | Miners, Mountain folk, Guerrilla | **Silver Veins** richer mines · **Guerrilla** skirmishers hit harder on high ground · **Passes** ignore the pass penalty |

> **The honest cost.** Exclusives tie identity to the *seat*, and seats are assigned by
> matchup. Players will want Rome and be handed Hispania. Series play must rotate seats
> and rating must normalise by seat, or the leaderboard measures seat luck. Every
> exclusive is also a rule a bot must understand before AI commanders can be real
> opponents.

---

## 10. Engineering

One deterministic simulation package, three hosts. **Nothing touches existing game code.**

```
 Browser client (one per seat)            Match host (one worker per match)
 ├ PixiJS tactical plane                  ├ deterministic sim @ 15 ticks/s
 ├ input, control groups, province panel  ├ command queue, +2 ticks ahead
 ├ snapshot interpolation @ 60fps         ├ fog filter per seat
 └ replays re-simulated locally           └ emits seed + command log
            │  commands ──────────────────────▶ │
            │ ◀────────── fog-filtered deltas (10/s)
                                                │ result, placement
                                                ▼
                                   Borderfall backend (as today)
                                   Fastify · Socket.io · Postgres · Redis
                                   lobby, auth, seat assignment, stats,
                                   feature-flagged, dark-launched

 warfront-sim (one package: pure TS, fixed-point ints, seeded RNG, no DOM)
   └ runs in the match host, re-runs in the client for replays,
     and runs headless in the lab at 100× speed

 Terrain pipeline (offline)  ──▶ cell-grid map asset ──▶ host, client, lab
```

### Simulation

- **Fixed-point 16.16 integer maths**, a seeded generator, **no floating point and no
  unseeded randomness anywhere in the package**, enforced by a lint rule. One stray float
  silently breaks replays *and* the lab.
- **15 ticks/second.** Commands stamped two ticks ahead so every client applies them at
  the same tick.
- Small entity store, flow-field pathfinding on the cell grid, separate passability for
  land and for the lane graph. Antimeridian is out of scope for a Mediterranean map.
- Determinism is not optional even though the server is authoritative: it makes a replay
  a **seed plus a command log**, and it makes the lab trustworthy.

### Netcode

- **Server-authoritative.** Clients send commands, receive deltas at 10/s filtered by
  their own fog, interpolate to 60fps. Map hacks are impossible by construction.
- Reconnect is a full snapshot. A disconnected seat **idles**: villagers keep working,
  soldiers hold, 60 seconds of grace.
- **Why not lockstep:** the slowest client stalls everyone, every client holds full state,
  and cross-browser float drift is a real risk. Hosting cost (~one core per match) is the
  price.

### Terrain pipeline (offline, committed as assets)

- Rasterise the Roman 117 province polygons — which
  [`frontend/src/utils/globeTerritoryGeometry.ts`](../frontend/src/utils/globeTerritoryGeometry.ts)
  already produces — into a cell grid at ~200 cells across a mid-sized province. Per cell:
  owner, elevation tier, passability, biome, ford and beach flags.
- Elevation from a public global model, terraced to two tiers. Rivers from Natural Earth
  10m centrelines — the six or seven that matter: Rhine, Danube, Rhône, Po, Ebro, Loire,
  Seine.
- **Passes and the forest mask are hand-curated** for Europe: the Alpine and Pyrenean
  passes are a list of six, and a painted forest layer beats any land-cover dataset at
  this scale.
- Regenerated by script, never edited by hand, committed next to the existing geo files.

### Testing

- **Golden replays**: a seed and a command log must hash to the same final state every
  run. Whole-sim regression in seconds of CI.
- **Pacing invariants as tests**: with the standard bots, first contact lands between
  minutes 4 and 8 on every seat pair, or the build fails.
- Rendering is tested by eye in the 20 playtests, not by CI.

### What the repo already gives us

| Carries over | How |
|---|---|
| Roman 117 and Britain 925 maps | Provinces, centre points, typed land/sea connections. **The lane graph is already authored** |
| Globe geometry builder + geo files | Produces the exact polygons the terrain pipeline rasterises; the clip projection is the seam for a later globe zoom |
| Eras and frontier unlock indices | In-match eras (later slice) map onto the same ladder and the same frontier rules |
| Victory formats | Blitz, majority, capitals, conquest become match formats with time caps |
| Lobby, auth, Socket.io rooms, stats | Seat assignment and results flow through what exists; placement writes final rank |
| Feature flags and admin config | Dark-launched behind a flag per the repo's own convention |
| AI commander personalities | Become trait tags on bots; the strategic target logic is the shape of the bots' macro layer |
| Clip exporter | The stories: the Alps stand, the Dover landing, the council betrayal |

---

## 11. The lab

Because the simulation is deterministic and headless, it runs at **100× speed with no
renderer**. Scripted bots play thousands of matches overnight, and the numbers in §5 get
corrected before a human ever sees them.

**Bots are policies, not intelligence** — fixed build orders with a few timing
parameters, driving the same command API a human does. Because they drive that API, the
same six are wired into the running game as the **solo opponent** (decision 32), which is
what lets one person play a full match before any netcode exists. They are also the seed
of the AI commanders (policy + seat traits + difficulty cheats):

`Colonist` (baseline: expand as fast as price allows, defend) · `Raider` (early
skirmishers, harass lumber camps) · `Turtle` (walls and towers, never past 3 provinces) ·
`Rusher` (attack the nearest seat at minute 6) · `Islander` (Britannia by lane as early as
a port allows) · `Mariner` (Carthage's game: ports first, islands second).

| Design question | Metric | Pass looks like |
|---|---|---|
| Does the economy pace as drawn? | Time to first contact; army size at 5/10/15 min | First contact between 4 and 8 min on every seat pair |
| Does colonisation cost stop snowballs? | Leader-to-second economy ratio over time | Ratio under 2 through minute 15 in Colonist mirrors |
| Is elimination too fast? | Distribution of elimination times | No elimination before minute 12 outside Rusher games |
| Decision or clock? | Share ending on majority vs cap | ≥⅓ of four-seat games end on the clock |
| Is the prize bait or balanced? | Britannic control churn; Islander placement | Islander places 2nd or better as often as Colonist |
| Do landings work? | Landing success vs lighthouse and blind defenders | Lighthouse defenders repel most; blind defenders lose most |
| **Are the seats fair?** | Win rate per seat in same-bot self-play, every permutation | No seat above 55% in four-seat mirrors before pricing |

**Seat fairness by self-play is the first thing to build.** The same bot in every seat,
every permutation a few hundred times, and the win-rate deviation *is* the map's
imbalance as a number. Then starting bonuses move until it flattens. "Rome is
overpowered" stops being a forum argument.

**What the lab cannot tell you:** whether anything is fun, whether humans find the
lighthouse in time, whether the council feels like a breath or an interruption. It sets
the numbers so the first playtest is about feel, not about a broken economy.

---

## 12. Roadmap

Ordered, sized relative to each other, **undated**. The slice ends at a go/no-go on fun,
and nothing after it is scheduled until that answer exists.

### Slice A — the fun test

Reordered 13 September against decision 32. The steps are the same work; what changed is
that a **playable single-player Warfront arrives at step 4 instead of after step 6**, and
the largest item in the slice stops blocking the only question the slice exists to answer.

1. **Simulation core and terrain pipeline** (large) — the package, determinism tooling,
   the cell grid for the western twenty, golden replay tests.
2. **Renderer, input, province panel** (medium) — PixiJS plane, selection, control groups,
   assignment by click, alerts with a jump key.
3. **Economy, colonisation, tribes, capture loop** (medium) — rules I, II, III, VI. This is
   the game; everything before it is scaffolding and everything after it is reach.
4. **The lab, and its bots as the live opponent** (medium) — runner, six policy bots,
   metrics, seat self-play, pacing invariants in CI. The same bots are wired into the
   running game, so **one person can play a full match from here on**. This is the step
   that changes the schedule: the fun question becomes a daily loop instead of a
   scheduling problem, and the bots are needed for launch regardless (see Liquidity under
   Risks), so none of it is throwaway.
5. **Lanes, hidden convoys, lighthouses, beaches, camps, truce** (medium) — rules V, VII,
   VIII, and the Tin Route.
6. **Netcode for 2–4 humans** (large) — match host worker, fog-filtered deltas, reconnect,
   seat assignment through the existing lobby. Last because it is the biggest piece and
   the least urgent while there is nobody to play against.
7. **Twenty playtests** (small in code, decisive in outcome) — ten at two seats, ten at
   four, with **recruited** humans rather than organic ones, because there are none. The
   metric is whether people ask to play again, and whether geography showed up in their
   decisions: did anyone hold a pass, ford a river, or take Britannia by lane because the
   mainland was walled.

Steps 1 through 4 are a complete solo game and the real go/no-go. If it is not fun against
a bot on real European terrain, steps 5 and 6 will not rescue it, and the slice should stop
there having cost the smaller half of its budget.

### Slice B — unique becomes unmistakable

The council pulse and doctrines, the trait library, the four seat hands · Britannia as a
six-province region with incremental rewards and loot · province traits (Tarraconensis
mines faster, Belgica breeds horses).

*(The scripted dummy defender that used to sit here is gone: decision 32 puts the real
policy bots in Slice A, which does the same job better and earlier.)*

### Beyond the slice, in rough order

Eras inside the match on the existing ladder · the globe overview as the zoomed-out view
of the same state, through the clip projection · AI commanders (bots + traits +
difficulty cheats) and disconnect takeover · replays and clips from the seed and command
log · matchmaking, seat rotation in series, seat-normalised rating, onboarding as a
guided first match · the rest of the Roman map, then the world eras · **ships, when the
lanes have earned them**.

---

## 13. Risks

None of these is a reason not to build the slice. All of them are reasons the slice
exists.

**Product**
- **Audience split.** Turn-based globe players and RTS players are different people. The
  mode may dilute both; the shared world and account is the bet that it cross-pollinates.
- **Liquidity.** Live symmetric play needs humans online together. A small base fills 1v1
  plus bots, not four humans on demand — **AI commanders are not optional for launch**.

**Design**
- **The slice cannot prove the FFA at two seats.** Four-human playtests are mandated for
  this reason, and gathering four people is the slowest part of the schedule — now more
  so, since the funnel report says there is no organic pool to draw them from and every
  session has to be recruited. Decision 32 does not fix this. It only stops the *solo*
  fun question from waiting on it.
- **Assigned workers may be dull at two seats.** The pace that saves six-seat FFA can bore
  a 1v1. The fix is faster tribes and cheaper raids, **never** a drift back to worker
  micro.
- **Seat capture may become town-hall killing.** If every fight reduces to ramming one
  building, terrain stops mattering. Raids and attrition must make field battles worth
  fighting.
- **Real terrain is unbalanced forever.** Competitive players will call it unfair;
  strategy players will call it the game. Seat rotation, seat-normalised rating and the
  self-play lab are the only honest answers.
- **Surprise landings will feel unfair to someone.** Hidden convoys guarantee it. The
  lighthouse must be cheap, obvious and taught in the first minute, or the fix is a faster
  reveal — not a visible convoy.
- **Uniqueness is a teaching cost, twice.** Eight rules for humans in their first match,
  and eight bot policies before any commander is a real opponent. Every Slice B mechanic
  adds to both bills.

**Engineering**
- **Deterministic fixed-point in TypeScript is unforgiving.** One float, one unseeded
  random, and replays and the lab both silently diverge. Expect the early divergence bugs
  to be miserable to find.
- **Four humans from day one roughly triples netcode scope.** It is the single biggest
  reason the slice is months rather than weeks. Decision 32 moves that cost behind the
  fun test rather than removing it, which means a no-go verdict at step 4 avoids paying
  it at all.
- **The lab tunes for scripts, not people.** Over-trust it and you ship a game balanced for
  build-order bots that humans immediately break. It sets the starting point; the
  playtests set the game.
- **Two engines forever.** Balance, bugs and content double once the mode ships. The shared
  world and data are what keep that from being two teams' worth.

---

## Provenance

Drafted from the design thread of 11–12 September 2026, with the Slice A ordering revised
on 13 September (decision 32) after a production funnel report measured D1 retention at 0
of 33 and 82 landing views in thirty days. Map data, centre points and typed
connections come from
[`database/maps/community_roman_empire_117.json`](../database/maps/community_roman_empire_117.json)
and [`community_britain_925.json`](../database/maps/community_britain_925.json); province
geometry from
[`frontend/src/utils/globeTerritoryGeometry.ts`](../frontend/src/utils/globeTerritoryGeometry.ts)
over the shipped Natural Earth files in `frontend/public/geo/`. Seat reach, raid exposure
and the contested-province analysis were computed from the map's own adjacency list.

**Nothing here is built.**
