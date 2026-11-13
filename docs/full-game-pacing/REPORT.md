# Full Game pacing: what it is like today, and what to change

Analysis and recommendation only. No game code that players run was changed.
Every figure comes from seeded bot simulations (about 46,000 games across 217
configurations); each is given as `value [95% interval]`. Section 7 says what
the minute estimates assume, and section 6 says where real players could change
the conclusion.

## The answer

**What a Full Game is like today.** Two different games ship under the name,
and neither meets the goal.

- **The whole-board ending with the 150-round cap** never finishes against
  bots. With four Medium seats, 399 of 400 games ran to the cap: 123 minutes
  at 45 seconds a turn, 161 at 60, 236 at 90. The first seat reaches the Modern
  era at round 40 [40, 41], and every living seat is there by about round 61.
  The remaining 90 rounds, 59% of the game, are played with no era left to
  reach, while armies on the board grow from about 600 to about 4,500, captures
  fall by a third and the net movement of territory falls by four fifths.
- **The evening variant (65% of the board, 80-round cap)** is short on average
  and wrong in two directions at once. At an even table, 21% of games are over
  by round 20, on the 33-territory starting board with the winner still in the
  Ancient or Medieval era, and 42% run to the cap. For a player who is better
  than the bots it stops being a Full Game: a Hard stand-in finishes in a
  median 26 rounds, and an Expert stand-in in 11 rounds (12 minutes) with 86%
  of games over before anyone reaches the WW2 era.
- **You may be running the evening variant already.** The brief describes
  `full_game_evening_enabled` as off. In the code on `main` its default is on
  (section 1.1). Unless production pins it off with an admin override, a
  player with no saved setup gets the evening variant today.

**What I recommend.** Keep the Full Game as it is up to the ending, and tie the
ending to the eras, with four rules:

1. **Conquest counts only from the Modern era.** Holding 65% of the board wins
   the game only for a player who has reached the last era. Taking the whole
   board, or being the last player standing, still wins at any time.
2. **The Modern era lasts 12 rounds.** Twelve rounds after the first player
   reaches the Modern era the game ends, and the player holding the most
   territory wins (the rule the round cap already uses, moved to a moment the
   table can see coming).
3. **An 80-round cap stays as a backstop.** It was reached in 1% of games.
4. **Drop the era lead cap (`era_advancement_max_lead`) for these games.**
   With it, one seat that never advances keeps every other seat out of the
   last three eras for the whole game (section 3.5).

Rules 1 and 2 need new engine code; they were measured as prototypes inside the
simulation script. Rules 3 and 4 are existing settings.

**What it would change, in numbers.** Three kinds of player against three
Medium bots: one level with the bots (a Medium stand-in, wins 26–28%), one
better than them (Hard, wins 51–58%) and one far better (Expert, wins 96–97%).

| Rules | Player | Rounds: median (20th–80th pct) | Minutes at 60 s a turn: median, 80th pct | Winner is in the Modern era | Over before the WW2 era | Rounds played after the result is decided, median |
|---|---|---|---|---|---|---|
| Today: whole board, cap 150 | level | 150 [150, 150] (150–150) | 161, 163 | 100% [98%, 100%] | 0% [0%, 1%] | 72 [55, 85] |
| | better | 150 [150, 150] (150–150) | 160, 162 | 100% [98%, 100%] | 0% [0%, 2%] | 112 [101, 117] |
| | far better | 150 [150, 150] (150–150) | 157, 162 | 94% [91%, 96%] | 4% [2%, 6%] | 128 [122, 132] |
| Today: evening (65%, cap 80) | level | 62 [54, 72] (20–80) | 66, 87 | 62% [57%, 66%] | 22% [18%, 26%] | 0 [0, 0] |
| | better | 26 [19, 36] (10–80) | 25, 87 | 39% [35%, 44%] | 49% [44%, 54%] | 0 [0, 0] |
| | far better | 11 [10, 11] (7–18) | 12, 19 | 5% [3%, 8%] | 86% [83%, 89%] | 0 [0, 0] |
| **Recommended** | level | 51 [50, 51] (44–55) | 55, 61 | 96% [94%, 98%] | 0% [0%, 1%] | 0 [0, 0] |
| | better | 49 [48, 50] (39–55) | 53, 61 | 98% [96%, 99%] | 0% [0%, 1%] | 4 [1, 8] |
| | far better | 36 [35, 36] (32–42) | 38, 45 | 93% [90%, 95%] | 4% [2%, 6%] | 20 [18, 22] |

400 games a row, except "today, whole board, better" (200). At 45 seconds a
turn the recommended game is 43 minutes for the level player (80th percentile
47); at 90 seconds it is 81 (88).

The recommended rules make the game one length for nearly everyone: about 50
rounds, in which every era is played and the game ends about 12 rounds after
the Modern era begins. The cost is in the last row. A one-sided game is decided
early under any rules; today's evening variant ends it at once in the Ancient
era, and the recommended rules let it run through the eras for about 20 more
rounds. The bots' existing surrender offer gives that player a way out from
about round 14 in half of those games (section 5.2).

## 1. What a Full Game is like today

### 1.1 Which game players get

`full_game_evening_enabled` is on by default in the code on `main`:

