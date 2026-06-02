# Globe and 2D map checklist

When changing territory geometry, connections, or map authoring:

1. Run `pnpm run validate:maps` from `backend/` (unique undirected connection pairs, valid territory ids).
2. Confirm **Pixi 2D** view in `GameMap.tsx` (canvas scaling / `projection_bounds`).
3. Confirm **globe** view in `GlobeMap.tsx` and `frontend/src/utils/globeTerritoryGeometry.ts` (GeoJSON winding, `geo_polygon` / canvas fallback).
4. Re-seed or republish map documents if JSON source files changed (`pnpm run seed:maps`).
