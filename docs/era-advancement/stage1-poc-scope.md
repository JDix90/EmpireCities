# Era Advancement — Stage 1 PoC Scope

**Trigger:** Post-launch, when retention data shows players want more strategic depth.  
**Prerequisite:** [stage1-spec.md](./stage1-spec.md) approved.  
**Effort:** 4–8 weeks solo (AI deferred to Stage 2).

---

## PoC goal

Prove the **"should I advance?"** decision is fun in a real Borderfall match with minimum content:

- Two eras (Ancient → Medieval)
- Human vs human acceptable for first playtest
- Signature payoff = **+1 attack die on first post-advance land combat** (no new art)
- Toggle-gated; off = today's game

**Success criteria:**

1. At least one playtest where advancer felt tension during vulnerability window
2. At least one playtest where stayer chose to strike during window
3. At least one playtest where a player won **without** advancing
4. No game crashes / state corruption when toggle off
5. Combat modifier tests pass for era gaps 0, 1, 2

---

## Implementation phases

### Phase A — Data & settings (≈3 days)

| Task | File(s) |
|------|---------|
| Add `PlayerState` fields per spec §4 | `backend/src/types/index.ts` |
| Add `GameSettings` tunables + normalize defaults | `backend/src/types/index.ts`, `backend/src/game-engine/state/gameSettings.ts` |
| Zod + lobby create validation | `backend/src/modules/games/games.routes.ts` |
| Reject when `is_campaign` or `is_ranked` | `backend/src/modules/games/games.routes.ts` |
| Init `current_era_index: 0` when enabled | `backend/src/game-engine/state/gameStateManager.ts` |
| Store `last_turn_production_income` on production tick | `backend/src/game-engine/state/economyManager.ts` |
| Era sequence constant (PoC) | `backend/src/game-engine/eraAdvancement/constants.ts` (new) |

### Phase B — Advance action (≈5 days)

| Task | File(s) |
|------|---------|
| `getEmpireWeightedStability()` | `backend/src/game-engine/state/stabilityManager.ts` |
| `canAdvanceEra()` gate checks | `backend/src/game-engine/eraAdvancement/advanceEra.ts` (new) |
| `executeAdvanceEra()` conversion + echo + signature charge | same |
| `game:advance_era` socket handler | `backend/src/sockets/gameSocket.ts` |
| Decrement `era_transition_turns_remaining` at turn start | `gameSocket.ts` / `advanceToNextPlayer` |
| Redis persist new fields | automatic via JSON stringify |
| Vitest: gates, conversion, cost escalation | `backend/src/game-engine/eraAdvancement/advanceEra.test.ts` |

### Phase C — Cross-era combat (≈4 days)

| Task | File(s) |
|------|---------|
| `getPlayerEraIndex(state, playerId)` helper | `eraAdvancement/constants.ts` |
| Era gap dice modifier in land combat | `backend/src/game-engine/combat/combatModifiers.ts` |
| Vulnerability defense mult | `combatModifiers.ts` |
| Signature +1 attack die consumption on attack | `gameSocket.ts` `game:attack` |
| Vitest: gap 0/1/2, vuln mult, signature consume | `combatModifiers.test.ts` |

### Phase D — Client UI (≈5 days)

| Task | File(s) |
|------|---------|
| Lobby toggle + tooltip | `frontend/src/pages/LobbyPage.tsx` |
| Show opponent era badges on player roster | `frontend/src/components/game/GameHUD.tsx` |
| "Advance Era" button + cost/gate display | `frontend/src/components/game/TerritoryPanel.tsx` or new `AdvanceEraPanel.tsx` |
| Vulnerability badge on own HUD | `GameHUD.tsx` |
| `game:advance_era` emit | `GamePage.tsx` |
| Client state types | `frontend/src/store/gameStore.ts` |
| Map visual event on advance | reuse `mapVisualEvents` pattern |

### Phase E — Verification (≈2 days)

```bash
pnpm run lint
pnpm run test:backend
pnpm exec tsc --noEmit -p backend/tsconfig.json
pnpm -C frontend exec tsc --noEmit
```

Manual smoke (2 humans or 1 human + observe):

1. Create game with era advancement **off** → plays normally
2. Create game with era advancement **on**, economy + tech + stability on
3. Advance on turn 4–6 when gates pass
4. Opponent attacks during vulnerability window
5. Confirm signature +1 die fires once
6. Win without advancing (stayer path)

---

## Explicitly deferred (not in PoC)

| Item | Stage |
|------|-------|
| AI advance / stay heuristic | Stage 2 |
| Discovery+ eras | Stage 3 |
| Era-unique wonders | Stage 3 |
| Cultural / Tech victory | Stage 4 |
| Terrain-by-era | Stage 5 |
| Doctrines | Stage 6 |
| Ranked compatibility | Post-balance |
| `era_advancement_playtest.html` in repo | Optional tooling |

---

## AI placeholder (Stage 2 prep)

When enabled, AI should **never advance in PoC** (no handler). Document in code:

```typescript
// PoC: AI does not advance; humans only. See Stage 2.
```

Prevents silent AI parity bugs during human playtests.

---

## Config template (lobby preset)

```json
{
  "era_advancement_enabled": true,
  "economy_enabled": true,
  "tech_trees_enabled": true,
  "stability_enabled": true,
  "factions_enabled": true,
  "era_advancement_conversion_ratio": 0.70,
  "era_advancement_cost_mult": 2.0,
  "era_advancement_stability_gate": 60,
  "era_advancement_tech_gate_pct": 0.50
}
```

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Conversion ratio wrong | All tunables in `GameSettings`; no magic numbers |
| Nobody advances | Loosen cost mult after 10 playtests |
| Everyone advances | Tighten conversion ratio |
| Era-scoped systems read `state.era` incorrectly | Audit grep `state.era` in attack/tech/build paths; use `getPlayerEraIndex` where player-specific |
| Campaign confusion | Mutually exclusive flags + distinct lobby copy |

---

## Sign-off checklist before merge

- [ ] Toggle off regression: existing vitest green
- [ ] `advanceEra.test.ts` ≥ 8 cases
- [ ] `combatModifiers.test.ts` era gap cases added
- [ ] Lobby creates game with flag persisted in `settings_json`
- [ ] Manual smoke doc updated in PR description
- [ ] No ranked / campaign combination allowed
