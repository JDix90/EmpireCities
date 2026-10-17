# Follow-up audits (consultant-style backlog)

Tracked enhancements; not all are scheduled. Implement based on product priority.

## AI (`backend/src/game-engine/ai/aiBot.ts`)

- `attackObjectiveBonus` has no unit test of its own; every other exported evaluation helper does.

## Map editor

- Optional “test play” mode to detect isolated territories or broken `region_id` coverage.

## Rate limiting

- Global + `/api/auth` nested limits are configured in `backend/src/index.ts`; tune `max` per environment if needed.
