---
name: feature-integration-playbook
description: Six-phase 0→1 feature integration process for the Borderfall codebase. Use when the user asks to add a new gameplay feature, enhancement, capability, mechanic, building, tech, wonder, faction ability, event card, or any 0→1 change that touches combat, economy, map, or server-authoritative state. Guides discovery, requirements elaboration, design placement (building vs tech vs event vs faction), implementation with AI parity, verification via tsc + lint + vitest + tiered browser smoke test, and retrospective.
---

# Feature Integration Playbook (Borderfall)

A safe, repeatable six-phase process for taking a new feature from an idea to shipped code without breaking gameplay, AI parity, or the verification gate. This playbook was distilled from the `coastal_battery` ("Fortify the Coast") integration.

## When to invoke this skill

Invoke whenever the user asks for work that:
- Adds a new **building, tech, wonder, event card, faction ability, or map-level mechanic**
- Changes **combat math, economy rules, or turn-phase behavior**
- Introduces a new **conditional bonus** (e.g. "only when attacked by sea", "only in winter", "only vs infantry")
- Requires changes to both **backend game engine** and **frontend UI** to surface the new capability

Do NOT invoke for: pure bug fixes, copy/UI tweaks, refactors, or doc-only changes.

## Mandatory opening move

Before touching code, create a TodoWrite with these exact phases:

- [ ] p1 — Discovery & Constraints
- [ ] p2 — Requirements Elaboration (with trade-off table if >1 design)
- [ ] p3 — Design & Placement Decision
- [ ] p4a — Backend data/state layer
- [ ] p4b — Backend combat/engine integration (human + AI parity)
- [ ] p4c — Frontend UI surface
- [ ] p4d — Unit tests (1 test per new conditional branch, minimum)
- [ ] p5 — Verification Gate (see below)
- [ ] p6 — Retrospective

**Hard rule:** Do not start p4 until p1–p3 deliverables exist as text in the chat. Do not start p5 until all p4 subtasks are complete.

---

## Phase 1 — Discovery & Constraints

Deliver a short written summary covering:

1. **Reference implementation** — the closest existing feature that touches the same subsystems. Read it. Name the file paths.
2. **Data layer impact** — which of these are affected: `GameState`, `TerritoryState`, `BuildingType` union, Postgres schema (including `maps` JSONB), Zustand client store, Socket.io event payloads.
3. **Gating flags** — which `state.settings.*_enabled` toggles gate the feature (e.g. `economy_enabled`, `naval_enabled`, `tech_trees_enabled`). The feature must no-op cleanly when its gating flag is off.
4. **Server authority** — confirm the new rule is calculated server-side in `backend/src/sockets/gameSocket.ts` or `backend/src/game-engine/**`. Never trust client-supplied bonus math.

Key repo pointers (from `AGENTS.md`):

| Area | Path |
|------|------|
| Socket game handlers | `backend/src/sockets/gameSocket.ts` |
| Game engine (state, combat, eras) | `backend/src/game-engine/` |
| Economy/buildings | `backend/src/game-engine/state/economyManager.ts` |
| Tech trees | `backend/src/game-engine/state/techManager.ts` |
| Events | `backend/src/game-engine/events/eventCardManager.ts` |
| Wonders | `backend/src/game-engine/state/wonderManager.ts` |
| Game UI shell | `frontend/src/pages/GamePage.tsx` |
| Territory panel | `frontend/src/components/game/TerritoryPanel.tsx` |
| Building panel | `frontend/src/components/game/BuildingPanel.tsx` |
| Bonuses modal | `frontend/src/components/game/BonusesModal.tsx` |
| Types (shared) | `backend/src/types/index.ts`, `packages/shared/src/index.ts` |

---

## Phase 2 — Requirements Elaboration

Produce, in chat:

1. **Trigger conditions** — exactly when the effect activates. Include the inverse: when it must NOT fire.
2. **Magnitude** — numeric values, with units (dice, %, resources/turn, etc.). Flag any balance-sensitive knob with `⚠ balance` and ask the user to confirm the number before implementation.
3. **Prerequisites** — what must be true on the territory / player / turn / era.
4. **Edge cases** — at least 5 scenarios, including: gating flag off, prerequisite missing, interaction with existing bonuses, save/load, AI-initiated path.
5. **UI surfaces** — every screen that needs to reflect the change. Default checklist: Build panel, Bonuses modal, battle report, tooltip/hover.

### Trade-off table (required when >1 viable design)

If there is more than one reasonable placement (e.g. building vs tech unlock vs faction ability), present this table before Phase 3:

| Option | How it works | Pros | Cons | Risk |
|--------|--------------|------|------|------|
| A: … | … | … | … | Low/Med/High |
| B: … | … | … | … | … |

End with a single-sentence recommendation and ask the user to confirm before proceeding.

---

## Phase 3 — Design & Placement Decision

