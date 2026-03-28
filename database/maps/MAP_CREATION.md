# Map Creation Guide — ChronoConquest

## Geographic boundaries on the globe

Territories render with **real geographic boundaries** on the 3D globe (Natural Earth GeoJSON). Split regions (e.g. Western USA, Eastern Russia) use **bbox clipping** to divide countries into geographic areas.

### Resolution order

1. **`geo_config`** — Per-country config with optional clip regions (highest priority).
2. **`iso_codes` + `clip_bbox`** — Simple merge with optional full-geometry clip.
3. **Preset lookup** — Built-in era maps use `TERRITORY_GEO_CONFIG` or `TERRITORY_ISO_MAP`.
4. **Canvas fallback** — Abstract canvas polygon projected to lat/lng.

---

## Custom maps

### Simple territories (whole countries)

```json
{
  "territory_id": "western_europe",
  "name": "Western Europe",
  "polygon": [[100,50],[200,50],[200,150],[100,150]],
  "center_point": [150, 100],
  "region_id": "europe",
  "iso_codes": ["FR", "DE", "BE", "NL", "LU"]
}
```

### Split regions (clipped by bbox)

Use `geo_config` to clip specific countries to a bounding box:

```json
{
  "territory_id": "western_usa",
  "name": "Western USA",
  "polygon": [[...]],
  "center_point": [100, 80],
  "region_id": "americas",
  "geo_config": [
    { "iso": "US", "clip_bbox": [-125, 24, -100, 50] }
  ]
}
```

**`clip_bbox`** = `[minLng, minLat, maxLng, maxLat]` in degrees (WGS84).

### Composite split (clipped + full countries)

```json
{
  "territory_id": "eastern_americas",
  "name": "Eastern USA & Canada",
  "geo_config": [
    { "iso": "US", "clip_bbox": [-100, 24, -66, 50] },
    { "iso": "CA" }
  ]
}
```

The first entry clips the US to the eastern half; Canada is included in full.

### Alternative: `iso_codes` + `clip_bbox`

For clipping the **entire merged** geometry:

```json
{
  "territory_id": "region",
  "iso_codes": ["US", "MX"],
  "clip_bbox": [-120, 20, -95, 35]
}
```

This merges US + Mexico, then clips to the bbox. Use `geo_config` when you need per-country clipping.

---

## Adding preset era mappings

Edit `frontend/src/data/territoryGeoMapping.ts`:

**Simple (whole countries):**
```ts
TERRITORY_ISO_MAP['my_territory'] = ['US', 'CA'];
```

**Split regions:**
```ts
TERRITORY_GEO_CONFIG['my_territory'] = [
  { iso: 'US', clip_bbox: [-125, 24, -100, 50] },
  { iso: 'CA' },
];
```

---

## Reference

- **Source:** Natural Earth `ne_110m_admin_0_countries.geojson` (ISO_A2)
- **Bbox format:** `[minLng, minLat, maxLng, maxLat]` (degrees)
- **ISO_A2:** 2-letter codes (e.g. `FR`, `US`, `RU`)
