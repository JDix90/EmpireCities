# Borderfall — Growth Playbook (signups-first)

Companion to the creative re-cuts and the attribution tracking shipped alongside this doc.
North star: **account signups**. Budget: **~$100–300 / 30 days**. Channel bias: **Reddit-primary**
(our one validated audience; dense, desktop-leaning browser strategy game).

First marketing touch (2026-06-21, r/WebGames): ~15 tried → 3 accounts (≈20%) → 2 activated.
Conversion is fine; the job is **more qualified top-of-funnel** + **measuring which channel makes accounts**.

---

## 0. Do this before spending a dollar — turn on measurement

Two parts, both shipped in this change set:

1. **Enable analytics** (currently default OFF). No redeploy needed if you use the admin override:
   - Env: set `ANALYTICS_EVENTS_ENABLED=true` on the backend host, **or**
   - Admin config: set the `analytics_events_enabled` feature-flag override to `true`
     (`backend/src/config/featureFlags.ts`, live via admin pub/sub).
2. **Attribution is now captured automatically.** The client snapshots first-touch
   `utm_*` + external referrer on landing (`frontend/src/utils/attribution.ts`) and the
   backend folds it into the `guest_created` / `user_registered` / `guest_upgraded`
   analytics events (`backend/src/modules/auth/attribution.ts`). Nothing else to wire — just
   use the tagged links below.

**Read results:**
- CLI: `cd backend && pnpm exec tsx scripts/funnelReport.ts 30` → now includes an
  **ACQUISITION BY SOURCE** table (signups · accounts · activated, per source).
- Admin API: `GET /api/admin/metrics/funnel?days=30` (same shape, `acquisition[]` added).

Decision rule after week 1: keep spend on the source with the lowest **cost per account**
(spend ÷ `accounts`), not per click.

---

## 1. Tagged links — use these exact URLs

Convention: `?utm_source=<channel>&utm_medium=<type>&utm_campaign=<camp>&utm_content=<creative>`.
Keep `utm_campaign=launch_2026_06` across this push so the funnel groups cleanly.

| Channel | URL |
|---|---|
| Reddit Ads — B (vertical) | `https://borderfall.gg/?utm_source=reddit&utm_medium=cpc&utm_campaign=launch_2026_06&utm_content=b_vertical` |
| Reddit Ads — C (hero) | `https://borderfall.gg/?utm_source=reddit&utm_medium=cpc&utm_campaign=launch_2026_06&utm_content=c_hero` |
| Reddit organic post | `https://borderfall.gg/?utm_source=reddit&utm_medium=post&utm_campaign=launch_2026_06&utm_content=<subreddit>` |
| Product Hunt | `https://borderfall.gg/?utm_source=producthunt&utm_medium=referral&utm_campaign=launch_2026_06` |
| Hacker News (Show HN) | `https://borderfall.gg/?utm_source=hn&utm_medium=referral&utm_campaign=launch_2026_06` |
| X / Twitter | `https://borderfall.gg/?utm_source=twitter&utm_medium=social&utm_campaign=launch_2026_06` |
| TikTok / Reels / Shorts (organic) | `https://borderfall.gg/?utm_source=<tiktok\|instagram\|youtube>&utm_medium=social&utm_campaign=launch_2026_06` |
| CrazyGames / Poki / itch.io | `https://borderfall.gg/?utm_source=<crazygames\|poki\|itch>&utm_medium=portal&utm_campaign=launch_2026_06` |

Note: organic visitors with no utm but an external referrer are still bucketed by
**referrer host** (e.g. `reddit.com`), so even untagged shares get attributed.

---

## 2. Creative → channel matrix (re-cut assets in `~/Downloads/borderfall_cuts/`)

