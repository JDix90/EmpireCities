# Era Advancement Mode — Design Package

Optional per-player era progression layered on standard Borderfall matches. **Not scheduled for pre-launch.**

| Document | Purpose |
|----------|---------|
| [stage0-pen-paper-validation.md](./stage0-pen-paper-validation.md) | §5.5 playthrough results — vulnerability window pass |
| [stage1-spec.md](./stage1-spec.md) | Resolved spec (8 gaps closed) for engineering |
| [stage1-poc-scope.md](./stage1-poc-scope.md) | PoC implementation checklist |
| [stage1-playtest-notes.md](./stage1-playtest-notes.md) | Stage 1 sign-off + manual smoke tracker |
| [stage2-spec.md](./stage2-spec.md) | AI advance/stay + vulnerability striker |
| [stage3-scope.md](./stage3-scope.md) | Discovery+ era spine extension (planned) |

**Source design:** `Borderfall_Era_Advancement_Design_v2.md` (external)

**Architecture review:** `.cursor/plans/era_advancement_review_006d0990.plan.md`

**Economy bootstrap:** All non-tutorial games with economy + tech trees start with 3 TP and 4 gold (configurable via `economy_tech_starting_tech_points` / `economy_tech_starting_gold`), plus one opening income tick. Era advancement uses a **milestone** readiness gate by default (3 tier-1 techs + 1 tier-2 tech + 1 building) instead of 50% of the full tree.
