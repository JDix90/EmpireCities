# Community Map Fixes — Requirements & Implementation Plan

## Overview

Automated and manual analysis of the five community maps identified **1 critical validation failure**, **2 medium gameplay-balance issues**, and **3 low-priority balance suggestions**. This document specifies each issue in full detail with exact file locations, JSON payloads, and step-by-step implementation instructions.

---

## Maps Analyzed

| Map | File | Territories | Connections | Regions | Validation |
|-----|------|-------------|-------------|---------|------------|
| Horn of Africa & Yemen | `community_horn_africa.json` | 29 | 59 | 5 | PASS |
| Australia 1337 | `community_australia_1337.json` | 26 | 46 | 7 | PASS |
| Great Britain 925 A.D. | `community_britain_925.json` | 14 | 23 | 5 | **FAIL** |
| The 14 Nations | `community_14_nations.json` | 43 | 99 | 8 | PASS |
| Strait of Hormuz | `community_strait_hormuz.json` | 24 | 52 | 5 | PASS |

### Confirmed Non-Issues
- **14 Nations globe rendering** — Has no `geo_polygon` per territory, but the globe renders correctly via a dedicated special-case path in `globeTerritoryGeometry.ts` (lines 373–399) plus the canvas-to-WGS84 fallback using `projection_bounds`. No fix needed.
- **Strait of Hormuz `region_iran_interior` bottleneck** — Only connects to `region_hormozgan`, but with 7 border connections this is thematically appropriate. No fix needed.
- **Missing metadata fields** — `min_players`/`max_players`/`recommended_players` are per-game-session settings (stored in `settings_json` in PostgreSQL), not per-map fields. `canvas_width`/`canvas_height` are present on all maps. No fix needed.
- **14 Nations high vertex counts** (110–936 vertices per polygon) — Auto-generated from detailed boundaries. Not a bug; only a concern if performance issues arise on low-end devices.

---

## File Inventory

Each community map exists in up to **two locations** that must be kept in sync:

| Map | Database Source | Frontend Copy |
|-----|----------------|---------------|
| Britain 925 | `database/maps/community_britain_925.json` | `frontend/public/maps/regional/community_britain_925.json` (identical) |
| Australia 1337 | `database/maps/community_australia_1337.json` | `frontend/public/maps/regional/community_australia_1337.json` (has extra polygon data) |
| Horn of Africa | `database/maps/community_horn_africa.json` | `frontend/public/maps/regional/community_horn_africa.json` (different formatting) |
| 14 Nations | `database/maps/community_14_nations.json` | _(no frontend copy)_ |
| Strait of Hormuz | `database/maps/community_strait_hormuz.json` | _(no frontend copy)_ |

The database source (`database/maps/`) is the canonical version. Frontend copies must mirror edits to the connections/regions arrays. The Strait of Hormuz and 14 Nations have no frontend copy and no changes needed.

---

## Issue 1 — Duplicate Connection in Britain 925

**Severity: Critical** — Fails `pnpm run validate:maps`

### Problem

The connection `brycheiniog ↔ england` is defined **twice** in the connections array:

- **Connection index 7** (line ~1786): `{ "from": "england", "to": "brycheiniog", "type": "land" }` — KEEP
- **Connection index 15** (line ~1825): `{ "from": "brycheiniog", "to": "england", "type": "land" }` — REMOVE

Connections are undirected — the game engine treats `from→to` the same as `to→from`. Having both directions stored is a duplicate.

### Requirements

1. Remove the second occurrence (index 15) from the connections array
2. The first occurrence (index 7) remains, preserving adjacency
3. Apply the same edit to the frontend copy

### Exact Edit — `database/maps/community_britain_925.json`

**Remove lines ~1824–1828** (the object and its trailing comma):
```json
// BEFORE (lines ~1822–1830):
    {
      "from": "brycheiniog",
      "to": "wessex",
      "type": "land"
    },
    {                          ← DELETE
      "from": "brycheiniog",   ← DELETE
      "to": "england",         ← DELETE
      "type": "land"           ← DELETE
    },                         ← DELETE
    {
      "from": "essex",
      "to": "kent",

// AFTER:
    {
      "from": "brycheiniog",
      "to": "wessex",
      "type": "land"
    },
    {
      "from": "essex",
      "to": "kent",
```