- `backend/src/config/featureFlags.ts` line 286 reads
  `full_game_evening_enabled: () => envOptOut('FULL_GAME_EVENING_ENABLED')`,
  and `envOptOut` means on unless the environment says otherwise. The comment
  above that line still says "Dark-launched OFF"; the getter's own comment and
  `featureFlags.test.ts` ("defaults to on (promoted with the first-win
  ladder)") say on.
- `frontend/src/store/featureFlagsStore.ts` defaults it to `true`, and the
  Admin → Config description reads "On by default since the first-win ladder".

So in a database with no override for that key, the lobby's Full Game defaults
to the 65% ending with an 80-round cap for anyone without a saved setup, and
every Full Game ending is capped at 80 rounds. A player who saved a setup
before the change keeps their ending. I could not see production's
`admin_config`, so both variants are measured throughout. This is question 1 in
section 9.

### 1.2 How long games last and how they end

| Rules | Player | Ended by | Minutes at 45 s: median (80th) | at 60 s | at 90 s |
|---|---|---|---|---|---|
| Whole board, cap 150 | level | cap 100% [99%, 100%] | 123 (126) | 161 (163) | 236 (238) |
| | better | cap 98%, last standing 1% | 123 (125) | 160 (162) | 235 (237) |
| | far better | cap 84%, a bot resigning 8%, last standing 8% | 120 (124) | 157 (162) | 232 (237) |
| Evening | level | conquest 58% [53%, 62%], cap 42% [38%, 47%] | 50 (67) | 66 (87) | 95 (127) |
| | better | conquest 72%, cap 28% | 19 (67) | 25 (87) | 36 (127) |
| | far better | conquest 100% | 9 (15) | 12 (19) | 18 (28) |

The evening variant's median hides its shape. At an even table the lengths
split into two groups: 21% of games end in rounds 1–20, 46% end in rounds
71–80, and the remaining third are spread thinly between.

The whole-board ending with a strong player looks different once the bots'
surrender offer is counted. That offer exists in the live game
(`victory/surrender.ts`, on by default) and reaches a player who holds 70% of
the board and two thirds of all armies. The Expert stand-in would have been
offered it in 85% [81%, 88%] of games, at round 29 [25, 33]. A player who
always accepts would finish in a median 36 rounds (20th–80th percentile 11–68)
instead of 150. The Hard stand-in is offered it in 36% of games, at round 46;
the level player in 8%. So the 150-round figure is what a level or losing
player lives through, and what a winning player lives through only if they
decline the offer.

Waiting for bots is a small part of the clock: about 4.5 seconds a round at
four seats, 7% of the total at 60 seconds a turn. Game length in minutes is
almost exactly rounds × turn length.

### 1.3 How far players get through the eras, and when

Whole board, cap 150, four Medium seats (400 games). The spine is Ancient,
Medieval, Discovery, WW2, Cold War, Modern.

| Era reached | First seat, round | Half the table, round |
|---|---|---|
| Medieval | 13 [13, 13] | 13 [13, 14] |
| Discovery | 19 [18, 19] | 20 [19, 20] |
| WW2 | 24 [24, 24] | 26 [26, 27] |
| Cold War | 31 [31, 32] | 33 [33, 34] |
| Modern | 40 [40, 41] | 42 [42, 43] |

- Every living seat is in the Modern era by about round 61. At the cap, 91% of
  all seats are in it; the rest were knocked out or left with a few
  territories early.
- The climb is uneven. The Ancient era takes 13 rounds, a third of the climb;
  Medieval, Discovery and WW2 take 5 to 7 rounds each.
- The climb runs on a clock that barely depends on how well a seat is doing.
  The Expert stand-in holds 54% of the board at round 10, more than twice any
  Medium seat's share, and reaches the Modern era at round 37, three rounds
  before the first seat at an all-Medium table. An era's cost is a
  multiple of the seat's own income, so a richer seat pays more, and research
  is the gate most often unmet (on 57–84% of a seat's turns, against 33–66% for
  gold).
- In the evening variant the eras are often not reached at all. At an even
  table 55% [52%, 57%] of seats finish in the Modern era and 15% finish in the
  Ancient era. With the Expert stand-in, 73% of seats finish in the Ancient
  era.

### 1.4 Where the time goes

Whole board, cap 150, four Medium seats, by ten-round band:

| Rounds | Territories captured a round | Net territories changing standing a round | Quiet rounds | Armies on the board |
|---|---|---|---|---|
| 1–10 | 7.3 | 4.1 | 0% | 82 |
| 11–20 | 6.3 | 3.7 | 1% | 210 |
| 21–30 | 5.1 | 3.1 | 4% | 330 |
| 31–40 | 3.6 | 2.5 | 16% | 443 |
| 41–50 | 3.0 | 1.9 | 23% | 593 |
| 51–60 | 2.9 | 1.5 | 29% | 836 |
| 71–80 | 2.6 | 0.9 | 36% | 1,517 |
| 101–110 | 2.2 | 0.6 | 44% | 2,730 |
| 141–150 | 1.9 | 0.4 | 51% | 4,549 |

A quiet round is defined in section 2. "Net territories changing standing" is
the sum of each seat's gain or loss over the round, so a territory traded back
and forth does not count.

The game has three stretches:

