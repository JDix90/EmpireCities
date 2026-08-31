-- Map moderation: a real state machine for the editor publish pipeline.
--
-- 'draft' separates "saved" from "submitted for review": creates are born
-- draft, POST /maps/:id/publish moves draft|rejected -> pending, an admin
-- action moves pending -> approved (listed) | rejected (with a reason the
-- owner sees in My Maps), and editing an approved map demotes it to pending.
--
-- Deploy order is migration -> code and backward-safe: pre-039 code never
-- writes 'draft' and never reads moderation_reason, and existing rows keep
-- their states (no backfill — a map already 'pending' was genuinely
-- submitted under the old single-state flow).
ALTER TABLE maps DROP CONSTRAINT IF EXISTS maps_moderation_status_check;
ALTER TABLE maps ADD CONSTRAINT maps_moderation_status_check
  CHECK (moderation_status IN ('draft', 'pending', 'approved', 'rejected'));

-- Why a map was rejected, written by the admin reject action and surfaced to
-- the owner in My Maps. Cleared on approval.
ALTER TABLE maps ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
