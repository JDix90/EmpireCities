/**
 * Builds `database/maps/era_ascension_galaxy.json` — the Space to Stars board.
 *
 *   pnpm exec tsx scripts/buildAscensionGalaxyMap.ts
 *
 * The map is DERIVED, not hand-authored, because both of its halves already
 * exist and must not drift from them:
 *
 *   • Earth and the Moon come from `era_space_age.json` unchanged, including
 *     the 2100 frontier tiles — on this board they are in play from turn one
 *     (the two-step spine has exactly one growth step, and it belongs to the
 *     stars), which is the same 63-tile board a standalone Space Age game gets
 *     with `space_age_frontiers_enabled`.
 *   • Verdan Reach, the Rust Belt and Nexus Station come from
 *     `era_galaxy.json` unchanged — tiles, regions, land connections, world
 *     skins, modifiers and rules — tagged `unlock_era_index: 1` so they enter
 *     play when the first player reaches the Galactic Age.
 *
 * The one thing that is genuinely new is the join. In the galaxy map the ring is
 * sol–verdan–rust–nexus–sol; here the MOON takes Sol's place in it, so the eight
 * authored hyperspace lanes are the same eight, with the Moon's far side and
 * poles carrying the two that used to leave Sol. That keeps the corridor game
 * exactly as measured (GALAXY-BALANCE.md) and makes the Space Age's Moon race
 * the on-ramp to the stars rather than a detour: the road to Verdan starts on
 * the far side of the Moon.
 *
 * Re-run this after changing either source map.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, MapConnection, MapTerritory } from '../src/types';

const MAPS = join(__dirname, '../../database/maps');
const OUT = join(MAPS, 'era_ascension_galaxy.json');

/** The galaxy worlds that come across; Sol stays behind, replaced by Earth. */
const EXO_WORLDS = ['verdan', 'rust', 'nexus_station'] as const;

/** Advancement index at which the exo worlds enter play (spine step 1: galaxy_age). */
const GALAXY_UNLOCK_INDEX = 1;

/**
 * The ring, rebuilt with the Moon where Sol was. Each entry is one authored
 * hyperspace lane; the verdan–rust and rust–nexus pairs are copied verbatim from
 * the galaxy map, and the four that touched Sol now leave the Moon.
 */
const MOON_LANES: Array<{ moon: string; exo: string }> = [
  { moon: 'moon_far_side_north', exo: 'verdan_chlorophage_span' },
  { moon: 'moon_far_side_south', exo: 'verdan_greenfire_vault' },
  { moon: 'moon_polar_north', exo: 'nexus_harmonic_rim' },
  { moon: 'moon_polar_south', exo: 'nexus_resonance_vault' },
];

/** Where each world's node sits on the strategic chart, in [0,1]^2. */
const WORLD_CHART_POSITION: Record<string, [number, number]> = {
  earth: [0.16, 0.30],
  moon: [0.30, 0.52],
};

function read(name: string): GameMap {
  return JSON.parse(readFileSync(join(MAPS, name), 'utf-8')) as GameMap;
}

function worldOf(t: MapTerritory): string {
  if (t.world_id) return t.world_id;
  if (t.globe_id === 'moon') return 'moon';
  return 'earth';
}

