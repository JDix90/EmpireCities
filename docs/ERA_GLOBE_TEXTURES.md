# Era globe textures — Layer 2 art spec

The biggest "the world evolves" payoff on the **3D globe** (the primary in-game view)
is the planet's own surface changing per era — something we can't do programmatically.
This spec is what an artist (or CC0 sourcing) needs to produce those textures, and the
~5-line drop-in to wire them once they exist.

> **No AI art.** These must be hand-made, commissioned, or CC0 / public-domain. The
> framework hooks are already in place so adding them later needs no rework.

## What's needed

Per **spine era**, one equirectangular earth texture (and optionally a bump map):

| Format | Equirectangular (2:1), JPG for the color map (smaller), PNG optional for bump |
| Size   | **4096×2048** preferred (2048×1024 minimum) |
| Naming | `frontend/public/globe/era/<eraId>.jpg` (+ optional `<eraId>-bump.jpg`) |

`<eraId>` ∈ `ancient, medieval, discovery, ww2, coldwar, modern, space_age`
(galaxy_age uses its own multi-world skins — skip it here).

## Per-era art direction

Keep coastlines geographically real (it's the same Earth); change the *treatment*:

| Era | Look |
|-----|------|
| `ancient` | Aged parchment / sepia world, classical-map feel — muted browns + gold. |
| `medieval` | Illuminated-manuscript map, richer parchment greens, heraldic tone. |
| `discovery` | Age-of-sail nautical chart — blue oceans, rhumb lines, compass aesthetic. |
| `ww2` | Desaturated mid-century military map — olive/grey, topographic. |
| `coldwar` | Stark high-contrast political map — steel blues, satellite-at-dawn. |
| `modern` | True satellite Earth (NASA "Blue Marble" style), full color. |
| `space_age` | Near-future Earth with city lights / faint orbital tint, indigo cast. |

The board **atmosphere background** already shifts per era (shipped — `eraBoardTheme().background`),
so these textures only need to carry the planet surface; the surrounding mood is handled.

## Sourcing approach (realistic, non-AI)

These are **globe** textures (equirectangular / plate-carrée) — react-globe.gl wraps the
image around a sphere — **not** flat maps. That has one consequence worth knowing before
you commission anything:

> **Historical map scans won't work for the early eras.** Old world maps are the wrong
> projection and rarely full-globe, so they distort badly on a sphere — you can't just drop
> a parchment map of 1500 onto the globe. And there's no such thing as a "photo of the
> ancient Earth."

The path that stays non-AI *and* geographically correct (same coastlines as the live globe):

1. **One public-domain equirectangular base for every era** — NASA Visible Earth
   **"Blue Marble: Next Generation"** (public domain, equirectangular, 8k+ available). This is
   the geographic base for all seven textures.
2. **A designer applies a per-era treatment to that base** (Photoshop/Affinity — human styling
   of a PD base, not AI):
   - `ancient` → sepia / parchment recolor, aged-paper overlay
   - `medieval` → richer parchment, illuminated-manuscript greens
   - `discovery` → nautical-chart blue, faint rhumb-line overlay
   - `ww2` → desaturated olive / grey
   - `coldwar` → high-contrast steel-blue
   - `modern` → the Blue Marble base, unmodified
   - `space_age` → NASA **"Black Marble"** (Earth at night / city lights, public domain), or the
     Blue Marble with an indigo orbital cast

**Direct public-domain downloads (modern + space_age are usable almost as-is):**
- Blue Marble — NASA Visible Earth (search "Blue Marble Next Generation", equirectangular).
- Black Marble / night lights — NASA Earth Observatory (public domain).

So the actual ask to an artist is small and well-bounded: *"here's the PD Blue Marble base —
give me five era-treated recolors (ancient, medieval, discovery, ww2, coldwar) at 4096×2048."*
Verify and record each asset's license next to the file.

## Drop-in wiring (once the files exist)

The framework already exposes the hook (`globeTextureUrl`, currently `null`) and the globe
already accepts a `globeImageUrl` prop. Two small edits light it up:

1. **`frontend/src/constants/eraBoardTheme.ts`** — populate the hook:
   ```ts
   const ERA_GLOBE_TEXTURE: Record<string, string> = {
     ancient: '/globe/era/ancient.jpg', medieval: '/globe/era/medieval.jpg',
     discovery: '/globe/era/discovery.jpg', ww2: '/globe/era/ww2.jpg',
     coldwar: '/globe/era/coldwar.jpg', modern: '/globe/era/modern.jpg',
     space_age: '/globe/era/space_age.jpg',
   };
   // in eraBoardTheme(): globeTextureUrl: ERA_GLOBE_TEXTURE[eraId] ?? null,
   ```
2. **`frontend/src/pages/GamePage.tsx`** — feed it to the globe's earth-case `globeImageUrl`
   (mirror the existing `eraAtmosphereBg` gating so classic games / custom skins are untouched):
   ```ts
   : (customGlobeSkin?.globeImageUrl
       ?? (gameState?.settings.era_advancement_enabled
             ? eraBoardTheme(playerTechEra).globeTextureUrl ?? undefined
             : undefined))
   ```

That's it — the planet then visibly transforms as the viewing player advances. (A matching
`terrainTextureUrl` hook exists for the 2D map if you later want parity there.)