| Stretch | Rounds (mean) | Minutes at 60 s | Quiet rounds | Captures a round |
|---|---|---|---|---|
| Climbing: to the first seat in the Modern era | 41.8 [40.9, 42.8] | about 45 | 8% | 5.4 |
| Arriving: until every living seat is in it | 19.2 [18.0, 20.4] | about 21 | 22% | 3.2 |
| After the ages: no era left for anyone | 88.8 [87.4, 90.1] | about 95 | 44% | 2.2 |

The first 40 rounds are eventful: the board changes hands, five eras arrive and
the map grows from 33 territories to 57. After that the game has no new content
and the board freezes. Armies grow about eightfold between round 50 and round
150 while captures fall, because every border is held by a stack too large to
attack at good odds.

### 1.5 How long the game runs after its outcome is decided

"Decided" is the first round in which one seat holds 60% of the board and twice
the armies of the next strongest seat (section 2).

| Rules | Player | Games that reach a decided position | At round | Rounds played after it, median | Share of the game |
|---|---|---|---|---|---|
| Whole board, cap 150 | level | 63% [58%, 67%] | 47 [43, 51] | 72 [55, 85] | 40% [37%, 44%] |
| | better | 74% [68%, 80%] | 26 [16, 31] | 112 [101, 117] | 58% [53%, 64%] |
| | far better | 97% [95%, 98%] | 13 [12, 15] | 128 [122, 132] | 80% [78%, 82%] |
| Evening | all three | 36–43% | 8–35 | 0 [0, 0] | 2–4% |

In the other 37% of even whole-board games nobody ever gets that far ahead, and
the game is a standoff that the cap settles. Trailing seats spend much of it
with nothing to play for: 31% [29%, 32%] of all seat-rounds are played by a
seat holding under 10% of the board.

### 1.6 Why the whole-board ending does not arrive

Leaders reach 80% of the board in a quarter of even games and still do not
finish. End-of-game boards show why. About ten territories can be reached only
by sea (Nippon, Hawaii, the Philippines, Australia, Cuba, Pacifica and four
Antarctic territories). A sea attack needs a fleet from a port on the attacking
territory, and bots rarely build the ports or launch the landings. In one
sampled game the leader held 49 of 57 territories with a stack of 3,420 next to
a rival's island holding 674 units behind a fortress, and four Antarctic
territories with one unit each were still neutral after 150 rounds.

Raising the Expert stand-in's attack limits (24 attacks a turn, 400 dice
exchanges) changed nothing: 84% of its games still ran to the cap. A person can
build ports and take islands, so a person who is winning can finish where a bot
cannot. A person who is not winning cannot be finished off by the bots either,
which is the 150-round game in section 1.2.

### 1.7 Checks of what you already knew

| Lead in the brief | What I measured |
|---|---|
| Four Medium bots, default rules: 120 of 120 games ran to the cap | 399 of 400 (the other ended with one seat left). About two hours at 45 seconds a turn: 123 minutes. Confirmed. |
| Three Medium bots and a stand-in: the cap in 99% of games | 100% with a Medium stand-in, 98% with Hard, 84% with Expert. Confirmed, except for a far stronger stand-in. |
| Evening variant ends by conquest in 63% | 58% [53%, 62%] with the bots' commander styles drawn as the live game draws them, 50% [45%, 55%] without. Somewhat lower than the comment. |
| One evening game in five runs past 87 minutes at a minute a turn | The 80th percentile is 87 minutes. Confirmed. |
| Four Expert bots: the first to advance an era wins 77% | 72% [65%, 78%] (200 games). At Hard tables 53%, at Medium 39–44%. Confirmed, and it is specific to Expert tables. |
| `era_advancement_max_lead` of 2 "never fires" (comment in `LobbyPage.tsx`) | It is the unmet gate on about 10% of seat-turns in the WW2 and Cold War eras at an even table, and it can freeze the whole table (section 3.5). Not confirmed. |

## 2. Measures for "dragged out" and "boring"

All are computed by `backend/scripts/fullGamePacing.ts` from what a server
already knows each round (territories, armies and era by seat), so they can be
tracked on live games.

**Dragged out** means the game continues after the reason to play it has gone.

- **Rounds after the result is decided.** Decided is the first round in which
  one seat holds 60% of the board and twice the armies of the next strongest
  seat. I chose it because it reads off the live board with no knowledge of the
  future, and because the seat it names goes on to win 82–99% of the time
  across the corpora (92% [88%, 94%] at an even table under today's default
  rules; a looser rule of 50% and twice the armies was right only 72% of the
  time). Report it as a median number of rounds and as a share of the game.
- **Rounds after the ages.** Rounds played once every living seat is in the
  last era, so no era is left for anyone to reach. A short one is the game's
  last act; a long one is a game outliving its content.
- **Games ending on the fixed cap.** A cap is a backstop. A game that needs it
  did not end on its own terms.

**Boring** means nothing happens on the board.

- **Quiet rounds.** A round with no era advance by anyone, no seat knocked out,
  no change of territory leader, and at most one territory captured. Report the
  share of rounds that are quiet and the share of the game spent in runs of
  five or more quiet rounds. Under today's default rules 31% of rounds are
  quiet and the median game's longest quiet run is 15 rounds.
- **Sidelined seat-rounds.** The share of all seat-rounds played by a seat
  still in the game but holding under 10% of the board. It measures how well a
  game keeps its trailing players in it.