| File | Format | Use |
|---|---|---|
| `A_story_9x16_fixed.mp4` | 9:16, 13s | IG/FB Stories, vertical-social slot (dead-air bug fixed, "free/no download" CTA) |
| `B_gameplay_9x16.mp4` | 9:16, 9.4s | **Primary paid creative**, TikTok/Reels/Shorts hook (cinematic + clean CTA card) |
| `B_gameplay_1x1.mp4` | 1:1, 9.4s | Feed placements (Reddit/Meta square) |
| `B_gameplay_16x9_original.mp4` | 16:9, 8.4s | Landscape master (unchanged) |
| `C_hero_16x9_clean.mp4` | 16:9, 21s | YouTube pre-roll, landing hero, Product Hunt, Reddit link post |

Every end card now carries the conversion line: **free · in your browser · no download · vs AI now.**

⚠️ **Brand check before scaling paid:** B's photoreal "mushroom cloud engulfing the globe"
shots (≈5–7s) are a cinematic asset, **not in-game footage**. That conflicts with the
"no AI art / no fake proof" positioning. Confirm the source (in-house render vs stock vs AI)
before putting paid budget behind it; if it's AI/stock, either disclose it's a stylized intro
or swap for real atom-bomb gameplay so the ad can't read as bait-and-switch.

---

## 3. Paid: ~$200, concentrated on Reddit

- **~75% → Reddit Ads (~$150, ≈$7/day × 3 wks).** Objective: traffic/conversions → tagged
  borderfall.gg links. Run `b_vertical` and `c_hero`. Target communities/interests:
  r/WebGames, r/onlinegames, r/browsergames, r/incremental_games, r/playmygame, r/RiskGame,
  r/Risk, r/civ, r/strategygames, r/grandstrategy, r/4Xgaming, r/IndieGaming.
- **~15% → one secondary test (~$30–50):** X promoted (indie/strategy crowd) **or** Meta Reels
  with `B_gameplay_9x16`. Pick the one you'll also post on organically.
- **~10% reserve:** shift to the lowest cost-per-account source after week 1.

**Reddit ad headlines** (all lead with the no-download hook):
- "Risk, but the whole planet is the board — free in your browser, no download."
- "Paint the globe red. Turn-based world conquest, play right now vs AI or friends."
- "Every border is temporary. Free browser strategy — no install, play in ~10 seconds."

---

## 4. Organic engine (where most signups come from at this budget)

Priority order:
1. **Reddit cadence** — rule-compliant *native* posts (upload `B_gameplay_9x16` directly, not just
   a link), spaced out: r/WebGames (worked), r/playmygame, r/incremental_games, r/RiskGame,
   r/onlinegames, r/browsergames, r/IndieGaming. Reply to every comment; drop the tagged link in-thread.
2. **Product Hunt launch** — use `C_hero_16x9_clean` as the video; line up the upvote spike.
3. **Show HN** — "browser strategy game, no download, plays vs AI instantly" angle; can spike hard.
4. **Web-game portals (free, huge built-in traffic):** CrazyGames, Poki, itch.io, Newgrounds,
   AlternativeTo. A single feature here dwarfs the current funnel.
5. **Native vertical social** — post the 9:16 cuts organically to TikTok / Reels / Shorts
   ("painting the map" content performs).
6. **Activate the built-in loops** — surface the **referral bonus** (50/25 gold) and the
   **post-game share card** in-product; make sure the share card link carries
   `?utm_source=share&utm_medium=viral&utm_campaign=launch_2026_06`. Each signup then seeds more.
   (`referralService.ts`, `frontend/src/utils/shareCard.ts`, `ChallengeFriendModal.tsx`.)

---

## 5. Highest-leverage product lever for the signups goal (optional, product call)

There is deliberately **no guest→account nudge** today. With the goal now explicitly *signups*,
a single well-timed prompt — after a first win / after game 1: *"Create a free account to save your
progress, rank, and rewards"* — is likely cheaper per account than any ad. Worth greenlighting as a
fast-follow; it reverses a prior onboarding decision, so it's flagged here rather than assumed.
