/**
 * Who may play an unpublished community map: nobody but its author, and the
 * author only once it would pass review. resolveMap used to load any row by
 * id, so a draft — or a rejected map — was a game for anyone holding its UUID.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMapRowById = vi.hoisted(() => vi.fn());
vi.mock('../../db/postgres/mapsRepository', () => ({ getMapRowById }));

import { checkMapPlayable } from './mapPlayability';

const AUTHOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

function ringRow(overrides: Record<string, unknown> = {}) {
  const territories = Array.from({ length: 7 }, (_, i) => ({
    territory_id: `t${i}`,
    name: `T${i}`,
    polygon: [[0, 0], [1, 0], [1, 1]],
    center_point: [0.5, 0.5],
    region_id: 'r1',
  }));
  const connections = territories.map((_, i) => ({ from: `t${i}`, to: `t${(i + 1) % 7}`, type: 'land' }));
  return {
    map_id: 'm1',
    creator_id: AUTHOR,
    name: 'Ring',
    territories,
    connections,
    regions: [{ region_id: 'r1', name: 'Ring', bonus: 3 }],
    is_public: false,
    moderation_status: 'draft',
    ...overrides,
  };
}

beforeEach(() => getMapRowById.mockReset());

describe('checkMapPlayable', () => {
  it('lets anyone play a board that is not a database row', async () => {
    getMapRowById.mockResolvedValueOnce(null);
    expect(await checkMapPlayable('tutorial', OTHER)).toEqual({ ok: true });
  });

  it('lets anyone play a system map and an approved community map', async () => {
    getMapRowById.mockResolvedValueOnce(ringRow({ creator_id: 'system', moderation_status: 'approved' }));
    expect(await checkMapPlayable('era_ww2', OTHER)).toEqual({ ok: true });
    getMapRowById.mockResolvedValueOnce(ringRow({ is_public: true, moderation_status: 'approved' }));
    expect(await checkMapPlayable('m1', OTHER)).toEqual({ ok: true });
  });

  it('refuses a draft, a pending and a rejected map to anyone but the author', async () => {
    for (const status of ['draft', 'pending', 'rejected']) {
      getMapRowById.mockResolvedValueOnce(ringRow({ moderation_status: status }));
      const result = await checkMapPlayable('m1', OTHER);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not been published/);
    }
  });

  it('lets the author test-play a draft that would pass review', async () => {
    getMapRowById.mockResolvedValueOnce(ringRow());
    expect(await checkMapPlayable('m1', AUTHOR)).toEqual({ ok: true });
  });

  it('refuses the author a draft that review would block, naming the first problem', async () => {
    const row = ringRow();
    row.connections = row.connections.filter((c) => c.from !== 't6' && c.to !== 't6');
    getMapRowById.mockResolvedValueOnce(row);
    const result = await checkMapPlayable('m1', AUTHOR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^This draft is not playable yet: /);
      expect(result.reason).toContain('T6');
    }
  });

  it('counts the further problems it is not quoting', async () => {
    getMapRowById.mockResolvedValueOnce(ringRow({ territories: [], connections: [] }));
    const result = await checkMapPlayable('m1', AUTHOR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\(and \d+ more — see the editor\)$/);
  });
});