### Exact Edit — `frontend/public/maps/regional/community_britain_925.json`

Same edit (files are identical).

### Verification

```bash
pnpm run validate:maps
```
Expected: `✓ community_britain_925.json` and all maps pass.

### Impact

- Fixes the only validation failure across all 14 map files
- No gameplay change (adjacency was already established by the first entry)
- Connection count: 23 → 22

---

## Issue 2 — Cornwall Dead-End & Trivial Celtic Region in Britain 925

**Severity: Medium** — Gameplay balance

### Problem

`cornwall` has **degree 1** — it connects only to `wessex`. It is also the **sole territory** in the `celtic` region with a bonus of 1. This means:

- A player holding Cornwall is only attackable from one direction
- The `celtic` region bonus (+1 troop/turn) is essentially free — hold 1 territory with 1 border
- Geographically, Cornwall is separated from Welsh territories (e.g., Deheubarth) by the Bristol Channel, approximately 30–50 km — the same type of water crossing already modeled by the existing `deheubarth → wessex` sea connection

### Current State

```
cornwall ←land→ wessex (only connection)
```

Cornwall's connections list:
| Index | Connection | Type |
|-------|-----------|------|
| 22 | `wessex → cornwall` | land |

### Requirements

1. Add a **sea connection** from `cornwall` to `deheubarth` (Bristol Channel crossing)
2. This gives Cornwall degree 2 and creates a second attack vector
3. The `celtic` region bonus (1) remains — it's now harder to hold with 2 borders
4. Apply the same edit to the frontend copy

### Geographic Justification

The Bristol Channel between Cornwall and Deheubarth (south Wales) is ~30–50 km wide. The map already has a `deheubarth → wessex` sea connection across the same body of water. A Cornwall–Deheubarth sea route is historically plausible (maritime trade between Cornwall and Wales was active in the early medieval period).

### Exact Edit — `database/maps/community_britain_925.json`

**Add after the last connection (line ~1862)**, before the closing `]` of the connections array:

```json
// BEFORE (lines ~1859–1864):
    {
      "from": "wessex",
      "to": "cornwall",
      "type": "land"
    }
  ],

// AFTER:
    {
      "from": "wessex",
      "to": "cornwall",
      "type": "land"
    },
    {
      "from": "cornwall",
      "to": "deheubarth",
      "type": "sea"
    }
  ],
```

### Exact Edit — `frontend/public/maps/regional/community_britain_925.json`

Same edit (files are identical).

### Verification

```bash
pnpm run validate:maps
```
Expected: PASS (no duplicate, no unknown territory).

### Impact

- Cornwall degree: 1 → 2
- Celtic region is no longer a trivially defended single-border bonus
- Creates a strategic cross-channel corridor between Welsh and Celtic factions
- Connection count: 22 → 23 (net 0 after Issue 1 removal)
- Also gives `deheubarth` a new neighbor: degree 3 → 4

---

## Issue 3 — Viking-Danish Region Bonus Imbalance in Britain 925

**Severity: Medium** — Gameplay balance

### Problem

The `viking_danish` region has a disproportionately high bonus-to-territory ratio:

| Region | Territories | Bonus | Ratio | Defensibility |
|--------|-------------|-------|-------|---------------|
| scottish | 2 | 2 | 1.00 | Moderate (2 borders to viking_danish) |
| **viking_danish** | **2** | **3** | **1.50** | Moderate (borders anglo_saxon + scottish) |
| welsh | 3 | 2 | 0.67 | Moderate (5 borders to anglo_saxon) |
| anglo_saxon | 6 | 4 | 0.67 | Low (borders everything) |
| celtic | 1 | 1 | 1.00 | Currently high (1 border), becoming moderate after Issue 2 fix |

A ratio of 1.50 is the highest on this map and unusually high for Risk-style games (typical range: 0.50–1.00). With only 2 territories to hold, `viking_danish` offers the best bonus-per-effort on the map.

### Requirements

