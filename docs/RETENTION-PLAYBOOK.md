# Borderfall — Retention Playbook (D1-first)

Companion to [MARKETING-PLAYBOOK.md](../MARKETING-PLAYBOOK.md). That doc's north star is
**account signups**; this one's is **day-1 return rate** (a visitor who plays today comes
back tomorrow). Measured via `getRetentionMetrics` over `analytics_events`, in Admin →
Analytics and `backend/scripts/funnelReport.ts`; see [What counts as a return](#what-counts-as-a-return).

## The diagnosis

Marketing tests showed the top of the funnel works — visitors play, explore, ~20% of triers
create accounts — but they don't come back the next day. The gap was never mechanics
(streaks, daily/weekly/monthly challenges, seasons, gold → cosmetics, achievements,
referrals, and async games all pre-date this doc). Three structural holes explained weak D1:

1. **Zero outbound reach to a lapsed user.** Push/email infra existed but only fired
   event-driven "it's your turn" notices. Nothing was scheduled; guests are blocked from
   push tokens; `email_notifications` defaults to false. Once the tab closed, we were mute.
2. **The end of the first session wasn't engineered.** Game-over gave no concrete reason to
   return tomorrow — no streak worth protecting yet, a flat 10-gold login reward (nothing to
   anticipate), no daily-challenge tease.
3. **The habit-sized unit isn't the default path.** A full match is a long commitment; the
   ~5-minute daily challenge is the natural daily anchor but sat buried at `/daily`.

## The model: trigger → action → variable reward → investment

- **Trigger (external):** scheduled push/email that only fires when *actionable* — streak
  about to break, fresh daily challenge, your turn, win-back — plus a home-screen icon (PWA).
- **Action (small):** the 2–5 minute check-in — claim the login chest, play the daily puzzle.
- **Variable reward:** escalating login gold, streak milestones, leaderboard movement.
- **Investment:** streak days, an async game in progress, campaign progress, friends. Each
  day played raises the cost of not returning.

## Wave 1 (shipped in this change set)

| Lever | What it does | Where |
|---|---|---|
| Retention worker | Hourly BullMQ sweep: streak-at-risk push (~20–24h after last session), daily-challenge reminder (17:00 UTC), D2/D7 win-back emails (15:00 UTC, opt-in only). Hard caps: 1 outbound/user/UTC-day (`UNIQUE (user_id, sent_on)`), 500/trigger/sweep, banned excluded everywhere, guests too unless `guest_push_reminders_enabled` (push only). | `backend/src/workers/retentionNotificationWorker.ts`, migration 036 |
| One-click unsubscribe | HMAC-tokenized `/unsubscribe` page (POST behind a confirm button so mail scanners can't prefetch-unsubscribe); footer link + `List-Unsubscribe` header on every engagement email, turn emails retrofitted. | `backend/src/utils/unsubscribeToken.ts`, `POST /api/users/unsubscribe`, `frontend/src/pages/UnsubscribePage.tsx` |
| "Come back tomorrow" panel | Post-game panel: the streak they now must protect, distance to the next gold milestone, tomorrow's (bigger) login chest, daily-challenge tease. Guests get the streak + "create an account to protect it". | `frontend/src/components/game/ComeBackTomorrowPanel.tsx`, `GET /api/progression/comeback` |
| Escalating login gold | 10 → 15 → 20 → 25 → 30 for consecutive login days (`users.login_streak`), replacing flat 10/day. Day 2 > day 1 is the point — tomorrow is always worth teasing. | `DAILY_LOGIN_REWARDS` in `packages/shared`, `claimDailyLogin`, login calendar |
| Guest → account nudge | The already-built one-time post-game modal, re-framed around "protect your streak + get reminders", now with shown/clicked analytics. **Greenlit: set `SIGNUP_NUDGE_ENABLED=true`.** | `frontend/src/utils/signupNudge.ts`, `GuestSignupNudgeModal.tsx` |
| Email opt-in at signup | Unchecked checkbox on Register + Upgrade ("streak reminders and comeback bonuses"); sets `user_preferences.email_notifications`. Opt-in is deliberate — the win-back audience accrues from consenting users only. | `auth.routes.ts`, `RegisterPage.tsx`, `UpgradePage.tsx` |
| Installable PWA | `manifest.webmanifest` + icons; home-screen icon = ambient daily trigger. FCM SW untouched (no caching SW). `pwa_installed` tracked. | `frontend/public/manifest.webmanifest`, `frontend/index.html`, nginx MIME block |

### New analytics events

`retention_notification_sent {trigger, channel}` · `retention_notification_clicked {trigger}`
(via `?rn=` deep-link param, stripped on landing) · `email_unsubscribed` ·
`signup_nudge_shown/clicked` · `email_opt_in` on `user_registered`/`guest_upgraded` ·
`pwa_installed`. Client events flow through `POST /api/analytics/ui-event` (allowlisted).

## What counts as a return

D1, D7 and D30 count a signup as returned when the player did something on exactly day 1, 7
or 30 after signing up: any `analytics_events` row except the ones the server records about
a player who may be nowhere near the game (`NOT_PLAYER_ACTIVITY_EVENTS` in
`backend/src/services/analyticsQueries.ts`):

- `retention_notification_sent`. Until this was excluded, every reminder counted its
  recipient as returned. The daily-challenge reminder goes to recent players who have not
  entered today's challenge, and the D7 win-back to players whose last game was a week ago,
  so players who had not come back were counted as returns. Read D1/D7 from before the change as
  overstated for accounts that can receive reminders; guests never get them.
- `seat_player_away`: the server marking a disconnected player away. It also fires during
  an ordinary page reload.
- `email_unsubscribed`: an unsubscribe link followed from an email.

**Opening the game counts.** `app_opened {device}` is posted at most once a UTC day per
signed-in player, guests included, when the page loads or comes back into view
(`frontend/src/hooks/useDailyVisit.ts`). It is posted from the page, not from the server's
token refresh, because an open tab refreshes its token with nobody looking at it. Before it,
a player who came back without starting a game recorded nothing.

The same rule drives Admin → Analytics → **Active players** (yesterday, the last 7 and 30
days, and each day split into new and returning players) and the first matches' "back next
day". New means the account was made that day.

## Launch sequence (ops)

1. **Baseline first.** Set `ANALYTICS_EVENTS_ENABLED=true` (or the admin override) **at
   least a week before** enabling the worker; cohorts only accrue from enablement. Run
   `cd backend && pnpm exec tsx scripts/funnelReport.ts 30` and record D1/D7.
2. Deploy migration 036 + this code with `RETENTION_NOTIFICATIONS_ENABLED=false` and
   `SIGNUP_NUDGE_ENABLED=true`. Set `UNSUBSCRIBE_TOKEN_SECRET`.
3. Flip `retention_notifications_enabled` on (admin override works live). On day one, watch
   `SELECT trigger_type, channel, delivery_status, count(*) FROM retention_notifications GROUP BY 1,2,3;`
   and the Resend bounce dashboard.
4. Weekly: sent-vs-clicked per trigger (join `retention_notifications` against
   `retention_notification_clicked` events) + `funnelReport.ts`. **Kill or rewrite any
   trigger under ~5% CTR** — a low-value notification trains users to ignore all of them.

## Known constraints

- **All day-boundaries are UTC** (streaks, claims, worker queries agree with each other).
  Copy says "midnight UTC". Per-user timezones are out of scope; `last_login_at` is used as
  a time-of-day proxy so the streak reminder lands near the user's usual hour.
- Guests are excluded from push and email unless `guest_push_reminders_enabled` is on
  (the default; the admin override is its kill switch).
  With it on, a guest who allowed notifications gets the streak-at-risk and
  daily-challenge reminders by push. A guest has no email, so never an email or a
  win-back. The ask is a "Remind me" row in the game-over panel, the one moment a
  guest has just started a streak, because the browser shows its permission prompt
  only from a click. A guest switches push off in Settings, where
  `GET/PUT /api/users/me/preferences` lets them change `push_enabled` and nothing
  else. With it off, the account is the only notification channel, which is why the
  nudge and the panel push guests toward upgrade. Read guest reminders by joining
  `retention_notifications` and `push_optin_granted` events to `users.is_guest`.
- Emails are opt-in only; expect the win-back audience to grow slowly from new signups.
- **A reminder takes a player's one slot for the day only if it can reach them**: a
  registered push device on a server with push configured (`FCM_SERVICE_ACCOUNT_PATH`),
  or, for the streak reminder, an email opt-in. Players neither can reach are left out of
  the candidate queries too, so they never fill a sweep's cap. Until this was fixed, the
  push-only daily-challenge reminder at 17:00 UTC claimed the slot for every player with
  no device, and the streak reminder due later that day skipped them, opted-in email
  included. `delivery_status = 'failed'` now means a send was tried and refused.

## Wave 2 (shipped in this change set)

The top three backlog items, all dark-launched behind default-off flags. Flags off ⇒ the
app is byte-for-byte the Wave 1 experience.

1. **Streak freezes** (`streak_freezes_enabled`) — a 50-gold consumable (hold max 2,
   `STREAK_FREEZE_PRICE_GOLD`/`STREAK_FREEZE_MAX_HELD` in `packages/shared`) that bridges
   **exactly one** missed day; two or more missed days still reset. Auto-consumed lazily at
   next play inside `updateDailyStreak` (the sole streak write site) — consumption is
   deliberately **not** flag-gated so a sold freeze keeps working even if sales are turned
   back off. Bought via `POST /api/progression/streak-freeze` (atomic charge+grant, 402/409),
   surfaced in the Today panel; the post-game comeback panel reassures when freezes are armed.
   Migration 037 (`users.streak_freezes`, `users.streak_freeze_used_on`).
2. **Unified "Today" panel** (`today_panel_enabled`) — `TodayPanel.tsx` replaces the lobby
   aside's Daily Challenge card + standalone login calendar: streak status + next milestone,
   freeze state/buy, login-chest claim, daily-challenge row, and (flagged) the async CTA.
   Month calendar lives behind a disclosure. Reads the extended `GET /progression/comeback`;
   no new read endpoints. Guests and the flag-off path keep the old aside untouched.
3. **Async-by-default onboarding** (`async_onboarding_enabled`) — steering only, no engine
   changes. Async-vs-AI is pointless (AI answers in ~1.5 s), so both CTAs route to
   **async vs humans** via the existing `ChallengeFriendModal` (async 24 h by default):
   a secondary "Challenge a friend — play a turn a day" button on the post-tutorial modal
   (solo stays primary; activation is never gated on a second human) and a "start a
   multi-day game" row in the Today panel when the user has zero active async games
   (`/lobby?challenge=1` deep-link opens the modal). New **"The Long Game"** onboarding
   quest (`first_async`, 50 gold) completes when an async game with ≥2 humans starts —
   the first non-sequential quest (`NON_SEQUENTIAL_QUESTS`), completable out of order.

**Measurement:** ui-events `today_panel_shown`, `async_cta_clicked` (`source`:
`post_tutorial` | `today_panel`), `streak_freeze_buy_clicked`; server events
`streak_freeze_purchased`, `streak_freeze_consumed`; plus the post-game payload's
`streak_freeze_used`. Success looks like: freeze buyers' 28-day retention > matched
non-buyers, async-game starters' D7 ≫ solo-only cohort, chest-claim rate up after the
Today panel replaces the buried calendar.

**Wave 2 rollout order** (after the Wave 1 sequence below): flip `streak_freezes_enabled`
first (self-contained economy change), then `today_panel_enabled` (presentation swap —
eyeball a staging lobby), then `async_onboarding_enabled` (funnel-adjacent; watch that
tutorial→first-game conversion doesn't dip once the second CTA appears).

## Wave 3 backlog (not built — ordered by expected impact)

1. **Guest push opt-in** — built behind `guest_push_reminders_enabled` (see Known
   constraints). Guests could already register a browser; the flag puts them in the
   sweep and asks them at the end of a game.
2. **Weekly digest email** — rank changes, friend activity, season countdown (opt-in list).
3. **Rivalry notifications** — "X just passed you on the weekly leaderboard" from existing
   `player_streaks`/friends data.
4. **Async matchmaking liquidity** — async ranked buckets exist but need two queued humans;
   consider a "waiting room" ladder or cross-era pooling once async CTAs create volume.
5. **Retention-worker copy upgrade** — mention an armed freeze in the streak-at-risk push
   ("your freeze has you covered — but the streak grows only if you play").
