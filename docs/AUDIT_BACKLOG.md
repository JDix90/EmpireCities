# Follow-up audits (consultant-style backlog)

Tracked enhancements; not all are scheduled. Implement based on product priority.

## AI (`backend/src/game-engine/ai/aiBot.ts`)

- Formalize a single `AIConfig` interface (difficulty, jitter, evaluation weights). The planner is
  single-ply by design — do not reintroduce a `depth` field unless a tree search actually lands.
- Unit tests for pure evaluation helpers where feasible.

## Achievements and leaderboards

- Achievements: every one is defined by migration 051 and granted somewhere in the code, and `achievementDefinitions.test.ts` holds the definitions, the seeds and the code to `ACHIEVEMENT_IDS`. Still open: whether a few unlock rules match their descriptions (Grand Strategist's MMR 1500 is the starting rating; Comeback King, Underdog Victory and Perfect Defense each measure something other than what they say).
- Leaderboards: Redis sorted sets — confirm keys and write paths match README expectations.

## Map editor

- Run the same connection validation as `validate:maps` before publish.
- Optional “test play” mode to detect isolated territories or broken `region_id` coverage.

## Rate limiting

- Global + `/api/auth` nested limits are configured in `backend/src/index.ts`; tune `max` per environment if needed.
