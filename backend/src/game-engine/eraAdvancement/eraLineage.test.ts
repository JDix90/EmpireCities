import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  loadEraLineage,
  getEraTransition,
  getPrimarySuccessor,
  type EraTransition,
} from './eraLineage';

const MAPS_DIR = path.resolve(__dirname, '../../../../database/maps');
function territoryIds(mapFile: string): Set<string> {
  const j = JSON.parse(readFileSync(path.join(MAPS_DIR, mapFile), 'utf8')) as {
    territories: { territory_id: string }[];
  };
  return new Set(j.territories.map((t) => t.territory_id));
}

const data = loadEraLineage();

describe('era-lineage.json — structural integrity', () => {
  it('declares the full-ascension sequence and a transition per consecutive pair', () => {
    expect(data.sequence).toEqual(['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'space_age']);
    for (let i = 0; i < data.sequence.length - 1; i++) {
      expect(data.transitions[`${data.sequence[i]}->${data.sequence[i + 1]}`]).toBeDefined();
    }
  });

  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line @typescript-eslint/no-loop-func
    describe(`transition ${['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'][i]} →`, () => {
      const seq = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'space_age'];
      const key = `${seq[i]}->${seq[i + 1]}`;
      const t: EraTransition = data.transitions[key];
      const fromIds = territoryIds(`${t.from_map}.json`);
      const toIds = territoryIds(`${t.to_map}.json`);

      it('references only real territory ids, with valid overlaps and a primary edge', () => {
        for (const [src, edges] of Object.entries(t.lineage)) {
          expect(fromIds.has(src), `${key}: source ${src}`).toBe(true);
          expect(edges.length).toBeGreaterThan(0);
          expect(edges.filter((e) => e.primary).length).toBe(1);
          for (const e of edges) {
            expect(toIds.has(e.to), `${key}: target ${e.to}`).toBe(true);
            expect(e.overlap).toBeGreaterThanOrEqual(0);
            expect(e.overlap).toBeLessThanOrEqual(1);
          }
        }
        for (const id of t.no_successor) expect(fromIds.has(id), `${key}: no_successor ${id}`).toBe(true);
        for (const id of t.new_land) expect(toIds.has(id), `${key}: new_land ${id}`).toBe(true);
      });

      it('partitions every source territory into exactly one of {lineage, no_successor}', () => {
        const inLineage = new Set(Object.keys(t.lineage));
        const inNoSucc = new Set(t.no_successor);
        for (const id of fromIds) {
          const a = inLineage.has(id);
          const b = inNoSucc.has(id);
          expect(a !== b, `${key}: ${id} must be in exactly one of lineage/no_successor (lineage=${a}, no_successor=${b})`).toBe(true);
        }
      });

      it('every target territory is either a lineage successor or flagged new_land', () => {
        const successorTargets = new Set<string>();
        for (const edges of Object.values(t.lineage)) for (const e of edges) successorTargets.add(e.to);
        const newLand = new Set(t.new_land);
        for (const id of toIds) {
          expect(successorTargets.has(id) || newLand.has(id), `${key}: target ${id} is orphaned (neither successor nor new_land)`).toBe(true);
        }
      });
    });
  }
});

describe('eraLineage accessors', () => {
  it('getEraTransition follows the sequence and is null at the end', () => {
    expect(getEraTransition('ancient')?.to_map).toBe('era_medieval');
    expect(getEraTransition('modern')?.to_map).toBe('era_space_age');
    expect(getEraTransition('space_age')).toBeNull();
  });

  it('getPrimarySuccessor returns the dominant successor id', () => {
    const t = getEraTransition('coldwar')!;
    const src = Object.keys(t.lineage)[0];
    const primary = getPrimarySuccessor(t, src);
    expect(primary).toBe((t.lineage[src].find((e) => e.primary) ?? t.lineage[src][0]).to);
    expect(getPrimarySuccessor(t, '__does_not_exist__')).toBeNull();
  });
});
