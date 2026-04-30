/**
 * Validates rts_terrain in RTS slice maps: 5 territories, frontiers, spawn nodes.
 * Run: pnpm run validate:maps:rts (from backend/)
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { validateMapConnections, type MapDocumentLike } from '../src/game-engine/validation/mapConnections';

interface RtsTerrainFile extends MapDocumentLike {
  rts_terrain?: {
    mapId?: string;
    territories: Record<
      string,
      {
        nodes: { id: string; u: number; v: number }[];
        edges: { from: string; to: string }[];
        frontiers: Record<string, { thisNode: string; neighborNode: string }[]>;
        spawnNodeId: string;
      }
    >;
  };
}

function validateRtsTerrain(map: RtsTerrainFile, file: string): string[] {
  const e: string[] = [];
  if (!map.rts_terrain?.territories) {
    e.push('Missing rts_terrain.territories');
    return e;
  }
  if (Object.keys(map.rts_terrain.territories).length !== 5) {
    e.push(`Expected 5 rts_terrain keys, got ${Object.keys(map.rts_terrain.territories).length}`);
  }
  const tids = new Set(map.territories.map((t) => t.territory_id));
  for (const [tid, terr] of Object.entries(map.rts_terrain.territories)) {
    if (!tids.has(tid)) e.push(`rts_terrain has unknown territory ${tid}`);
    const nids = new Set(terr.nodes.map((n) => n.id));
    if (!nids.has(terr.spawnNodeId)) e.push(`${tid}: spawnNodeId not in nodes`);
    for (const edge of terr.edges) {
      if (!nids.has(edge.from) || !nids.has(edge.to)) e.push(`${tid}: bad edge ${edge.from}→${edge.to}`);
    }
    for (const [nb, pairs] of Object.entries(terr.frontiers)) {
      if (!tids.has(nb)) e.push(`${tid} frontier to unknown ${nb}`);
      for (const p of pairs) {
        if (!nids.has(p.thisNode)) e.push(`${tid} frontier thisNode ${p.thisNode}`);
        const nbT = map.rts_terrain!.territories[nb];
        if (nbT) {
          const nbn = new Set(nbT.nodes.map((x) => x.id));
          if (!nbn.has(p.neighborNode)) e.push(`${tid}→${nb} neighborNode ${p.neighborNode} missing in neighbor`);
        }
      }
    }
  }
  return e;
}

async function main(): Promise<void> {
  const mapsDir = join(__dirname, '../../database/maps');
  const files = (await readdir(mapsDir)).filter((f) => f.startsWith('rts_') && f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No rts_*.json maps to validate.');
    return;
  }
  let failed = false;
  for (const file of files.sort()) {
    const raw = await readFile(join(mapsDir, file), 'utf-8');
    const map = JSON.parse(raw) as RtsTerrainFile;
    const connErrs = validateMapConnections(map);
    const rtsErrs = validateRtsTerrain(map, file);
    const all = [...connErrs, ...rtsErrs];
    if (all.length) {
      failed = true;
      console.error(`\n✗ ${file}`);
      for (const e of all) console.error(`   - ${e}`);
    } else {
      console.log(`✓ ${file} (rts_terrain ok)`);
    }
  }
  if (failed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
