# Era Advancement — Stage 2 Specification (AI Parity)

**Status:** Implemented  
**Prerequisite:** [stage1-spec.md](./stage1-spec.md) PoC shipped (human-only sign-off)  
**Scope:** AI opponents can advance or stay, and exploit vulnerability windows.

---

## 1. Goals

- Enable solo and hybrid era-advancement games (1 human + AI).
- AI uses the same `executeAdvanceEra` path as humans (no shortcuts).
- AI strikes vulnerable opponents during `era_transition_turns_remaining > 0`.
- Tutorial AI never advances.

---

## 2. Advance / stay heuristic

Evaluated at **start of AI draft phase** in `processAiTurn`, before card redeem and draft placement.

### Hard prerequisites

- `era_advancement_enabled` is true.
- `canAdvanceEra` passes (gold, stability, tech gate, not at max era).
- Turn number ≥ 4 (expert exempt — may advance earlier when secure).

### Scoring model

```
advance_score =
  +4 if any opponent has higher current_era_index
  +3 if gold buffer after cost ≥ 1× last_turn_production_income
  +2 if gold buffer ≥ 2× income
  +3 if border threat < 5 enemy units on adjacent land borders
  +2 if border threat < 2
  +2 if still in era 0 and turn ≥ 6
  -3 if stability within 10 points of gate minimum
  -5 if border threat ≥ 10
  -3 extra if border threat ≥ 15
```

### Difficulty thresholds

| Difficulty | Threshold | Notes |
|------------|-----------|-------|
| tutorial | ∞ (never) | Unchanged tutorial flow |
| easy | 12 | 15% random advance chance when score would pass |
| medium | 6 | Default solo opponent |
| hard | 4 | Advances when strategically secure |
| expert | 3 | May advance before turn 4 if gates pass |

Implementation: [`backend/src/game-engine/ai/aiEraAdvancement.ts`](../../backend/src/game-engine/ai/aiEraAdvancement.ts)

---

## 3. Vulnerability striker

During `selectAttacks`, boost attack candidate score when defender has `era_transition_turns_remaining > 0`:

| Difficulty | Bonus |
|------------|-------|
| easy | +1 |
| medium | +2 |
| hard / expert | +4 |

This creates the Stage 0 "strike now?" tension against AI advancers.

---

## 4. Tech tree parity

AI building and research paths use `resolvePlayerEraId(state, player)` instead of lobby `state.era` when era advancement is enabled.

Files: [`aiBot.ts`](../../backend/src/game-engine/ai/aiBot.ts) — `selectAiTechResearch`, `selectAiBuildingPlacement`.

---

## 5. Out of scope (Stage 2)

- Eras beyond medieval (Stage 3)
- Ranked games
- Async push notifications on advance
- ML / learned policies

---

## 6. Verification

- `aiEraAdvancement.test.ts` — scoring unit tests
- `advanceEra.test.ts` — AI allowed when gates pass
- Manual: `pnpm -C backend exec tsx scripts/eraAdvancementPlaytest.ts` with feature flag enabled