**Reaching the eras** is the other half of the goal, and has its own measures:
the share of games whose winner finishes in the Modern era, the share of all
seats that finish in it, and the share of games that are over before any seat
reaches the WW2 era.

## 3. The levers, and how much each moves

Unless stated, each row is 200 games at a four-seat table. "Level" has a Medium
stand-in and "far better" an Expert stand-in, both against three Medium bots.

### 3.1 The ending and its threshold

Cap held at 150 so the ending's own effect shows.

| Ending | Level: rounds, median (20th–80th) | Level: over before WW2 | Level: on the cap | Far better: rounds | Far better: over before WW2 |
|---|---|---|---|---|---|
| 50% of the board | 11 (7–18) | 87% | 2% | 7 (4–10) | 100% |
| 55% | 19 (11–62) | 57% | 12% | 9 (6–13) | 96% |
| 60% | 32 (12–150) | 45% | 20% | 9 (6–15) | 90% |
| 65% | 65 (19–150) | 22% | 37% | 10 (7–18) | 87% |
| 70% | 89 (39–150) | 12% | 45% | 12 (8–25) | 81% |
| 75% | 150 (53–150) | 5% | 66% | 13 (8–33) | 73% |
| 80% | 150 (85–150) | 3% | 73% | 16 (9–41) | 60% |
| Whole board | 150 (150–150) | 0% | 100% | 150 (150–150) | 4% |
| Rival capitals | 33 (12–118) | 39% | 18% | 9 (5–18) | 87% |
| Whole board, or the last era and a wonder ("Transcendence") | 150 (150–150) | 0% | 100% | 150 (150–150) | 3% |

No threshold works. Low ones end the game in the Ancient era; high ones run to
the cap; 65% does both, depending on the game. For a strong player every
threshold ends in the first two eras. The cause is that the threshold is
counted on the board in play, which is 33 territories until the eras open the
other 24: 65% is 22 territories at the start and 38 at the end. Transcendence
never fired in 400 games, because bots do not build wonders.

### 3.2 The round cap

| Ending | Cap | Level: rounds, median (20th–80th) | Minutes at 60 s | On the cap | Seats in the Modern era | Rounds after decided | Rounds after the ages |
|---|---|---|---|---|---|---|---|
| Whole board | 60 | 60 (60–60) | 66 | 100% | 76% | 0 | 0 |
| | 80 | 80 (80–80) | 87 | 100% | 89% | 4 | 20 |
| | 100 | 100 (100–100) | 108 | 100% | 90% | 24 | 40 |
| | 150 | 150 (150–150) | 161 | 100% | 91% | 72 | 90 |
| 65% | 60 | 60 (19–60) | 64 | 54% | 48% | 0 | 0 |
| | 80 | 62 (20–80) | 66 | 42% | 55% | 0 | 3 |
| | 100 | 65 (19–100) | 68 | 41% | 56% | 0 | 7 |
| | 150 | 65 (19–150) | 68 | 37% | 56% | 0 | 8 |

A cap sets the length and nothing else. With the whole-board ending every game
ends on it, so a 60-round cap gives a 66-minute game in which the board's
leader simply wins when time runs out; for the far-better player that game is
decided by round 17 and then lasts 43 more rounds. With the 65% ending, the cap
decides only how long the standoff games last, and does nothing about the games
that end in the Ancient era.

### 3.3 Era advancement costs and gates

Whole board, cap 80, four Medium seats. The settings change when eras arrive,
not how the game ends.

| Setting (standard value) | Value | First seat in the Modern era, round | Half the table | Every living seat | Seats in the Modern era by round 60 |
|---|---|---|---|---|---|
| Standard | | 40 | 42 | 60 | 75% |
| Cost multiplier (2.0) | 1.0 | 36 | 37 | 54 | 86% |
| | 1.5 | 37 | 39 | 56 | 81% |
| | 2.5 | 46 | 48 | 63 (in 86% of games) | 69% |
| | 3.0 | 50 | 52 | 64 (in 64%) | 60% |
| Cost escalation (1.35, capped at 2.75) | 1.0 | 37 | 38 | 54 | 84% |
| | 1.7, capped at 4.0 | 47 | 50 | 66 (in 82%) | 63% |
| Tier-1 technologies needed (3) | 2 | 40 | 43 | 59 | 76% |
| | 4 | 42 | 44 | 63 | 71% |
| Stability gate (60) | 40 | 40 | 42 | 60 | 75% |
| | 75 | 41 | 43 | 57 | 78% |
| Same research and buildings for every era (prototype) | | 39 | 40 | 52 | 83% |
| The same, with cost multiplier 1.5 | | 35 | 36 | 43 | 90% |
| The same, with cost multiplier 1.0 | | 32 | 33 | 38 | 90% |

Where a share of games is given, the rest had not got there when the 80-round
cap ended them. The climb is hard to move. Halving the cost brings the Modern era forward four
rounds; the technology and stability gates move it by one or two. The later
eras' steeper research and building requirements (set on the spine, not in
settings) mostly hold back the trailing seats: removing them leaves the first
seat where it was and brings the last living seat forward eight rounds.

### 3.4 The presets

