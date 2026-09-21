# Daily Challenge v2 — decision puzzles (design brief)

> **Status: agreed design, implementation in progress behind a flag.** This records the
> design settled on 20–21 September 2026 for turning the daily challenge from a small
> dice skirmish into a decision puzzle. Everything below ships dark behind
> `daily_puzzle_v2_enabled` (off); the v1 daily keeps running untouched until the flag
> flips. If you are looking for how the daily works *today*, read
> [ARCHITECTURE.md](ARCHITECTURE.md) and `backend/src/game-engine/daily/`.

**One line:** score the decision, not the dice.

---

## 1. Why

Three weeks of production data (September 2026): one player most days, two on one day,
every capture day won, and wins arriving with two to five "risky" moves — through slack,
not precision. The schedule's own simulator agrees: capture days give a par-2 fight a
9–11 turn clock and a 73–95 % solve rate for the *obvious* move; economy and tech days
cannot be lost by a player who does nothing wrong. The daily was calibrated Wordle-style
(nearly everyone finishes, score differentiates), which is a defensible design with
players and a dead one without them. It is neither hard nor shareable nor quick.

The v1 machinery is good and stays: the set-piece library, the dated calendar, the
generator that sizes numbers from the date, the gate that proves every day of the year in
CI, par, move feedback, the archive, the leaderboard. What changes is the question the
puzzle asks.

## 2. The reference is backgammon, not chess

Chess puzzles work because chess has no dice. Backgammon's puzzle culture is richer than
chess's precisely *because* it has dice: a problem gives you a position, you choose a
play, and the verdict is your play's equity against the best play's, computed by a bot
over every future. Nobody argues that luck makes the answer meaningless. Poker trainers
score the same way. The best play is the best play whatever the next roll does.

So a Borderfall daily grades **decisions by win probability**, never outcomes:

- The player's move is compared with the best move available in that position.
- The dice still roll — seeded, so everyone lives the same story — but they touch
  nothing that is scored. "Best play. The dice disagreed." is a true sentence.
- The run's score is **accuracy**: how little win probability the player threw away
  across the day's decisions. Win and loss are shown because they matter emotionally;
  the leaderboard ranks by accuracy, which luck cannot climb.

## 3. Player experience

**The card.** Lobby (Today panel) and `/daily`: "Puzzle #143 · The Relief Column · 2
decisions". Guests may play (existing `daily_guest_play_enabled`); the streak is the
reason to make an account.

**The board.** Six to eight territories, all unit counts visible, the objective in one
line ("Capture Persia and hold it through the enemy's turn"), the opponent's plan
visible: drawn as arrows on the map on easy and medium days, prose only on Friday.

**The turn.** Draft, attack, fortify exactly as in a real match. Before the dice roll on
a move that matters, the board answers:

> *Attack Persia now?* That wins **55 %** of futures. There is an **84 %** line.
> **Roll anyway** · **Take it back**

The confirm button follows the move rather than the dice: only an attack rolls, so a
fortify reads **Move anyway**, ending a phase reads **Stop anyway** or **End turn
anyway**, and a move the board agrees with is simply confirmed (**Roll**, **Move
them**, **Stop attacking**).

Take it back and the star is gone but the streak survives. Confirm it and the seeded
dice play out. A second takeback on the same decision reveals the best line and forfeits
that decision's accuracy. On Friday the interruptions are off: every decision is graded
silently and the grades appear at the end.

**The end.** Won or lost, the review names each decision (chosen vs best, points lost,
grade), the day's **theme** ("cut the supply line"), the accuracy, the star or crown,
the streak, and a share line:

```
Borderfall Daily #143 · ★ 94 % · 2/2 best · 🎲 won   borderfall.gg/daily
```

Yesterday's solution is one tap away; every archived day carries its solution line and
theme (the archive pages are public and crawlable).

**The week.** Decisions per puzzle are the difficulty dial.

| Day | Verb | Decisions | Opponent's plan | Verdicts |
|---|---|---|---|---|
| Mon | capture | 2 | arrows | before the dice |
| Tue | capture / chain | 2 | arrows | before the dice |
| Wed | hold | 2 | arrows | before the dice |
| Thu | budget (v1 economy/tech) | — | — | v1 unchanged |
| Fri | capture / region / chain | 3 | prose only | silent until the end |
| Sat | library walk | 2 | arrows | before the dice |
| Sun | domination (v1) | — | — | v1 unchanged |

Thursday and Sunday keep their v1 form until redesigned (budget puzzles; a shorter long
game). A day whose set-piece has no authored opponent plan is served as v1 even with the
flag on, so the week can migrate set-piece by set-piece.

## 4. Scoring, precisely

- **Equity** of a position = the human's win probability from it under best play, with
  the scripted opponent replying and the dice at their true distribution.
- **A decision** is a human action in a position where a plausible rival to the best
  move loses ≥ 5 points: the obvious line's move when it differs, or the strongest move
  of a different kind ("attack now" versus "cut the relief road first"). "Attack all
  in" versus "attack and stop at three" is one idea, not two, and is never a decision on
  its own. Trivial choices are not graded and do not count.