1. Reduce `viking_danish` bonus from **3 → 2**
2. This aligns it with `scottish` (same size, same bonus)
3. Apply the same edit to the frontend copy

### Exact Edit — `database/maps/community_britain_925.json`

**Line ~1878:**
```json
// BEFORE:
    {
      "region_id": "viking_danish",
      "name": "Viking & Danish",
      "bonus": 3,
      "territory_ids": [

// AFTER:
    {
      "region_id": "viking_danish",
      "name": "Viking & Danish",
      "bonus": 2,
      "territory_ids": [
```

### Exact Edit — `frontend/public/maps/regional/community_britain_925.json`

Same edit.

### Resulting Balance

| Region | Territories | Bonus | New Ratio |
|--------|-------------|-------|-----------|
| scottish | 2 | 2 | 1.00 |
| viking_danish | 2 | **2** | **1.00** |
| welsh | 3 | 2 | 0.67 |
| anglo_saxon | 6 | 4 | 0.67 |
| celtic | 1 | 1 | 1.00 |

Total bonus troops available: 12 → 11. All ratios now fall in the 0.67–1.00 range.

### Impact

- Reduces first-mover advantage for rushing the 2-territory Viking region
- Total map bonus economy drops by 1 (negligible)

---

## Issue 4 — Oceania Bottleneck in Australia 1337

**Severity: Medium** — Gameplay balance

### Problem