| Preset | Eras | Last era first reached, round | Every living seat there |
|---|---|---|---|
| Skirmish | Ancient to Medieval | 12 | 15 |
| Standard | Ancient to Modern | 40 | 60 |
| Epic | Ancient to Space Age | 51 (in 94% of games) | 66 (in 62%) |

Skirmish is over as an era game by round 15 and is not a Full Game. Epic adds
one era and about 11 rounds to the climb.

### 3.5 `era_advancement_max_lead`

| Lead cap | First seat in the Modern era, round | Widest gap between living seats' eras (mean) | Level stand-in wins |
|---|---|---|---|
| None | 39 | 1.93 | 31% |
| 3 | 39 | 1.93 | 31% |
| 2 (today) | 40 | 1.78 | 31% |
| 1 | 51 | 1.00 | 28% |

Between bots, a cap of 2 does almost nothing and a cap of 1 delays the Modern
era by 11 rounds without changing who wins. Its risk is elsewhere. The cap is
measured against the lowest living seat, so a seat that does not advance holds
everyone back. I measured a Medium stand-in that never advances, as a player
might who never opens the Advance Era panel:

| Rules | Lead cap | Games over before the WW2 era | Rounds, median |
|---|---|---|---|
| Today, whole board | 2 | 96% [92%, 98%] | 150 |
| Today, evening | 2 | 93% [89%, 96%] | 69 |
| Recommended endings | 2 | 96% [92%, 98%] | 80 (98% on the cap) |
| Recommended endings | none | 1% [0%, 3%] | 54 |

With the cap, that one seat keeps all four seats out of the WW2, Cold War and
Modern eras for the whole game. That is why the recommendation drops it.

### 3.6 Table size and bot difficulty

Today's rules, all seats Medium unless stated:

| Table | Whole board: first seat in the Modern era, round | Evening: rounds, median (20th–80th) | Evening: over before WW2 | Evening: on the cap |
|---|---|---|---|---|
| 2 seats | 32 | 3 (2–5) | 94% | 1% |
| 3 seats | 36 | 26 (10–80) | 44% | 22% |
| 4 seats | 40 | 62 (20–80) | 22% | 42% |
| 5 seats | 42 | 80 (37–80) | 13% | 52% |
| 6 seats | 44 | 80 (57–80) | 9% | 65% |
| 4 Easy seats | 108 (in 42% of games) | 80 (54–80) | 72% | 70% |
| 4 Hard seats | 43 | 15 (9–68) | 68% | 19% |
| 4 Expert seats | 39 | 8 (5–30) | 76% | 12% |

- A two-player evening Full Game lasts three rounds. Each player starts with
  about 16 of 33 territories and needs 22.
- Smaller tables end early and larger tables run to the cap: the same rules
  give a 3-round game at two seats and an 80-round game at six.
- Easy bots barely advance. At an all-Easy table the first seat reaches the
  Medieval era at round 37 and the Modern era in fewer than half of 150-round
  games.
- Hard and Expert tables end the evening variant in the first two eras, as a
  strong player does.

### 3.7 Mechanics beyond settings

These were prototyped in the simulation script (section 7.3).

| Prototype ending (cap 150 unless a countdown is stated) | Level: rounds, median (20th–80th) | Level: winner in the Modern era | Level: on the fixed cap | Far better: rounds | Far better: winner in the Modern era | Far better: rounds after decided |
|---|---|---|---|---|---|---|
| 65% today, for reference | 65 (19–150) | 63% | 37% | 10 (7–18) | 5% | 0 |
| 65% counted on the whole 57-territory board | 74 (41–150) | 81% | 41% | 27 (20–38) | 18% | 10 |
| 65% counts only from the WW2 era | 69 (34–150) | 69% | 36% | 23 (20–28) | 6% | 8 |
| 65% counts only from the Modern era | 79 (45–150) | 99% | 44% | 38 (34–46) | 95% | 22 |
| Whole board, and the game ends 10 rounds after the first seat reaches the Modern era | 51 (47–55) | 99% | 1% | 47 (44–51) | 95% | 31 |
| 65% on the whole board, and a 12-round Modern-era countdown (400 games) | 51 (43–55) | 81% | 1% | 27 (19–38) | 17% | 9 |
| **65% from the Modern era, and a 12-round countdown (400 games)** | 51 (45–56) | 97% | 1% | 38 (34–47) | 93% | 22 |
| The same with a 10-round countdown | 50 (44–54) | 98% | 2% | 38 (34–45) | 94% | 22 |
| The same with a 15-round countdown | 54 (45–59) | 98% | 2% | 38 (34–46) | 94% | 22 |
| The same, but the 65% falls 3 points a round during a 15-round countdown | 46 (40–52) | 97% | 1% | 38 (34–43) | 93% | 22 |
| The same as the bold row, with cost multiplier 1.5 (400 games) | 49 (43–52) | 100% | 0% | 36 (32–41) | 94% | 21 |
| Whole board, or a seat holding the "decided" position for 3 rounds wins | 102 (43–150) | 80% | 43% | 24 (11–47) | 28% | 2 |

The countdown rows carry an 80-round fixed cap, except the whole-board and
falling-threshold rows (150). All rows keep today's lead cap of 2; the
recommended configuration in section 5 is the bold row without it.

Three things follow.