- **Loss** of a decision = equity(best action) − equity(chosen action), in points 0–100.
  Grades: **best** < 2 · **good** 2–5 · **inaccuracy** 5–15 · **blunder** ≥ 15.
- **First attempt counts.** The first proposal in a decision position is what accuracy
  records. A takeback continues play from the same position; the star is forfeit. A
  second takeback on the same decision reveals the best line and records the decision at
  full loss.
- **Accuracy** = 100 − mean loss over the run's graded decisions, clamped to 0–100.
  **Score** = round(10 × accuracy), 0–1000.
- **Star**: no blunder, at most one inaccuracy, no takeback. **Crown**: every decision
  graded best on first attempt.
- **Streak**: completion — the run reached game over, won or lost.
- **Leaderboard**: score ↓, then first-try ↓, then attempts ↑, then completion time ↑.
  `won` is shown, never ranked.

## 5. System design

### 5.1 The puzzle model (`backend/src/game-engine/daily/puzzle/`)

A puzzle is solved on an **abstract state**, not the full `GameState`:

- territories in play (the set-piece's), each with owner ∈ {human, ai, neutral} and units;
- side to move, phase (draft · attack · fortify), turn number, draft units remaining,
  fortify used;
- static context: adjacency with sea flags, the day's dice modifiers (era, sea cap,
  legion reroll), reinforcement rule, objective, clock.

A bridge maps a live `GameState` to this shape (only the in-play territories matter;
everything else on the map is neutral and empty on a `clear_board` day) and back to the
engine's action vocabulary. Divergence between the model and the engine is the main
correctness risk; §7 says how it is caught.

**Actions** are abstracted to keep the tree small:

- draft: all units to one owned in-play territory, or a split between two;
- assault `(from, to, keep k)`: attack until captured or until `k` remain, k ∈ {1, 2, 3},
  then move in all but `k`; the engine's own capture rules apply;
- stop attacking; fortify `(from, to, all but 1 | half)`; end turn.

A player action outside the abstraction is graded by a sampled fallback and the verdict
says so; **a move is never refused**, only warned.

**Chance** is exact: every exchange's outcome distribution comes from
`combatOdds.exchangeLossDistribution` with the day's modifiers — the same rules
`executeLandAttack` plays. **The opponent** is a scripted plan (§5.2), deterministic.

**The solver** is expectimax over this tree with memoization on canonical states,
depth-limited to the puzzle's clock, terminal on the objective (`PUZZLE_OBJECTIVES`
semantics) and on timeout. Boards this small solve exactly. A node budget guards the
Friday three-decision days; a subtree over budget falls back to seeded rollouts with a
reported margin. **Exact where small, sampled where wide, honest about which.**

The same solver yields, for any position: the best action and its equity, every action's
equity, and the **obvious line** (the existing simulator's policy mapped onto abstract
actions) for the freebie test.

### 5.2 The scripted opponent

Authored on the set-piece, replacing the live bot for v2 days:

```ts
plan: [
  { when: 'target_attacked', do: { kind: 'march', from: 'bactria', to: 'persia', units: 'all_but_1' } },
  { when: 'always',          do: { kind: 'assault', from: 'persia', to: 'gaul', min_odds: 0.55, keep: 2 } },
  { when: 'always',          do: { kind: 'draft', to: 'persia' } },
]
```

Rules are evaluated in order each opponent turn: draft, then assaults, then one march
(fortify). Conditions: `always` · `target_attacked` · `target_lost` · `target_held` ·
`turn: n`. The plan is the lesson: what the opponent will do is what the puzzle exists
to teach, and the intro shows it (arrows or prose from the same rules). Determinism makes
the solver exact and the intent stable.

### 5.3 Generation and the gate

The generator keeps sizing numbers from the date. The gate's criterion inverts:

- best-line equity ≥ 0.60 (winnable);
- obvious-line equity ≤ best − 0.15 (the natural move is refuted: fifteen points is the
  blunder grade. The first draft said twenty; measured on the library, a hold day's
  pre-emptive strike is worth 16–19 points, and twenty would have kept every Wednesday
  v1);
- at most two distinct opening moves within 5 points of the best (a key line, not a
  buffet; keep variants of one assault count once);
- decision count along the best line = the tier's target (2 or 3), or one more;
- solved within the node budget (600k positions; a board that exceeds it is served as
  v1 rather than re-rolled, since a re-roll keeps the width).

Outside the band the numbers re-roll up to `GATE_ATTEMPTS` times, as today, the band
moving toward the miss. The solution (best line, equities per decision, theme) is stored
with the day's spec at materialization; the sweep test recomputes the horizon. If the
sweep outgrows CI's budget, the horizon is precomputed into a checked-in artifact that
CI verifies.

Two readings differ from v1 on purpose (`dailyScheduleV2.ts`):

