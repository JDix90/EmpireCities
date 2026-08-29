# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first and follow it** — it is the canonical agent
guide (stack summary, key file paths, scripts, rules of thumb), and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is system ground truth. This file
only adds session-workflow notes that don't belong there. (Note:
[docs/CLAUDE.md](docs/CLAUDE.md) is unrelated — it's a paste-ready system
prompt for Claude Console/Projects, not agent instructions.)

## Verify before you claim

- Tests: `pnpm run test:backend`, `cd frontend && npx vitest run`; lint via
  `pnpm run lint`; typecheck with `npx tsc --noEmit` in both `backend/` and
  `frontend/`. Socket/integration tests are env-gated: `REDIS_TEST=1` (Redis on
  6379) and `PG_TEST=1`.
- CI truth is `gh api repos/<owner>/<repo>/commits/<EXACT-SHA>/check-runs`.
  `gh pr checks` and PR status rollups can show a stale superseded run — the CI
  workflow cancels in-progress runs on new pushes.
- PRs are often merged quickly, sometimes mid-session (with branch
  auto-delete). Re-check `gh api .../pulls/N --jq .state` and the head SHA
  before pushing more commits to a PR branch or editing a PR. `git push`
  printing `* [new branch]` for a branch you already pushed means it was
  merged+deleted — put follow-up work on a fresh branch off updated main.

## Environment gotchas

- `@borderfall/shared` resolves from its built `dist/`, not `src/`. After a
  fresh checkout, branch switch, or rebase that touches it:
  `pnpm --filter @borderfall/shared build`.
- Feature-flag defaults live in ONE place: `FLAG_CODE_DEFAULTS` in
  `backend/src/config/featureFlags.ts`. `admin_config.feature_flags` holds only
  deliberate operator overrides (the kill switch) and wins when present;
  `DEFAULTS.feature_flags` in `adminConfig.ts` is intentionally empty, because a
  key seeded there sits in the merged cache forever and shadows its code default.
  When a flag reads wrong on a real database, a stale override is pinning it —
  `pnpm -C backend exec tsx scripts/pruneFeatureFlagOverrides.ts` previews and
  `--apply` clears the redundant ones.
- The local dev Redis carries live admin-config cache; for isolated testing
  spin a throwaway `redis-server --port 6399 --save '' --appendonly no` instead
  of flushing anything shared.
- For live end-to-end verification, use a throwaway Postgres (e.g.
  `initdb … && LC_ALL=C pg_ctl -o "-p 5499 -k /tmp" start` — `LC_ALL=C` is
  required with Homebrew PG 18 on macOS), run
  `backend: npx tsx src/db/postgres/migrate.ts` then
  `npx tsx ../database/seedMaps.ts`. Never touch the developer's own clusters
  on ports 5432/5433/5434.

## Conventions

- New player-facing features ship dark-launched behind a flag: an entry in
  `FLAG_CODE_DEFAULTS` + a getter in `featureFlags.ts`, exposed via
  `getClientFeatureFlags()` → `frontend/src/store/featureFlagsStore.ts`, with a
  toggle entry in the Admin → Config panel (`CLIENT_FEATURE_FLAGS` in
  `AdminPage.tsx`) — every flag that defaults ON needs its kill switch visible
  there. Promote the code default to ON once the feature has been checked on
  staging; leaving it OFF in code while prod runs on an override is how the repo
  starts lying about what players actually see.
- Client-side persisted preferences use `cc-`-prefixed localStorage keys and
  are sanitized on load (see `utils/userPreferences.ts`,
  `utils/quickMatchPrefs.ts`).
- One focused PR per concern, branched off current `main`; commits read
  `feat(scope): …` / `fix(scope): …`; PR bodies state what was verified and how.
