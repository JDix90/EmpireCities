# Era Advancement — Stage 3 Scope (Era Spine Extension)

**Status:** Planned — separate content milestone after Stage 2 AI parity  
**Prerequisite:** Stage 1 close-out + Stage 2 AI parity shipped and playtested

---

## Goal

Extend per-player advancement beyond Ancient → Medieval to **Discovery and later eras**, with per-era signature payoffs and optional era-unique wonders.

---

## Engineering work

| Task | Files / notes |
|------|----------------|
| Extend `ERA_ADVANCEMENT_SEQUENCE` | `backend/src/game-engine/eraAdvancement/constants.ts` — add `discovery`, `ww2`, … per design |
| Raise `era_advancement_max_era_index` default | Settings + lobby copy |
| Generalize signature payoff | Replace `medieval_signature_charges` with `era_signature_charges: Record<string, number>` or per-era field map |
| Tech gate 1→2 (6/12 medieval nodes) | Already specified in stage1-spec §2.4 |
| Wire `strength_step` / `cost_step` | Combat + unit cost scaling per Stage 0 pen-and-paper (1.40× / 1.25×) |
| Era-scoped system audit | Grep `state.era` vs `resolvePlayerEraId` in attack/tech/build paths |
| Era-unique wonders | Use [feature-integration-playbook](../../.cursor/skills/feature-integration-playbook/SKILL.md) |

---

## Content work

- Discovery+ tech trees already exist per lobby era — verify advancement echo capture for each departing era.
- Signature payoffs per era (not only +1 attack die).
- Wonder eligibility rules per player era index.

---

## Out of scope (Stage 3)

- Cultural / Tech victory (Stage 4)
- Terrain-by-era (Stage 5)
- Doctrines (Stage 6)
- Ranked re-enable (post-balance)

---

## Estimated effort

4–6 weeks (content-heavy; parallel art/copy + engine extension).
