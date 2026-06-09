# Era Advancement — Stage 1 Specification

**Status:** PoC shipped (human-only); Stage 2 adds AI parity  
**Scope:** Resolves the eight open gaps from the architecture review before any PoC code.  
**Prerequisite:** [stage0-pen-paper-validation.md](./stage0-pen-paper-validation.md) (§5.5 pass)

---

## 1. Mode overview

| Property | Value |
|----------|-------|
| Lobby flag | `era_advancement_enabled: boolean` (default `false`) |
| Eras in PoC | `ancient` (index 0) → `medieval` (index 1) only |
| Match end | Unchanged — domination / threshold / capital / secret_mission |
| Toggle off | Identical to today's game (P3) |

When enabled, each player has an independent `current_era_index` (0 or 1 in PoC). The match `GameState.era` remains the **lobby-selected era** for map/events/deck defaults; player-specific systems use `getPlayerEra(player)`.

---

## 2. Gap resolutions

### 2.1 Map policy (same map for entire match)

**Decision:** The lobby `map_id` is fixed for the full session. Advancement does **not** reload map geometry or swap to `era_medieval.json`.

| Persists across advance | Changes on advance |
|-------------------------|-------------------|
| Territory ownership, buildings, population, stability | Player's effective unit roster tier |
| Map connections, continent bonuses | Player's tech tree context |
| `special_resource` (gold) balance | Player's combat era multiplier |
| Faction identity | Signature unit eligibility |

**Rationale:** Borderfall loads the map once per session (`resolveMap` → `game:map`). Hot-swapping maps mid-game does not exist. Campaign solves multi-map via **new games** — a different product surface.

**UX copy:** "Your civilization advances through history; the battlefield geography stays the same."

---

### 2.2 Stability gate definition

**Decision:** Population-weighted empire average stability.

```
empire_stability(player) =
  Σ (territory.stability × territory.population)
  ÷ Σ territory.population
```

over all territories owned by the player where `stability` is defined.

| Gate | Value |
|------|-------|
| Minimum to advance | **60** (on 0–100 scale) |
| When `stability_enabled` is off | Gate **skipped** (advancement allowed without stability check) |

**Rationale:** Ties advancement to the population/stability USP. A sprawling low-stability empire cannot "buy" its way up the era ladder.

**Implementation path:** New helper in `stabilityManager.ts`: `getEmpireWeightedStability(state, playerId)`.

---

### 2.3 Gold income definition (advancement cost)

**Decision:** Advancement cost uses **gross production income from the prior economy tick**, not net after spending.

In Borderfall's economy layer (`economyManager.ts`), in-match resources are `player.special_resource` (displayed as gold in UI). Income per turn = output of `applyProductionIncome()`:

- Building production (scaled by stability/population when enabled)
- Base: `max(1, floor(owned_territories / 3))`
- Event `production_bonus` modifiers

**Cost formula (PoC):**

```
advance_cost(player, from_era_index) =
  last_turn_production_income(player)
  × era_advancement_cost_multiplier   // default 2.0
  × pow(1.5, from_era_index)
```

Store `last_turn_production_income` on `PlayerState` when production is applied (new field, default 0).

| Parameter | Default | Config key |
|-----------|---------|------------|
| Cost multiplier (era 0→1) | 2.0 | `settings.era_advancement_cost_mult` |
| Escalation per era | 1.5× | `settings.era_advancement_cost_escalation` |

**Validation:** Player must have `special_resource >= advance_cost` at action time.

---

### 2.4 Tech tree transition rules

**Decision:** Hard reset research list; permanent bonuses echo forward.

| On advance | Behavior |
|------------|----------|
| `unlocked_techs` | **Cleared** — new era tree starts fresh |
| `tech_points` | **Retained** (unspent TP carry) |
| Completed tech effects | **Permanent passives** stored in new field `era_advancement_tech_echo: Record<string, number>` |

**Echo capture (PoC):** When advancing, snapshot numeric bonuses already applied from the departing era's unlocked techs into `era_advancement_tech_echo`. Examples:

- `+1 fortify_moves` from a completed ancient tech → stored as `{ fortify_moves_bonus: 1 }`
- Combat/attack bonuses already in `techManager` paths → re-applied via echo map in `getPlayerAttackBonus` / `getPlayerDefenseBonus`

**Tech gate (milestone model — default):**

Setting: `era_advancement_tech_gate_mode: 'milestone' | 'percent'` (default **`milestone`**).

When `milestone` and `tech_trees_enabled`, all three must pass (AND):

| Requirement | Default | Meaning |
|-------------|---------|---------|
| `era_advancement_min_tier1_techs` | **3** | Foundation tree engagement |
| `era_advancement_min_tier2_techs` | **1** | At least one mid-tree branch |
| `era_advancement_min_buildings` | **1** | Built any non-wonder building on owned territory |

**Legacy percent mode** (`era_advancement_tech_gate_mode: 'percent'`):

```
unlocked_count / era_tech_tree_length >= era_advancement_tech_gate_pct
```

Default pct is **0.33** (4/12 Ancient). Use for A/B tuning only.

When `tech_trees_enabled` is off: gate **skipped**.

**Economy bootstrap (all economy + tech games):** Non-tutorial matches with `economy_enabled && tech_trees_enabled` start with `economy_tech_starting_tech_points` (default **3**) and `economy_tech_starting_gold` (default **4**), plus one opening production/tech income tick for all players at game start.

---

### 2.5 Faction policy

**Decision:** **Faction is fixed for the match.** `faction_id` does not change on advance.

