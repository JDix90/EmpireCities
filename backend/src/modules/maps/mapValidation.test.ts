import { describe, it, expect } from 'vitest';
import { validateMapDocument, type ValidatableMapDoc } from './mapValidation';

/** A ring of `n` named territories in one region, each joined to the next. */
function ring(n: number, regionId = 'r1'): ValidatableMapDoc {
  const territories = Array.from({ length: n }, (_, i) => ({
    territory_id: `t_${1700000000000 + i}`,
    name: `Province ${i + 1}`,
    region_id: regionId,
  }));
  const connections = territories.map((t, i) => ({
    from: t.territory_id,
    to: territories[(i + 1) % n].territory_id,
    type: 'land',
  }));
  return {
    name: 'Ring Map',
    territories,
    connections,
    regions: [{ region_id: regionId, name: 'The Ring', bonus: 3 }],
  };
}

describe('validateMapDocument', () => {
  it('passes a connected ring with a populated bonus region', () => {
    expect(validateMapDocument(ring(7))).toEqual([]);
  });

  it('counts the territories and connections a small draft still needs', () => {
    const doc = ring(3);
    const errors = validateMapDocument(doc);
    expect(errors).toContain('Add 3 more territories — a map needs at least 6 (has 3)');
    expect(errors).toContain('Add 2 more connections — a map needs at least 5 (has 3)');
  });

  it('uses the singular for a single missing territory', () => {
    const errors = validateMapDocument(ring(5));
    expect(errors.some((e) => e.startsWith('Add 1 more territory —'))).toBe(true);
  });

  it('names territories, not timestamp ids, in connectivity messages', () => {
    const doc = ring(7);
    // Cut Province 7 loose: both of its ring edges go.
    const loose = doc.territories[6].territory_id;
    doc.connections = doc.connections.filter((c) => c.from !== loose && c.to !== loose);
    const errors = validateMapDocument(doc);
    const disconnected = errors.find((e) => e.startsWith('Disconnected territory component'));
    expect(disconnected).toBeDefined();
    expect(disconnected).toContain('"Province 1"');
    expect(disconnected).toContain('Province 7');
    expect(disconnected).not.toContain('t_17');
  });

  it('names territories in duplicate-connection messages', () => {
    const doc = ring(7);
    doc.connections.push({ from: doc.connections[0].to, to: doc.connections[0].from, type: 'land' });
    const errors = validateMapDocument(doc);
    expect(errors.some((e) => e.startsWith('Duplicate connection between Province'))).toBe(true);
  });

  it('flags an empty region once, by name, without also calling it a short bonus region', () => {
    const doc = ring(7);
    doc.regions.push({ region_id: 'r_ghost', name: 'Ghost', bonus: 5 });
    const errors = validateMapDocument(doc);
    const ghost = errors.filter((e) => e.includes('Ghost'));
    expect(ghost).toEqual(['Region "Ghost" has no territories']);
  });

  it('flags a bonus region of one territory, which the game never pays', () => {
    const doc = ring(7);
    doc.territories[0].region_id = 'r_lone';
    doc.regions.push({ region_id: 'r_lone', name: 'Lone Isle', bonus: 2 });
    const errors = validateMapDocument(doc);
    expect(errors.some((e) => e.startsWith('Region "Lone Isle" has a +2 bonus but 1 territory'))).toBe(true);
  });

  it('asks for a name of three characters', () => {
    const doc = ring(7);
    doc.name = 'Hi';
    expect(validateMapDocument(doc)).toContain('Give the map a name of at least 3 characters');
  });

  it('still catches a shared geometry code drawn unclipped twice', () => {
    const doc = ring(7) as ValidatableMapDoc & { territories: Array<{ iso_codes?: string[] }> };
    doc.territories[0].iso_codes = ['FR'];
    doc.territories[1].iso_codes = ['FR'];
    expect(validateMapDocument(doc).some((e) => e.includes('Geometry code "FR"'))).toBe(true);
  });
});
