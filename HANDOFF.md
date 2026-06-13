# Borderfall — mobile handoff (2026-06-13)

Continuation note for a cloud/mobile session. The desktop terminal session that
wrote this can't transfer its chat transcript or local memory, so this file is
the context bridge. Read it, then pick up wherever you like.

## Where things stand

- **Live game:** borderfall.gg. **Repo:** `JDix90/EmpireCities`. Main branch is `main`.
- **Era Advancement is DONE and MERGED.** PR #67 ("Era Advancement: complete mode,
  Phases 1–6") merged into `main` at commit `5939430`, CI green (backend + frontend).
  It covers: data-driven era spine, signatures + lineages, UX, AI/sim balance,
  ranked key, Space Age spine, and era victories (incl. Transcendence).
- Socket combat was unified through `executeLandAttack` (single combat path), and
  socket-attack integration tests (`gameAttackSocket.test.ts`, Redis-gated, runs in
  CI) now automate the combat-path smoke gate.
- Working tree was clean at handoff; no uncommitted local work to recover.

## Open / unverified items (post-merge follow-ups)

These were flagged as a "human pass" before merge — PR #67 merged anyway, so treat
them as **verify-in-prod / decide-later**, not blockers:

1. **Staging visual eyeball** — confirm Era Advancement UI renders correctly on
   staging/prod (nothing visually broken on the live era spine / victory screens).
2. **Tutorial playtest** — walk the era-advancement tutorial module end to end as a
   new player and confirm it reads well.
3. **2p / ranked snowball decision** — balance sim showed 1v1 first-advancer wins
   ~94% of the time (severe snowball). Mitigation in place: feature flag
   `ranked_era_advancement_enabled` ships **default OFF**. Decision still owed on
   whether/how to enable Era Advancement for ranked without the runaway-leader problem.

## Good next moves on mobile

- Skim `main` for anything that landed after `5939430`.
- Decide on the ranked snowball question (item 3) — it's the one real design call left.
- Or just ask for a fresh status snapshot and go from there.

> Note: this is a desktop-authored handoff; verify any file/flag names against the
> current tree before acting on them.
