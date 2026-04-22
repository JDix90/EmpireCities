import { describe, it, expect } from 'vitest';
import { validateMapConnections } from './mapConnections';

describe('validateMapConnections', () => {
  it('passes for minimal graph with one undirected edge row', () => {
    const map = {
      territories: [{ territory_id: 'a' }, { territory_id: 'b' }],
      connections: [{ from: 'a', to: 'b', type: 'land' as const }],
    };
    expect(validateMapConnections(map)).toEqual([]);
  });

  it('errors on duplicate undirected edge', () => {
    const map = {
      territories: [{ territory_id: 'a' }, { territory_id: 'b' }],
      connections: [
        { from: 'a', to: 'b', type: 'land' as const },
        { from: 'b', to: 'a', type: 'land' as const },
      ],
    };
    expect(validateMapConnections(map).some((e) => e.includes('Duplicate connection'))).toBe(true);
  });

  it('errors on unknown territory id', () => {
    const map = {
      territories: [{ territory_id: 'a' }],
      connections: [
        { from: 'a', to: 'x', type: 'land' as const },
        { from: 'x', to: 'a', type: 'land' as const },
      ],
    };
    expect(validateMapConnections(map).length).toBeGreaterThan(0);
  });

  it('errors when graph has disconnected component', () => {
    const map = {
      territories: [
        { territory_id: 'a' },
        { territory_id: 'b' },
        { territory_id: 'c' }, // island — no connection to a/b
      ],
      connections: [{ from: 'a', to: 'b', type: 'land' as const }],
    };
    const errors = validateMapConnections(map);
    expect(errors.some((e) => e.includes('Disconnected'))).toBe(true);
  });

  it('passes when sea connections bridge all territories', () => {
    const map = {
      territories: [{ territory_id: 'a' }, { territory_id: 'b' }, { territory_id: 'c' }],
      connections: [
        { from: 'a', to: 'b', type: 'land' as const },
        { from: 'b', to: 'c', type: 'sea' as const },
      ],
    };
    expect(validateMapConnections(map)).toEqual([]);
  });
});