- **The countdown is what fixes the long side.** Once the first seat is in the
  Modern era, a fixed number of rounds remains. In every variant with a
  countdown, the middle 60% of even-table games end between rounds 40 and 59.
- **Tying conquest to the eras is what fixes the short side.** Either way of
  doing it removes the games that end in the Ancient era. Counting conquest
  only from the Modern era also means the winner has played every era in 97% of
  even games and 93% of one-sided ones; counting it on the whole board lets a
  strong player finish around round 27 in the WW2 or Cold War era.
- **Ending the game when it is decided does not work alone.** It shortens
  one-sided games and leaves the standoffs running to the cap.

Starting the countdown when half the living seats, or all of them, are in the
Modern era changed little (51 and 56 rounds against 50). A stronger catch-up
discount (trailing seats pay 60% of the cost per era behind, down from 85%)
lowers the share of games won by the first seat to advance from 43% to 33% at
an even table, and does nothing against a far stronger player (68% either way).

## 4. A target

For a four-seat game against Medium bots, in the measures above:

| What | Target | Today, whole board | Today, evening | Recommended |
|---|---|---|---|---|
| Rounds, median | 45–55 | 150 | 62 | 51 |
| Middle 60% of games | within 40–60 rounds | 150–150 | 20–80 | 44–55 |
| Minutes at 60 s a turn, median (80th pct) | 50–60 (under 65) | 161 (163) | 66 (87) | 55 (61) |
| Winner finishes in the Modern era | at least 95% of games | 100% | 62% | 96% |
| All seats finishing in the Modern era | at least 60% | 91% | 55% | 65% |
| Games over before the WW2 era | under 2% | 0% | 22% | 0% |
| Rounds played after the first seat reaches the Modern era | 10–15 | 110 | varies | 12 |
| Rounds after the result is decided, median | 5 or fewer at an even table | 72 | 0 | 0 |
| Quiet rounds | under 10% | 31% | 12% | 9% |
| Games ending on the fixed cap | under 5% | 100% | 42% | 1% |
| Sidelined seat-rounds | under 20% | 31% | 15% | 16% |

The reasoning behind the numbers: the six eras take 40 rounds to climb, and
that clock is hard to move (section 3.3), so a Full Game that includes the
Modern era cannot be much shorter than 45 rounds. Past about round 55 the board
stops moving (section 1.4). That leaves a window of 45 to 55 rounds, about an
hour at a minute a turn.

## 5. The recommended configuration

### 5.1 What it is

The lobby's Full Game as today (Ancient start, standard preset, economy,
technology, stability, naval and events on, three bots), with:

| Setting | Today (whole board) | Today (evening) | Recommended |
|---|---|---|---|
| Ending | whole board | 65% of the board in play, or whole board | 65% of the board for a player in the Modern era, or whole board |
| When the Modern era begins | nothing | nothing | 12 rounds remain; then the most territory wins |
| Fixed round cap | 150 | 80 | 80 |
| `era_advancement_max_lead` | 2 | 2 | none |

Once any seat is in the Modern era the board is at its full 57 territories, so
65% is always 38 territories.

### 5.2 What it does

Even table (400 games): median 51 [50, 51] rounds, with 93% of games ending
between rounds 31 and 60. The Modern era begins at round 39 and is played for 12 rounds. Games
end by conquest in 32% of cases, by the countdown in 68%, and on the fixed cap
in 1%. The countdown is contested: in 20% of the games that went through it,
the territory leader when it began did not win. Being first to advance an era
is worth no more than today (the first to advance wins 41% [36%, 46%], against
39% today).

Across tables and players:

| Table | Games | Rounds, median (20th–80th) | Minutes at 60 s, median (80th) | Winner in the Modern era | Ends by countdown |
|---|---|---|---|---|---|
| Level player, 3 Medium bots | 400 | 51 (44–55) | 55 (61) | 96% | 68% |
| Better player (Hard stand-in) | 400 | 49 (39–55) | 53 (61) | 98% | 57% |
| Far better player (Expert stand-in) | 400 | 36 (32–42) | 38 (45) | 93% | 12% |
| Weaker player (Easy stand-in, wins 2%) | 200 | 48 (40–54) | 34 (56) for the player, knocked out in 59% | 97% | 52% |
| 2 seats | 200 | 33 (30–42) | 34 (44) | 93% | 23% |
| 3 seats | 200 | 46 (38–50) | 49 (54) | 99% | 60% |
| 5 seats | 120 | 53 (48–57) | 58 (64) | 97% | 77% |
| 6 seats | 120 | 54 (51–58) | 60 (65) | 94% | 90% |
| 4 Hard seats | 200 | 49 (36–55) | 53 (63) | 96% | 56% |
| 4 Expert seats | 200 | 38 (31–53) | 40 (63) | 92% | 40% |
| Medium stand-in against 3 Easy bots | 200 | 46 (39–55) | 48 (59) | 88% | 26% |
| Expert stand-in against 3 Easy bots | 200 | 32 (21–36) | 33 (37) | 72% | 1% |
| Medium stand-in that never advances | 200 | 54 (49–60) | 59 (66) | 57% | 80% |

The length holds between 33 and 54 rounds from two seats to six, where today's
evening variant ranges from 3 to 80.

