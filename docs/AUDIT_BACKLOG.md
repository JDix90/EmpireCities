# Follow-up audits (consultant-style backlog)

Tracked enhancements; not all are scheduled. Implement based on product priority.

## AI (`backend/src/game-engine/ai/aiBot.ts`)

- Formalize a single `AIConfig` interface (difficulty, jitter, evaluation weights). The planner is
  single-ply by design — do not reintroduce a `depth` field unless a tree search actually lands.
- Unit tests for pure evaluation helpers where feasible.

## Achievements and leaderboards

- Achievements: `backend/src/game-engine/achievements/achievementService.ts` — verify each achievement id in DB seeds matches unlock logic.
- Leaderboards: Redis sorted sets — confirm keys and write paths match README expectations.

## Map editor

- Run the same connection validation as `validate:maps` before publish.
- Optional “test play” mode to detect isolated territories or broken `region_id` coverage.

## Rate limiting

- Global + `/api/auth` nested limits are configured in `backend/src/index.ts`; tune `max` per environment if needed.
