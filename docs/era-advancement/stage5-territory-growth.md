# Stage 5 — Era Advancement territory growth (ADR)

**Status:** Accepted · **Supersedes (in part):** [`stage1-spec.md`](./stage1-spec.md) §2.1 "Map policy"

## Context

A core promise of Era Advancement is that the playable battlefield should **grow** as
players climb eras — new lands open up over the course of a single match. A six-angle
investigation of the codebase found this feature was **never built at any layer**:
`executeAdvanceEra` mutated only player/unit state, `state.territories` was fixed at init,
the data model had no era-gating field, no map geometry was re-emitted on advance, and the
client captured the territory set once at load. The original Stage 1 spec (§2.1) had in fact
decided the opposite — "the lobby `map_id` is fixed for the full session" — and parked
"Terrain-by-era" in a deferred Stage 5.

We also confirmed the per-era maps (`era_ancient` … `era_space_age`) **cannot** be reused as a
growing series: consecutive eras share **zero** territory ids (they are independent
re-partitions of the world, with non-monotonic counts), so they can be neither hot-swapped
without losing all ownership/units nor additively merged. True growth therefore requires an
authored base map plus per-era expansion sets.

## Decision

1. **Additive growth, not hot-swap.** A match stays on one `map_id`. Territories tagged with
   `unlock_era_index > 0` are held out of the live board at game start and **added** when the
   board's era floor reaches them. The starting board, ownership, buildings, population,
   stability, and existing connections all persist. There is still **no** swap to another
   era's map file — §2.1's "no map hot-swap" half stands; only its "geometry never changes"
   half is superseded.

2. **Global growth, triggered by the first player to reach an era.** Era Advancement is
   per-player, but the board is shared, so growth is global: when the first (non-eliminated)
   player reaches era index *N*, the era-*N* frontier opens for everyone. Tracked by
   `GameState.map_era_floor` (`globalEraFloor` = max living `current_era_index`).

3. **New territories appear neutral, lightly garrisoned.** Each unlocked frontier spawns
   `owner_id: null` with a small garrison (`NEUTRAL_UNLOCK_GARRISON`), to be conquered —
   generalizing the existing lunar neutral-garrison pattern (`state/moonAccess.ts`).

4. **Neutral garrisons are conquerable — gated.** `executeLandAttack` normally rejects
   owner-less targets. It now allows capturing a neutral garrison, but **only** when
   `era_advancement_enabled`, and **never** for off-world targets (`world_id !== 'earth'`),
   which keep their "tech up to claim it" access race (the Space Age Moon, galaxy neutral
   worlds). Standard games are unchanged.

5. **Content is authored per map.** Maps opt in by tagging territories with `unlock_era_index`
   and wiring each frontier into the connection graph (every frontier must border an
   already-in-play territory so it is reachable on unlock). Untagged maps are unaffected.

## Mechanism (ground truth)

- `backend/src/game-engine/eraAdvancement/territoryUnlock.ts`
  - `projectMapToEraFloor(map, floor)` — every `game:map` emission is projected to the current
    floor, so clients only ever receive in-play territories + connections.
  - `unlockTerritoriesForFloor(state, map)` — idempotent neutral-garrison insertion for the
    `(prevFloor, newFloor]` window; raises `map_era_floor`; returns added ids.
- `gameStateManager.initializeGameState` — holds back tagged territories; seeds `map_era_floor = 0`.
- `gameSocket` — on era advance (human **and** AI): unlock, re-emit the projected `game:map`,
  emit `game:territories_unlocked` (client cue), then broadcast state (neutral ownership/units).
- Data model — `MapTerritory.unlock_era_index`, `GameState.map_era_floor`.
- Content (MVP) — `database/maps/era_ancient.json` grows outward (Medieval: Scandinavia,
  Volga Bulgaria, Sahara; Discovery: North America, South America, Nippon, Nusantara).

## Relationship to Campaign

Unchanged and still distinct:
- **Campaign** = cross-**game** progression, one era per chapter, multiple separate maps.
- **Era Advancement** = single-**match** climb; the board now **grows additively** within that
  one match. The two remain mutually exclusive product surfaces.

## Consequences

- Victory/domination already counts `Object.keys(state.territories).length` live, so a growing
  board automatically requires conquering the new frontiers; `last_standing` is unaffected.
- Off-world neutral-claim mechanics (Moon / galaxy) are preserved by the carve-out in (4).
- Untagged maps and non-era-advancement games have zero behavior change (projection is a no-op;
  the combat change is gated).

## Follow-ups (not yet done)

- **AI does not yet attack neutral frontiers** (it skips neutral targets); AI-heavy games will
  leave frontiers un-contested until this is added.
- **Content scale** — only `era_ancient` is authored; the engine scales to more maps/eras.
- **Balance** — garrison size, region bonuses, and continent-bonus math on a growing board want
  tuning passes.
- **Render polish** — a mid-game `game:map` re-emit re-initializes the renderers; consider an
  incremental update + entrance animation for newly unlocked land.