- **The hold day.** v1's numbers are sized for the shipped bot, which attacks when it
  likes its odds; the scripted siege attacks every turn at any odds, and against it the
  v1 reserve left every hold day a coin flip under best play. The v2 reading deals the
  reserve three stronger and the siege leaves its second stack standing; the days then
  land at 60–75% with the pre-emptive strike and the timing of the reserve as the
  decisions.
- **Tuesday.** v1 serves a budget puzzle, which has no dice and so nothing to grade; v2
  serves a second capture or chain from the planned library, walked by week and never a
  front the v1 cadence serves within six days either side. With the flag off Tuesday is
  the budget day exactly as before.

### 5.4 Play

- `game:puzzle_propose { action }` → the server grades the action on the live state and
  answers `{ decision: boolean, equity, best_equity, loss, grade, silent }`. The client
  shows the card (unless silent) and either commits the real action or takes back.
- The server grades every **committed** action too, as the source of truth (a client
  that skips proposals is still graded), and keeps `puzzle_decisions[]` on the state:
  first proposal, takebacks, chosen, best, loss.
- Graded positions are cached in Redis by canonical state + day, shared across every
  player of the day (seeded dice → the same choices reach the same positions).
- Game over → `recordDailyEntry` writes accuracy, attempts, first_try, decisions.

Migration 042 adds to `daily_challenge_entries`: `puzzle_version SMALLINT DEFAULT 1`,
`accuracy NUMERIC(5,2)`, `attempts INT`, `first_try BOOLEAN`, `decisions_json JSONB`.

### 5.5 Presentation

Reuse the game page with a puzzle overlay: the intro modal gains the opponent's plan and
the decision count; a verdict card (§3); an end-of-run review panel; the share line;
intent arrows on the 2D map on arrow days; archive pages render the solution and theme.
A cropped viewport that fits the in-play territories is desirable and is done only if
the map renderer already exposes a fit-to-bounds; otherwise it is a follow-up.

### 5.6 Flags and rollout

`daily_puzzle_v2_enabled` — `envOptIn`, **off**, getter, client export, Admin → Config
kill switch. With the flag off nothing about the daily changes. With it on, a day is v2
only when its set-piece carries a plan and the gate accepted it; otherwise v1. Both
render in the archive.

## 6. Content authoring

A set-piece gains `plan` (§5.2) and `theme` (a short motif name: cut the supply line ·
the feint · the reserve · tempo · the bridge · sea crossing). Authoring rules, enforced
by `dailySetPieces.test.ts`: every territory in the plan exists on the map and is in
play; marches and assaults are between adjacent territories; a theme is present; the
plan is non-empty. The first batch: the tactical captures and holds already in the
library, then region and chain.

## 7. Verification

Beyond the repo's standard commands (`pnpm run test:backend`, frontend vitest,
`pnpm run lint`, both `tsc`, `scripts/check-docs.sh`):

- **Model-vs-engine parity**: for every proven day, rollouts of the obvious line through
  the *real* engine (`puzzleSim`) and through the abstract model must agree within
  sampling error. Divergence fails the sweep.
- **Solver correctness**: hand-checked positions with known equities; symmetry and
  monotonicity checks (more units never lower equity for the side that has them).
- **The sweep**: every v2 day in the horizon passes the gate, is deterministic across
  processes, and its stored solution matches a fresh solve.
- **Play**: socket-level tests for propose → verdict → commit, takeback accounting,
  silent Friday, entry recording; Postgres-gated tests for the migration and leaderboard
  order.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Abstract model diverges from the engine (modifiers, sea caps, reinforcement) | parity test in the sweep; `clear_board` days only; modifiers read from the engine's own functions |
| Tree too wide on three-decision days | node budget, coarse action set, memoization, sampled fallback with a margin |
| Verdict wrongly refuses a human's clever line | never refuse; fallback grading for out-of-abstraction moves |
| Library narrows under the new gate; puzzles feel samey | measure solve rate against days of exposure; grow the library and the theme set; mine real replays later |
| Accuracy is abstract for casual players | win, star and streak stay in front; accuracy sits behind them |

## 9. Later, on purpose

Blunder of the day (once there are players to aggregate) · a puzzle rating on the
existing Glicko-2 · puzzles mined from real replays · budget-day and Sunday redesigns ·
game review of full boards (the solver's sampled mode on a real match) · a landing-page
card (localized copy in five languages) · native-app push (see the mobile brief).

## 10. Decision log (21 September 2026)

1. Decisions per puzzle: two, three on Friday.
2. Streak counts completion; accuracy earns the star; crown for a perfect run.
3. Game review is a bonus; small boards first.
4. Verdicts before the dice with takeback on Mon–Thu and Sat; silent on Friday.
5. Takeback: the first costs the star; the second reveals the best line and forfeits
   that decision's accuracy.
6. First release covers capture, hold, region and chain days; Thursday and Sunday stay v1.
7. Dark launch behind `daily_puzzle_v2_enabled`; the v1 daily is untouched.
