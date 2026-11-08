/**
 * The editor shows map health live from @borderfall/shared's evaluateMapHealth;
 * publish refuses on validateMapDocument. The two must agree on what blocks,
 * or the author sees green and the server says no. Every fixture here runs
 * through both; the blocker count has to match, and the messages that are
 * worded identically have to be identical.
 */
import { describe, it, expect } from 'vitest';
import { evaluateMapHealth, type MapHealthInput } from '@borderfall/shared';
import { validateMapDocument, type ValidatableMapDoc } from './mapValidation';

type Doc = ValidatableMapDoc & MapHealthInput & { regions: Array<{ region_id: string; name: string; bonus: number }> };

function ring(n: number): Doc {
  const territories = Array.from({ length: n }, (_, i) => ({
    territory_id: `t_${i}`,
    name: `Province ${i + 1}`,
    region_id: 'r1',
  }));
  const connections = territories.map((t, i) => ({
    from: t.territory_id,
    to: territories[(i + 1) % n].territory_id,
    type: 'land',
  }));
  return { name: 'Ring', territories, connections, regions: [{ region_id: 'r1', name: 'Ring', bonus: 3 }] };
}

const fixtures: Record<string, () => Doc> = {
  'a valid ring': () => ring(7),
  'an empty document': () => ({ name: 'Empty', territories: [], connections: [], regions: [{ region_id: 'r1', name: 'R', bonus: 3 }] }),
  'a three-territory draft': () => ring(3),
  'a ring with one territory cut loose': () => {
    const doc = ring(7);
    doc.connections = doc.connections.filter((c) => c.from !== 't_6' && c.to !== 't_6');
    return doc;
  },
  'duplicate, self-loop and unknown connections': () => {
    const doc = ring(7);
    doc.connections.push({ from: 't_1', to: 't_0', type: 'land' }, { from: 't_2', to: 't_2', type: 'land' }, { from: 't_3', to: 'ghost', type: 'sea' });
    return doc;
  },
  'an empty region and a thin bonus region': () => {
    const doc = ring(7);
    doc.territories[0].region_id = 'lone';
    doc.regions.push({ region_id: 'ghost', name: 'Ghost', bonus: 5 }, { region_id: 'lone', name: 'Lone', bonus: 2 });
    return doc;
  },
  'a lone territory in a region with no bonus': () => {
    const doc = ring(7);
    doc.territories[0].region_id = 'lone';
    doc.regions.push({ region_id: 'lone', name: 'Landmark', bonus: 0 });
    return doc;
  },
  'a shared geometry code drawn twice': () => {
    const doc = ring(7);
    (doc.territories[0] as { iso_codes?: string[] }).iso_codes = ['FR'];
    (doc.territories[1] as { iso_codes?: string[] }).iso_codes = ['FR'];
    return doc;
  },
  'a two-letter name': () => ({ ...ring(7), name: 'Hi' }),
  'a province claimed by two territories': () => {
    const doc = ring(7);
    (doc.territories[0] as { admin1?: string[] }).admin1 = ['US-CA', 'US-NV'];
    (doc.territories[1] as { admin1?: string[] }).admin1 = ['US-CA'];
    return doc;
  },
  'a province claimed twice but clipped in one': () => {
    const doc = ring(7);
    (doc.territories[0] as { admin1?: string[] }).admin1 = ['US-CA'];
    (doc.territories[1] as { admin1?: string[]; admin1_clips?: Record<string, unknown> }).admin1 = ['US-CA'];
    (doc.territories[1] as { admin1_clips?: Record<string, unknown> }).admin1_clips = { 'US-CA': [-125, 32, -120, 42] };
    return doc;
  },
};

// Rules whose wording is the same on both sides.
const IDENTICAL = /^(Give the map a name|Add \d+ more|Connection references|Self-loop|Duplicate connection|Disconnected territory|Region ".*" has no territories)/;

describe('map health parity with publish validation', () => {
  for (const [label, build] of Object.entries(fixtures)) {
    it(`agrees on ${label}`, () => {
      const serverErrors = validateMapDocument(build());
      const report = evaluateMapHealth(build());
      expect(report.blockers.length).toBe(serverErrors.length);
      expect(report.ready).toBe(serverErrors.length === 0);
      const serverIdentical = serverErrors.filter((m) => IDENTICAL.test(m)).sort();
      const clientIdentical = report.blockers.map((b) => b.message).filter((m) => IDENTICAL.test(m)).sort();
      expect(clientIdentical).toEqual(serverIdentical);
    });
  }
});
