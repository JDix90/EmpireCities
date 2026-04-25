---
name: map-globe-visibility
description: Harden new map integrations so 3D globe territories render with clearly visible filled caps (not outline-only). Use when adding or debugging any custom/regional map, globe skin override, or map-source resolution path.
---

# Map Globe Visibility

## Goal

Ensure every new map renders on 3D globe with:
- visible territory fills,
- stable borders,
- correct map source resolution,
- no silent fallback to stale geometry.

## Fast Workflow (run in order)

1. **Establish one source of truth**
   - Curated regional maps must resolve from static JSON in both frontend and backend gameplay paths.
   - Do not allow curated map IDs to load from stale Mongo copies.

2. **Validate geometry inputs**
   - Confirm each territory has a valid ring (`>= 3` points, closed ring, no duplicate consecutive vertices).
   - Prefer explicit `geo_polygon` for custom/regional maps.
   - Keep `projection_bounds` consistent with map authoring coordinates.

3. **Force robust cap rendering**
   - Use non-transparent or high-alpha unowned fill color for new regional maps.
   - Increase polygon altitude for authored regional maps if ocean/skin can occlude caps.
   - Keep border stroke readable but secondary to cap visibility.

4. **Check ring winding / face orientation**
   - If globe shows strokes but cap fill is missing, treat as winding/culling first.
   - Normalize ring orientation with `@turf/rewind`.
   - If a specific map still fails, apply map-specific winding reversal in geometry builder.

5. **Confirm runtime rendering branch**
   - Verify map detection logic (`map_id` + reliable fallback marker).
   - Verify `polygonsData` is non-empty and mapped to rendered globe view.
   - Verify the in-match game instance is new after map changes (old rooms keep in-memory state).

6. **Verify**
   - Start a fresh match on that map.
   - Check unowned territories are visibly filled on 3D globe.
   - Check owned territories render player colors clearly.
   - Run lint on touched files.

## Required Checks Before Declaring Done

- [ ] Frontend map loading path uses intended source for this map class.
- [ ] Backend gameplay map resolution uses same source-of-truth.
- [ ] Geometry builder path for this map is explicit and deterministic.
- [ ] Cap color + altitude make unowned land clearly visible.
- [ ] No outline-only rendering in a fresh game.

## Common Failure Signatures

- **Only outlines visible**: wrong winding/culling, cap effectively hidden, or stale geometry source.
- **Wrong landmasses vs expected map**: wrong map source resolved (API/Mongo/static drift).
- **2D looks correct, 3D broken**: geometry conversion/winding issue, not map content.

## Implementation Targets In This Codebase

- Frontend globe rendering: `frontend/src/components/game/GlobeMap.tsx`
- Frontend geometry builder: `frontend/src/utils/globeTerritoryGeometry.ts`
- Frontend map resolution: `frontend/src/services/mapService.ts`
- Backend gameplay map resolver: `backend/src/sockets/gameSocket.ts`
- Backend map API resolver: `backend/src/modules/maps/maps.routes.ts`