The `oceania` region (4 territories: Te Ika-a-Maui, Te Waipounamu, Tui Manu'a, Tonga) only connects to the `southeast` region via **2 sea connections**:

| Connection | Type |
|-----------|------|
| `birabak` (southeast) → `te_waipounamu` (oceania) | sea |
| `dharawal` (southeast) → `te_ika_a_maui` (oceania) | sea |

This creates a classic "Australia in Risk" turtling scenario. A player who takes Oceania only needs to defend 2 sea connections, making the region nearly impregnable.

### Current Oceania Topology

```
tui_manua ←sea→ tonga ←sea→ te_ika_a_maui ←sea→ te_waipounamu
                              ↕ sea                  ↕ sea
                           dharawal (SE)          birabak (SE)
```

### Requirements

1. Add **1 sea connection** from an Oceania territory to a non-southeast territory
2. Best candidate: `tui_manua` → `challbi` (Challbi is in the `northern` region)
3. Geographic justification: Tui Manu'a (Samoa, center ~1168,106) and Challbi (northeast Australia coast, center ~525,136) are both in the top section of the map. A long-range Pacific sea route is plausible.
4. Apply the same edit to the frontend copy

### Alternative Candidates Considered

| Oceania Territory | Target | Distance | Plausibility |
|-------------------|--------|----------|-------------|
| `tui_manua` | `challbi` (northern) | ~643 px | Good — both are in the northern map area. Pacific island → NE Australian coast |
| `tonga` | `challbi` (northern) | ~668 px | Similar but Tonga is slightly further south |
| `te_ika_a_maui` | `yuggera` (eastern) | ~401 px | Shorter distance but would add a 3rd invasion route and over-expose Oceania |

`tui_manua → challbi` is the best single addition: it creates exactly 1 new entry point without making Oceania indefensible.

### Exact Edit — `database/maps/community_australia_1337.json`

**Add after the last connection (line ~2077)**, before the closing `]`:

```json
// BEFORE (lines ~2075–2079):
    {
      "from": "dharawal",
      "to": "te_ika_a_maui",
      "type": "sea"
    }
  ],

// AFTER:
    {
      "from": "dharawal",
      "to": "te_ika_a_maui",
      "type": "sea"
    },
    {
      "from": "tui_manua",
      "to": "challbi",
      "type": "sea"
    }
  ],
```

### Exact Edit — `frontend/public/maps/regional/community_australia_1337.json`

Same logical edit (find the last connection object in the connections array and add the new entry).

### Verification

```bash
pnpm run validate:maps
```
Expected: PASS.

### Impact

- Oceania now has 3 entry points (from southeast ×2, from northern ×1)
- `tui_manua` degree: 2 → 3
- `challbi` degree: 3 → 4
- Connections: 46 → 47
- Northern region now borders Oceania in addition to its existing neighbors
- Turtling in Oceania becomes significantly harder

---

## Issue 5 — Britain 925 Linear Region Topology (Optional)

**Severity: Low** — Design choice

### Problem

The region adjacency graph is linear:

```
celtic(1) ─── anglo_saxon(6) ─── welsh(3)
                    │
               viking_danish(2) ─── scottish(2)
```

`anglo_saxon` is the hub — all inter-region traffic must pass through it. There is no route from `scottish` to `welsh` or from `celtic` to `scottish` without crossing `anglo_saxon`.

### Proposed Fix

Add a **sea connection** from `alba` (Scottish) to `gwynedd` (Welsh) via the Irish Sea. This creates an alternate strategic corridor.

### Geographic Justification

Alba (northern Scotland) and Gwynedd (northwest Wales) are on the same coastline (Irish Sea / Celtic Sea). Viking-age maritime routes through the Irish Sea were heavily used. The distance (~600 km) is well within the scope of other sea connections in the era.

### Exact Edit — `database/maps/community_britain_925.json`

Add to the connections array (after the `cornwall → deheubarth` addition from Issue 2):

```json
    {
      "from": "alba",
      "to": "gwynedd",
      "type": "sea"
    }
```

### Impact

- Region adjacency: scottish now borders both viking_danish AND welsh
- Welsh now borders both anglo_saxon AND scottish
- Breaks the linear hub-and-spoke into a more circular topology
- Adds strategic depth without fundamentally changing the map's character

### Decision

This is **optional** — the linear topology is historically defensible (Anglo-Saxon England did dominate the center of Britain). Implement only if playtest feedback indicates `anglo_saxon` is too dominant.

---

## Issue 6 — Yemen Bonus in Horn of Africa (Optional)

**Severity: Low** — Balance suggestion

### Problem

Yemen has 7 territories but only a bonus of 2 (ratio 0.29), while other regions range from 0.50 to 0.75:

| Region | Territories | Bonus | Ratio |
|--------|-------------|-------|-------|
| **yemen** | **7** | **2** | **0.29** |
| ethiopian_highlands | 4 | 3 | 0.75 |
| ethiopian_core | 5 | 3 | 0.60 |
| southern_provinces | 5 | 3 | 0.60 |
| somali_coast | 8 | 4 | 0.50 |

7 territories is the second-largest region on the map, but it gives the lowest bonus. This makes Yemen unattractive to hold.

### Proposed Fix

Increase `yemen` bonus from **2 → 3**.

### Exact Edit — `database/maps/community_horn_africa.json`

**Line 309:**
```json
// BEFORE:
    {
      "region_id": "yemen",
      "name": "Southern Yemen",
      "bonus": 2,
      "territory_ids": ["aden", "lahij", "abyan", "shabwah", "hadhramaut", "mahra", "socotra"]
    },

// AFTER:
    {
      "region_id": "yemen",
      "name": "Southern Yemen",
      "bonus": 3,
      "territory_ids": ["aden", "lahij", "abyan", "shabwah", "hadhramaut", "mahra", "socotra"]
    },
```

### Exact Edit — `frontend/public/maps/regional/community_horn_africa.json`

Same logical edit (bonus field on the yemen region entry).

### Resulting Balance

| Region | Territories | Bonus | New Ratio |
|--------|-------------|-------|-----------|
| yemen | 7 | **3** | **0.43** |
| ethiopian_highlands | 4 | 3 | 0.75 |
| ethiopian_core | 5 | 3 | 0.60 |
| southern_provinces | 5 | 3 | 0.60 |
| somali_coast | 8 | 4 | 0.50 |

Still the lowest ratio, but no longer half the average.

### Decision

**Optional** — the low bonus may be intentional if Yemen is designed as a contested buffer zone. Implement only if playtest feedback shows players consistently avoid Yemen.

---

## Implementation Plan

### Phase 1 — Critical Fix (Issue 1)

**Files:** `database/maps/community_britain_925.json`, `frontend/public/maps/regional/community_britain_925.json`

| Step | Action |
|------|--------|
| 1.1 | Open `database/maps/community_britain_925.json` |
| 1.2 | Navigate to the connections array (~line 1740+) |
| 1.3 | Find connection index 15: `{ "from": "brycheiniog", "to": "england", "type": "land" }` (~lines 1824–1828) |
| 1.4 | Delete the entire JSON object **and** its preceding or trailing comma to keep valid JSON |
| 1.5 | Repeat steps 1.2–1.4 in `frontend/public/maps/regional/community_britain_925.json` |
| 1.6 | Run `pnpm run validate:maps` — confirm `community_britain_925.json` now passes |

### Phase 2 — Britain 925 Balance (Issues 2 + 3)

**Files:** same as Phase 1

| Step | Action |
|------|--------|
| 2.1 | In `database/maps/community_britain_925.json`, find the last connection (`wessex → cornwall`, ~line 1859) |
| 2.2 | Add a comma after the closing `}` of that connection |
| 2.3 | Insert new connection: `{ "from": "cornwall", "to": "deheubarth", "type": "sea" }` |
| 2.4 | In the regions array, find `viking_danish` (~line 1876) |
| 2.5 | Change `"bonus": 3` → `"bonus": 2` |
| 2.6 | Repeat steps 2.1–2.5 in `frontend/public/maps/regional/community_britain_925.json` |
| 2.7 | Run `pnpm run validate:maps` — confirm PASS |

### Phase 3 — Australia 1337 Balance (Issue 4)

**Files:** `database/maps/community_australia_1337.json`, `frontend/public/maps/regional/community_australia_1337.json`

| Step | Action |
|------|--------|
| 3.1 | In `database/maps/community_australia_1337.json`, find the last connection (`dharawal → te_ika_a_maui`, ~line 2075) |
| 3.2 | Add a comma after the closing `}` of that connection |
| 3.3 | Insert new connection: `{ "from": "tui_manua", "to": "challbi", "type": "sea" }` |
| 3.4 | Repeat steps 3.1–3.3 in `frontend/public/maps/regional/community_australia_1337.json` |
| 3.5 | Run `pnpm run validate:maps` — confirm PASS |

### Phase 4 — Optional Tweaks (Issues 5 + 6)

**Implement only after playtest feedback.**

| Step | Action |
|------|--------|
| 4.1 | _(Optional)_ In `community_britain_925.json`, add connection: `{ "from": "alba", "to": "gwynedd", "type": "sea" }` at end of connections array |
| 4.2 | _(Optional)_ In `community_horn_africa.json`, change yemen `"bonus": 2` → `"bonus": 3` (line 309) |
| 4.3 | Mirror each edit to corresponding frontend copy |
| 4.4 | Run `pnpm run validate:maps` — confirm PASS |

---

## Post-Implementation Checklist

- [ ] `pnpm run validate:maps` passes with **0 errors** across all 14 map files
- [ ] JSON is valid in all edited files (no trailing commas, bracket mismatches)
- [ ] Frontend copies match database source for all edited maps
- [ ] Manual spot-check: load Britain 925 in browser → Cornwall shows 2 connections (Wessex + Deheubarth)
- [ ] Manual spot-check: load Australia 1337 in browser → Tui Manu'a shows connection to Challbi
- [ ] Globe rendering check: sea connections render correctly on the 3D globe for edited maps
- [ ] _(If Phase 4 applied)_ Playtest Britain 925 and Horn of Africa with 2–3 players

---

## Summary of All Edits

| Phase | Map | Edit | Lines Affected |
|-------|-----|------|---------------|
| 1 | Britain 925 | Remove duplicate `brycheiniog ↔ england` connection | ~1824–1828 (×2 files) |
| 2 | Britain 925 | Add `cornwall ↔ deheubarth` sea connection | ~1862 (×2 files) |
| 2 | Britain 925 | Change `viking_danish` bonus 3 → 2 | ~1878 (×2 files) |
| 3 | Australia 1337 | Add `tui_manua ↔ challbi` sea connection | ~2077 (×2 files) |
| 4 | Britain 925 | _(Optional)_ Add `alba ↔ gwynedd` sea connection | after Phase 2 edits (×2 files) |
| 4 | Horn of Africa | _(Optional)_ Change yemen bonus 2 → 3 | line 309 (×2 files) |