function main(): void {
  const spaceAge = read('era_space_age.json');
  const galaxy = read('era_galaxy.json');

  const exo = new Set<string>(EXO_WORLDS);
  const galaxyExoTiles = galaxy.territories.filter((t) => exo.has(t.world_id ?? ''));
  const exoIds = new Set(galaxyExoTiles.map((t) => t.territory_id));

  // ── Territories ────────────────────────────────────────────────────────
  const territories: MapTerritory[] = [
    ...spaceAge.territories.map((t) => {
      // The 2100 frontiers ship in play here: this board's one growth step is
      // the galaxy, and a frontier tagged for a step that does not exist on the
      // two-step spine would never appear at all.
      const { unlock_era_index: _dropped, ...rest } = t as MapTerritory & { unlock_era_index?: number };
      const world = worldOf(t);
      return {
        ...rest,
        world_id: world,
        galaxy_position: WORLD_CHART_POSITION[world] ?? WORLD_CHART_POSITION.earth,
      } as MapTerritory;
    }),
    ...galaxyExoTiles.map((t) => ({ ...t, unlock_era_index: GALAXY_UNLOCK_INDEX })),
  ];

  // ── Connections ────────────────────────────────────────────────────────
  const connections: MapConnection[] = [
    ...spaceAge.connections,
    // Every galaxy edge whose BOTH ends came across: the exo worlds' own land
    // borders, plus the verdan–rust and rust–nexus hyperspace lanes.
    ...galaxy.connections.filter((c) => exoIds.has(c.from) && exoIds.has(c.to)),
    // …and the Moon in Sol's place on the ring.
    ...MOON_LANES.map(({ moon, exo: far }) => ({ from: moon, to: far, type: 'orbit' as const })),
  ];

  // ── Regions ────────────────────────────────────────────────────────────
  const exoRegionIds = new Set(galaxyExoTiles.map((t) => t.region_id));
  const regions = [
    ...spaceAge.regions,
    ...galaxy.regions.filter((r) => exoRegionIds.has(r.region_id)),
  ];

  // ── Worlds ─────────────────────────────────────────────────────────────
  const galaxyWorldById = new Map((galaxy.worlds ?? []).map((w) => [w.world_id, w]));
  const worlds = [
    {
      world_id: 'earth',
      display_name: 'Earth, 2100',
      show_atmosphere: true,
      atmosphere_color: 'lightskyblue',
      atmosphere_altitude: 0.18,
      background_color: 'rgb(8, 12, 28)',
      requires_orbit_access: false,
    },
    {
      world_id: 'moon',
      display_name: 'Luna',
      show_atmosphere: false,
      background_color: 'rgb(10, 10, 14)',
      requires_orbit_access: true,
      // Kept out of the opening distribution and seeded as a neutral garrison —
      // the Space Age board's own rule, which the legacy moon heuristic applied
      // implicitly until this map gave the Moon a `worlds` entry.
      initial_neutral_garrison: true,
    },
    ...EXO_WORLDS.map((id) => {
      const w = galaxyWorldById.get(id);
      if (!w) throw new Error(`era_galaxy.json has no world "${id}"`);
      return { ...w, requires_orbit_access: true };
    }),
  ];

  const out = {
    map_id: 'era_ascension_galaxy',
    name: 'Space to Stars',
    description:
      'One board from the 2100 Earth to a four-world galaxy: win the Moon, then take the '
      + 'Pathfinder lanes off its far side to Verdan Reach, the Rust Belt and Nexus Station.',
    era_theme: 'space_age',
    map_kind: 'galaxy',
    canvas_width: spaceAge.canvas_width,
    canvas_height: spaceAge.canvas_height,
    projection_bounds: spaceAge.projection_bounds,
    globe_view: spaceAge.globe_view,
    worlds,
    regions,
    territories,
    connections,
    is_public: true,
    is_moderated: true,
    moderation_status: 'approved',
    creator_id: null,
  };

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  const byWorld: Record<string, number> = {};
  for (const t of territories) byWorld[worldOf(t)] = (byWorld[worldOf(t)] ?? 0) + 1;
  console.log(`Wrote ${OUT}`);
  console.log(`  ${territories.length} territories: ${JSON.stringify(byWorld)}`);
  console.log(`  ${connections.length} connections (${connections.filter((c) => c.type === 'orbit').length} orbit)`);
  console.log(`  ${regions.length} regions · ${worlds.length} worlds`);
  console.log(`  unlocked at start: ${territories.filter((t) => !t.unlock_era_index).length}`);
}

main();