For the far-better player the game is decided at round 11 and ends at round 36.
The bots' surrender would be offered in 52% [47%, 56%] of those games, at round
14 [12, 16]. A player who always accepts finishes in a median 33 rounds (20th
percentile 11), and one who declines plays on into the Modern era. That is a
choice the evening variant does not give: it ends the game for them in the
Ancient era.

### 5.3 Trade-offs

- **Two games in three at an even table end by the countdown, not by
  conquest.** The winner is whoever holds the most territory when it runs out,
  by a median of about 16 territories over second place. This is the same rule as
  today's cap. What changes is that it arrives at a moment the players caused
  and can see, 12 rounds out, in place of an arbitrary round number. If you
  want the last word to be conquest, the falling-threshold variant ends about nine
  even games in ten that way and is five rounds shorter, at the cost of a rule that is
  harder to explain.
- **One-sided games last longer than under the evening variant** (36 rounds
  against 11). This is the price of the winner playing every era. If you
  prefer shorter one-sided games, count conquest on the whole board: 27 rounds,
  with the winner in the Modern era in 17% of them.
- **35% of seats do not finish in the Modern era.** The countdown starts with
  the first seat, and the last living seat arrives about 20 rounds later.
  Lowering the cost multiplier to 1.5 is a settings-only change that lifts the
  share to 68% and gives the winner the Modern era in every game; adding the
  same gates for every era lifts it to 80%. I have left both out of the first step so
  that the ending can be judged alone.
- **A player can win without having reached the Modern era**, on territory when
  the countdown ends. The never-advancing stand-in won 40% of its games that
  way. That seems right: conquest is closed to them and the board is not.
- **An all-Easy table still runs to the 80-round cap,** because Easy bots do
  not reach the Modern era. A person at that table does reach it and starts the
  countdown (46 rounds with a Medium stand-in).

### 5.4 Confidence

- **High** that today's whole-board default cannot end against bots and has
  about 90 rounds without content, and that the evening variant ends before the
  eras for strong players and small tables. These are large effects, seen in
  every sample, and their causes are visible in the rules (sections 1.6 and
  3.1).
- **High** that a countdown from the Modern era bounds the length, and that
  tying conquest to the eras removes the early endings. Every prototype with
  those two features landed in the same window.
- **Medium** on the exact numbers for real players. The 40-round climb is the
  bots' climb; section 6 lists what could move it.
- **Low** on whether ending by countdown feels satisfying. Simulations cannot
  measure that.

## 6. Where human play could change the conclusion

- **People finish games that bots cannot.** A person who is winning will build
  ports and take islands. Under today's whole-board rules that shortens a
  winning player's game well below 150 rounds; it does not help a level or
  losing player.
- **People are slower in the late game.** A turn with 40 territories, research
  and buildings takes longer than a turn with 9. The minute estimates use one
  turn length for the whole game, so they understate long games most. This
  strengthens the case for a shorter game.
- **People advance eras at their own pace.** A person who races the eras could
  reach the Modern era before round 35 and shorten the game; one who is slow
  does not lengthen it, because any seat starts the countdown. One who never
  advances is covered in section 3.5.
- **People may play the countdown differently.** A territory leader can rush
  the Modern era to start the clock, and rivals have 12 rounds to pull them
  down. Bots already press a leader and race at the end
  (`ai/aiEnding.ts`), and the result changed hands in 20% of countdowns.
  Whether people find a counter is a playtest question.
- **Skill varies more than three stand-ins show.** The Expert stand-in wins 96%
  of games against Medium bots; few players will be that far ahead of the bots
  they chose. The Hard stand-in, at 51–58%, may be closer to a typical player
  who picks Medium.
- **The bots at Easy do not play this mode.** Results at Easy tables say more
  about Easy bots' era advancement than about pacing.

## 7. Method

### 7.1 The simulations

`backend/scripts/simAiArena.ts` plays whole games through the same bot turn the
live game runs, with settings baked by the server's own
`bakeCreateGameSettings`. `ARENA_RULES=full-default` and `full-evening` are the
lobby's two Full Game payloads. Every draw is seeded and every configuration
prints a digest. One seat is the stand-in for the player; its seat and the
starting seat rotate. Bots other than the stand-in draw a commander style each
game, as the live game does.

Sample sizes are 400 games for the baselines and the recommended configuration,
200 for sweeps, and 120 for five- and six-seat tables. Intervals are Wilson 95%
intervals for shares and 1,000-draw percentile bootstraps for medians and
means. At 200 games a share near 50% is known to about ±7 points, and at 400 to
about ±5.

### 7.2 What the minute estimates assume

Minutes are the stand-in's own turns at 45, 60 or 90 seconds each, plus the
other seats' turns at the live game's bot pacing (0.6 seconds per paced step,
about 4.5 seconds a round at four seats), counted until the game ends or the
stand-in is knocked out. They assume one turn length for the whole game, no
thinking during bots' turns, no pauses, and a single human. I have no data on
real turn lengths (question 5).

### 7.3 Script changes

All on branch `claude/laughing-davinci-f95fub`, under `backend/scripts/` only:

- `simAiArena.ts`: `ARENA_TRACE` writes one JSON line per game with each
  seat's territories, armies, era and captures every round, each era advance
  and knock-out, the gates between each seat and its next era, and the round
  the stand-in would first be offered the bots' surrender. `ARENA_PROTO` plays
  the prototype endings.
