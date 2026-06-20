# Era globe textures — drop folder

Drop per-era **equirectangular** (plate-carrée) globe textures here, named `<eraId>.jpg`:

```
ancient.jpg  medieval.jpg  discovery.jpg  ww2.jpg  coldwar.jpg  modern.jpg  space_age.jpg
```

- **4096×2048** preferred (2048×1024 minimum), JPG.
- **No AI art** — human-made, CC0, or public-domain only. Record each file's license/source.

These wrap onto the 3D globe, so they must be full-Earth equirectangular textures — not flat
historical map scans (wrong projection). See **[../../../../docs/ERA_GLOBE_TEXTURES.md](../../../../docs/ERA_GLOBE_TEXTURES.md)**
for the sourcing approach (PD Blue Marble base + per-era styling) and the ~5-line code edit
that lights these up once they exist. Until then, the globe falls back to its default Earth.
