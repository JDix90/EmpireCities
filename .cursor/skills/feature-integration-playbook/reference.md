# Feature Integration Playbook — Reference Templates

Copy-paste scaffolds the agent uses when executing the SKILL.md phases. Keep this file for detail; keep SKILL.md for guidance.

---

## Phase 2 — Requirements doc template

Copy this outline into chat and fill every field before starting Phase 3.

```
### Feature: <name>

**One-sentence description**
<A player-facing description.>

**Trigger conditions**
- Fires WHEN: <list>
- Does NOT fire when: <list>

**Magnitude**
- <knob 1>: <value> <unit>  ⚠ balance (needs user confirmation)
- <knob 2>: <value> <unit>

**Prerequisites**
- Territory: <...>
- Player: <...>
- Era / phase / turn: <...>
- Settings: <economy_enabled | naval_enabled | tech_trees_enabled | ...>

**Edge cases (≥5)**
1. Gating flag off → expect no-op
2. Prerequisite missing → expect validation error "<exact copy>"
3. Stacking with <existing bonus> → expect <additive | capped | overridden>
4. Save/load round-trip → expect preservation
5. AI-initiated path → expect same math as human path

**UI surfaces**
- [ ] Build panel
- [ ] Bonuses modal
- [ ] Battle report
- [ ] Tooltip / hover
- [ ] Other: <...>
```

---

## Phase 2 — Trade-off table template

Required whenever ≥2 placements are viable (e.g. building vs tech vs faction vs event card).

```
| Option | Placement file | How it works | Pros | Cons | Risk |
|--------|----------------|--------------|------|------|------|
| A: Building | economyManager.ts | Adds BuildingType + per-territory bonus | Per-territory granularity, reuses build UI | Adds a new BuildingType | Low |
| B: Tech unlock | techManager.ts | New TechNode grants global bonus | No new building art, tech-tree consistent | Player-wide, not territory-specific | Med |
| C: Event card | eventCardManager.ts | Temporary modifier for N turns | Easy to balance, time-boxed | Feels less permanent | Low |

**Recommendation:** <option X> because <one sentence>.
```

End with an explicit prompt to the user: *"Confirm option X before I start Phase 3."*

---

## Phase 3 — Design decision template

```
### Design decision

- **Chosen placement:** <Option X>
- **Source of truth:** `<file>::<exported function>`
- **Call sites:**
  - Human combat: `backend/src/sockets/gameSocket.ts` near line <N>
  - AI combat: `backend/src/sockets/gameSocket.ts` in AI attack loop near line <N>
  - <any other caller>
- **New Socket.io event fields:** <none | list>
- **Balance knobs exposed to user:** <list>
- **Pre-existing issues observed (LOGGED, NOT FIXED):**
  - <file:line> — <one-sentence description>
```

---

## Phase 4d — Vitest test skeleton

Drop into a colocated `*.test.ts` next to the code it exercises. At minimum include the four-test matrix.

```typescript
import { describe, it, expect } from 'vitest';
import { getFooBonus } from './fooManager';
import type { GameState } from '../../types';

function makeState(overrides: Partial<GameState> = {}): GameState {
  // Minimal fixture. Prefer reusing an existing test factory if one exists.
  return {
    settings: { economy_enabled: true, naval_enabled: true } as any,
    territories: {},
    // ...
    ...overrides,
  } as GameState;
}

describe('getFooBonus', () => {
  it('returns the bonus when enabled + prerequisite met + trigger matched', () => {
    // arrange: state with prerequisite, call site with trigger
    // act + assert
  });

  it('returns 0 when gating flag is off', () => {
    // arrange: settings.economy_enabled = false
  });

  it('returns 0 when prerequisite is missing', () => {
    // arrange: territory without the required building
  });

  it('returns 0 when trigger condition is not matched', () => {
    // e.g. land attack for a sea-only bonus
  });

  it('does not leak into unrelated helper (e.g. getBuildingDefenseBonus)', () => {
    // guardrail against double-counting
  });
});
```

---

## Phase 5 — Smoke test tier checklist

### T1 — Load-safe (UI-invisible changes)

```
- [ ] Dev servers show clean HMR for edited files (no syntax errors in terminal)
- [ ] Navigate to the page most likely affected
- [ ] Open DevTools console, record any NEW errors (baseline-diff)
- [ ] Capture one screenshot
```

### T2 — Happy path click-through (new UI surface)

T1 plus:

```
- [ ] Reach the screen that exposes the new surface (may require a fresh game / specific settings)
- [ ] Verify the surface renders with correct enabled/disabled state
- [ ] Click once; confirm no crash, confirm the expected UI response
- [ ] Confirm the surface is HIDDEN in the correct negative case (wrong era, flag off, prereq missing)
- [ ] Capture two screenshots (positive + negative)
```

### T3 — Scripted integration (usually a follow-up task)

T2 plus a full turn loop. Out of scope for the default playbook pass — request a separate task with its own estimate. Only run inline if the user explicitly asks.

---

## Phase 6 — Retrospective template

```
### Retrospective: <feature name>

**Went well**
- <phase that caught a bug / prevented rework>

**Friction**
- <tool / repo surprise / gotcha>

**Pre-existing issues logged (not fixed)**
- `<file:line>` — <description>
- `<file:line>` — <description>

**Balance knobs needing playtesting**
- <knob> at <current value>

**Playbook improvements (propose edits to SKILL.md)**
- <concrete change>
```

If you edit SKILL.md as a result, append a dated bullet under its "Change log" and mirror it below.

---

## Change log

- 2026-04-22 — v1 templates, aligned with SKILL.md v1 and `coastal_battery` integration.