- `fullGamePacing.ts` (new): reads the traces and computes every measure in
  this report.

The prototypes are labelled as such in the script and its output. They work by
rewriting a simulated game's own settings between turns (its threshold, its
allowed endings, its round cap), so the engine and the bots read them as they
would a real rule. Nothing under `backend/src/` or `frontend/` was changed, and
with `ARENA_PROTO` unset every earlier digest is unchanged (`full-default`,
four games: `ba9f87f1` before and after).

### 7.4 Raw outputs

- [`data/runs.tsv`](data/runs.tsv): every configuration's label, game count,
  digest and the exact environment that reproduces it.
- [`data/arena/`](data/arena/): the arena's own report for each configuration.
- [`data/pacing/`](data/pacing/): the pacing report for each configuration.
- [`data/summaries.json`](data/summaries.json): every measure and interval for
  every configuration.

The headline rows are [`default-m4`](data/pacing/default-m4.txt),
[`default-hard-v-m3`](data/pacing/default-hard-v-m3.txt),
[`default-expert-v-m3`](data/pacing/default-expert-v-m3.txt),
[`evening-m4`](data/pacing/evening-m4.txt),
[`evening-hard-v-m3`](data/pacing/evening-hard-v-m3.txt),
[`evening-expert-v-m3`](data/pacing/evening-expert-v-m3.txt),
[`m.rec`](data/pacing/m.rec.txt), [`h.rec`](data/pacing/h.rec.txt) and
[`x.rec`](data/pacing/x.rec.txt). In the labels, the prefix names the stand-in
and the table (`m.` Medium, `h.` Hard and `x.` Expert against three Medium
bots; `em.` Easy against Medium; `me.` and `xe.` Medium and Expert against
Easy; `na.` a Medium stand-in that never advances; `all-…` every seat at one
level). `rec` is the recommended configuration and `p-` marks a prototype.
The round-by-round traces (about 160 MB) are not committed; each is rebuilt by
its line in `runs.tsv`.

To rebuild one row, from `backend/`:

```bash
ARENA_RULES=full ARENA_GAMES=400 ARENA_BASELINE_STYLE=random ARENA_CANDIDATE_STYLE=random ARENA_SETTINGS='{"max_turns":80,"era_advancement_max_lead":null}' ARENA_PROTO='{"thresholdFromEra":5,"finalAgeRounds":12}' ARENA_TRACE=/tmp/rec.trace.jsonl pnpm exec tsx scripts/simAiArena.ts
```

```bash
pnpm exec tsx scripts/fullGamePacing.ts rec=/tmp/rec.trace.jsonl
```

## 8. What I would build next

1. **The two ending rules, dark-launched.** Two settings baked at create (the
   earliest era from which the conquest threshold counts, and the length of the
   countdown once the last era is reached), read by `checkVictory`, by the
   bots' ending logic in `ai/aiEnding.ts` and by the surrender offer through
   one shared helper, so that players, bots and the offer agree on what wins.
   A new flag, off in `FLAG_CODE_DEFAULTS`, with its Admin → Config toggle;
   when on, the lobby's Full Game sends the two settings, cap 80 and no lead
   cap. Settings are baked at create, so running games keep their rules. The
   game screen needs the countdown ("Modern era: 9 rounds left") and a "how to
   win" line that says conquest opens in the Modern era. Then add the rules as
   an arena ruleset and check it against the prototype's numbers.
2. **Measure real games.** Log turn length by round, and track on live Full
   Games the measures in section 2: rounds, how the game ended, the winner's
   era, rounds after decided, quiet rounds. That replaces the 45/60/90-second
   assumption and tells you whether the bots' 40-round climb is a person's.
3. **Three fixes that stand apart from the recommendation.** A two-player
   evening Full Game ends in three rounds. One seat that never advances freezes
   every seat's eras under the lead cap. The comment above
   `full_game_evening_enabled` says off while the code says on.
4. **Offer the bots' surrender at the decided position** (60% of the board and
   twice the next seat's armies) and measure it. It would let a one-sided game
   end at about round 12 for a player who wants out, under any rules.
5. **A second step on the era climb**, once the ending is live: cost multiplier
   1.5, then the same gates for every era, each judged by how many seats reach
   the Modern era.

## 9. Questions for you

1. Is `full_game_evening_enabled` pinned off in production? It decides which
   of the two "today" columns your players are in.
2. In a one-sided game, do you want the winner to play through to the Modern
   era (about 36 rounds, recommended), or the game to end sooner without it
   (about 27 rounds, conquest counted on the whole board)?
3. Is a countdown an acceptable way for most even games to end, or should the
   last word be conquest (the falling-threshold variant)?
4. Is about 55 minutes at a minute a turn the right length for a Full Game? A
   10-round or 15-round countdown moves it by about three minutes either way;
   going much shorter means speeding up the era climb.
5. Do you have real turn lengths for Full Games, by round? They would replace
   the main assumption in every minute figure here.
6. Should the new ending apply only to the lobby's Full Game button, or also to
   Custom Game lobbies with era advancement and to multiplayer?
7. Is dropping the era lead cap for Full Game acceptable? It was added to stop
   a player running away from bots that did not advance; Medium, Hard and
   Expert bots now keep up without it, and Easy bots do not keep up with it.