| Stays fixed | Shifts with player era |
|-------------|------------------------|
| `faction_id`, passive abilities, faction color | Tech tree, signature unit, era combat tier |
| Faction ability cooldowns / uses | Event card eligibility (use lobby era deck) |

**Rationale:** Factions are tied to lobby era definitions (`getEraFactions(state.era)`). Re-picking faction per advance multiplies content and UI. Era advancement changes **military technology tier**, not national identity.

**Exception (future):** Doctrines (Stage 6) add emphasis without changing faction.

---

### 2.6 Multiplayer edge cases

| Scenario | Rule |
|----------|------|
| Advance during own turn | **Allowed** in draft or attack phase only (not fortify — you're consolidating). Costs the action for that phase (cannot attack same turn after advancing in attack phase). |
| Advance while under attack | **Allowed** if gates pass. Vulnerability window applies immediately; opponent can attack on their next turn. |
| Advance mid-async deadline | **Allowed.** Async deadline is per-turn, not per-phase. Vulnerability lasts through the advancing player's current turn and clears at their next turn start. |
| Two players advance same turn | Independent; order irrelevant (no shared world state). |
| Eliminated player | Cannot advance. |
| Spectators | See all players' era index and vulnerability badge. |

**Transition state:** New `PlayerState.era_transition_turns_remaining: number` (0 or 1). When `1`, apply −25% effective defender power in combat for that player.

---

### 2.7 Ranked / async policy

| Context | Era advancement |
|---------|-----------------|
| Unranked casual | **Enabled** when lobby toggle on |
| Ranked (`is_ranked: true`) | **Disabled in PoC.** Revisit after balance data. |
| Async (`async_mode: true`) | **Enabled** when toggle on. Vulnerability window spans the advancing player's full async turn (may be hours — acceptable; opponent gets email/push on advance). |
| Campaign games | **Disabled** — campaign has its own cross-game era progression. Mutually exclusive with `is_campaign`. |
| Tutorial | **Disabled** |

**Validation in `games.routes.ts`:** Reject `era_advancement_enabled` when `is_campaign` or `is_ranked` (PoC).

---

### 2.8 Relationship to Campaign (player-facing copy)

| Mode | Tagline |
|------|---------|
| **Campaign** | "Play through history — one era per chapter, carry your legacy between games." |
| **Era Advancement** | "Climb through history inside a single match — invest when you're ready, while opponents may stay behind." |
| **Standard** | "Fight in one era from start to finish." |

Lobby tooltip for the toggle:

> "Optional: spend resources to advance your civilization to the next era mid-match. Stronger units and new options, but advancement weakens your army briefly and costs gold. Opponents choose their own pace."

---

## 3. Core mechanics (PoC numbers)

All config-tunable via `GameSettings` extension block:

| Parameter | Default |
|-----------|---------|
| `era_advancement_enabled` | `false` |
| `era_advancement_conversion_ratio` | `0.70` |
| `era_advancement_strength_step` | `1.40` |
| `era_advancement_cost_step` | `1.25` (unit cost scaling) |
| `era_advancement_cost_mult` | `2.0` |
| `era_advancement_cost_escalation` | `1.5` |
| `era_advancement_stability_gate` | `60` |
| `era_advancement_tech_gate_pct` | `0.50` |
| `era_advancement_vuln_defense_mult` | `0.75` |
| `era_advancement_vuln_turns` | `1` |
| `era_advancement_max_era_index` | `1` (PoC) |

### Advance action (`game:advance_era`)

1. Validate: mode on, player's turn, phase draft/attack, gates pass, not at max era, not in campaign.
2. Deduct `special_resource` (advance cost).
3. Convert units: `new_units = floor(total_units × conversion_ratio)` across all owned territories (proportional distribution).
4. Set `current_era_index += 1`.
5. Set `era_transition_turns_remaining = 1`.
6. Reset `unlocked_techs`, capture tech echo.
7. Grant signature payoff (PoC: `medieval_signature_charges = 1` → +1 attack die on next land attack).
8. Broadcast state + map visual event.

### Cross-era combat

In `computeLandCombatModifiers`, add era gap modifier:

```
gap = attacker_era_index - defender_era_index
effective_gap = clamp(gap, -2, 2)  // soft cap
attacker_bonus += max(0, effective_gap) × era_strength_bonus_dice
defender_bonus += max(0, -effective_gap) × era_strength_bonus_dice
```

PoC: `era_strength_bonus_dice = 1` per era gap (tunable). Apply vulnerability mult to defender dice when `era_transition_turns_remaining > 0`.

---

## 4. State schema additions

```typescript
// PlayerState (when era_advancement_enabled)
current_era_index?: number;           // default 0
era_transition_turns_remaining?: number;
last_turn_production_income?: number;
era_advancement_tech_echo?: Record<string, number>;
medieval_signature_charges?: number;  // PoC payoff
```

```typescript
// GameSettings extension
era_advancement_enabled?: boolean;
era_advancement_conversion_ratio?: number;
// ... other tunables from §3
```

When `era_advancement_enabled` is false, omit or zero these fields; `current_era_index` is not consulted.

---

## 5. Files to touch (reference)

See [stage1-poc-scope.md](./stage1-poc-scope.md) for implementation checklist.

---

## 6. Out of scope for Stage 1

- AI advancement decisions (Stage 2)
- Doctrines (Stage 6)
- Cultural / Tech victory paths (Stage 4)
- Terrain-by-era (Stage 5)
- Eras beyond medieval (Stage 3)
- Ranked games
- Map hot-swap