Record the chosen placement with one-liners for:

- **Single source of truth** — the file/function where the new rule lives (e.g. `getSeaDefenseBonus` in `economyManager.ts`).
- **Call sites** — every place that must read from the source of truth. List both human and AI paths.
- **Event visibility** — which Socket.io events need to carry the new data (e.g. should the battle report show a `seaDefenseBonus` line).
- **No drive-by refactors** — call out any pre-existing issues noticed while mapping the design. Log them, do not fix them in this PR.

---

## Phase 4 — Implementation

Follow these rules strictly:

1. **Server first.** Backend types → state helper → combat/engine wiring → tests. Only then frontend.
2. **One layer at a time.** Do not edit frontend and backend in the same shell turn unless the change is a trivial rename.
3. **Extend existing helpers.** Prefer adding `getFooBonus(state, id)` next to existing `getBarBonus(state, id)` rather than sprinkling inline logic.
4. **AI parity is mandatory.** Every new defender/attacker bonus must be applied in BOTH the human `game:attack` handler AND the AI attack loop in `gameSocket.ts`. If you skip AI parity, the feature is not complete.
5. **Gating discipline.** Guard every new effect behind its `state.settings.*_enabled` flag. Unit-test the gated-off case.
6. **No narration comments.** Comments explain *why* (trade-offs, invariants, non-obvious constraints), never *what*.

### Phase 4d — Test requirements

Minimum test coverage for a new conditional rule:

- One test per new conditional branch (enabled × prerequisite-met × trigger-matched matrix).
- One "gated off" test per new setting flag.
- One test confirming unrelated helpers are unaffected (e.g. `getBuildingDefenseBonus` does not double-count a new building).

See `reference.md` for a full test skeleton.

---

## Phase 5 — Verification Gate

Run the one-shot verifier from repo root:

```bash
bash .cursor/skills/feature-integration-playbook/scripts/verify.sh
```

It executes, in order and aborts on first failure:

1. `pnpm -C backend exec tsc --noEmit`
2. `pnpm -C frontend exec tsc --noEmit`
3. `pnpm run lint`
4. `pnpm run test:backend`

Also run `ReadLints` on every file you edited.

### Browser smoke test — choose a tier

| Tier | When to use | What to verify | Budget |
|------|-------------|----------------|--------|
| **T1 — Load-safe** | UI-invisible rules (math-only changes that already have unit tests) | Game loads, no new console errors on affected page | ~5 min |
| **T2 — Happy path click-through** | New UI surface (new build option, new modal entry, new button) | T1 + click the new surface once, confirm no crash, confirm correct enabled/disabled state | ~15 min |
| **T3 — Scripted integration** | Feature changes turn-resolution math users can perceive | Full turn loop that exercises the new code path end-to-end; usually a separate follow-up task with its own estimate | 30+ min |

Default to T2. Escalate to T3 only on explicit user request or for turn-resolution math. Log any unrelated issues observed during smoke (e.g. transient pg-pool errors) in the Phase 6 retrospective without fixing them in this PR.

Use the `cursor-ide-browser` MCP server for the smoke test. Always `browser_tabs list` → `browser_lock` → interact → `browser_lock unlock` per its server-use instructions.

---

## Phase 6 — Retrospective

After the verifier passes and the user confirms it works, post a short retrospective covering:

1. **What went well** — which phases caught bugs early.
2. **What friction appeared** — tools, repo gotchas, surprises.
3. **Pre-existing issues logged** — with file:line refs. Do not fix, just log.
4. **Playbook improvements** — concrete edits to this skill. If you change this skill, also bump the retrospective bullet in `reference.md` under "Change log".

---

## Repo-specific gotchas (read every time)

- **Maps in Postgres.** Map documents (`maps` table) and game sessions (`games`) share PostgreSQL — distinguish `map_id` vs `game_id` when debugging.
- **Server-authoritative.** Combat math runs in `gameSocket.ts` and emits results. Clients display only.
- **AI parity gap risk.** The AI attack loop is a separate code path from the human `game:attack` handler. Grep for both `aiAttackerId` and `attackerId` paths when adding combat bonuses.
- **Connection types.** `IConnection.type` is `'land' | 'sea' | 'orbit'`. Sea-conditional logic must check this explicitly.
- **HMR limits.** Backend uses `tsx-watch`; a code edit reloads the server but in-memory game state is LOST. Smoke tests usually need a fresh game.
- **Pre-existing flakiness.** `pg-pool` occasionally logs `Connection terminated unexpectedly`. It is not caused by feature work. Log it, move on.

## Additional resources

- Templates (trade-off table, test skeleton, smoke-tier checklist, retrospective): [reference.md](reference.md)
- One-shot verifier: [scripts/verify.sh](scripts/verify.sh)

## Change log

- 2026-04-22 — v1. Distilled from the `coastal_battery` ("Fortify the Coast") integration.
