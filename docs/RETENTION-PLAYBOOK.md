# Borderfall — Retention Playbook (D1-first)

Companion to [MARKETING-PLAYBOOK.md](../MARKETING-PLAYBOOK.md). That doc's north star is
**account signups**; this one's is **day-1 return rate** (a visitor who plays today comes
back tomorrow). Measured via `getRetentionMetrics` over `analytics_events`
(`backend/scripts/funnelReport.ts`).

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
| Retention worker | Hourly BullMQ sweep: streak-at-risk push (~20–24h after last session), daily-challenge reminder (17:00 UTC), D2/D7 win-back emails (15:00 UTC, opt-in only). Hard caps: 1 outbound/user/UTC-day (`UNIQUE (user_id, sent_on)`), 500/trigger/sweep, guests + banned excluded everywhere. | `backend/src/workers/retentionNotificationWorker.ts`, migration 036 |
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
- Guests stay excluded from push/email by decision — the account *is* the notification
  channel, which is why the nudge and the panel push guests toward upgrade.
- Emails are opt-in only; expect the win-back audience to grow slowly from new signups.

## Wave 2 backlog (not built — ordered by expected impact)

1. **Async-by-default onboarding** — steer new users into a multi-day async game so there's
   always unfinished business; "your turn" notifications already exist and are the
   strongest re-engagement trigger we have.
2. **Unified "Today" panel on the lobby** — one surface answering "why open Borderfall
   today?": daily challenge, login chest, quests, season countdown (today they're four
   separate widgets).
3. **Streak freeze** — gold-purchasable insurance for one missed day; softens the cliff
   where a broken 10-day streak becomes a reason to quit entirely.
4. **Guest push opt-in** — lift `rejectGuest` on push tokens if guest D1 stays weak after
   Wave 1 (guests are the majority of first sessions and currently unreachable).
5. **Weekly digest email** — rank changes, friend activity, season countdown (opt-in list).
6. **Rivalry notifications** — "X just passed you on the weekly leaderboard" from existing
   `player_streaks`/friends data.
