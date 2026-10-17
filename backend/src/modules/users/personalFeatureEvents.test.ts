/**
 * The guest-account readout asks whether guests use the things opened to them
 * (guest_personal_features_enabled). Looking at their achievements and wearing
 * a cosmetic each record an event that says whether the player was a guest.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => [] as unknown[]));
const txnQueryMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ rows: [] as unknown[] })));
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: async (...a: unknown[]) => ((await queryMock(...a)) as unknown[])[0] ?? null,
  withTransaction: async (fn: (client: { query: typeof txnQueryMock }) => Promise<unknown>) =>
    fn({ query: txnQueryMock }),
}));
const eventMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/analyticsEvents', () => ({ recordServerEvent: (...a: unknown[]) => eventMock(...a) }));

const GUEST_ID = '11111111-2222-4333-8444-555555555555';
const PLAYER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('personal feature events', () => {
  let app: FastifyInstance;
  let auth: (id: string, guest: boolean) => { authorization: string };

  beforeAll(async () => {
    const { signAccessToken } = await import('../../utils/jwt');
    auth = (id, guest) => ({
      authorization: `Bearer ${signAccessToken({ sub: id, username: 'SwiftFalcon_48213', guest, admin: false })}`,
    });
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    eventMock.mockClear();
    queryMock.mockClear();
    txnQueryMock.mockReset();
    txnQueryMock.mockResolvedValue({ rows: [] });
  });

  it('records a guest looking at their achievements, and a player', async () => {
    const guest = await app.inject({ method: 'GET', url: '/api/users/me/achievements', headers: auth(GUEST_ID, true) });
    expect(guest.statusCode).toBe(200);
    expect(eventMock).toHaveBeenCalledWith('achievements_viewed', { is_guest: true }, GUEST_ID);

    await app.inject({ method: 'GET', url: '/api/users/me/achievements', headers: auth(PLAYER_ID, false) });
    expect(eventMock).toHaveBeenCalledWith('achievements_viewed', { is_guest: false }, PLAYER_ID);
  });

  it('records the slots a guest put something in, once the change is saved', async () => {
    // Owns the frame; the loadout row exists, so the equip goes through.
    queryMock.mockImplementation(async (sql: unknown) => (String(sql).includes('FROM user_cosmetics') ? [{ '?column?': 1 }] : []));
    txnQueryMock.mockResolvedValue({
      rows: [{ equipped_frame: null, equipped_frame_type: null, equipped_banner: null, equipped_marker: null, equipped_dice: null }],
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/cosmetics/equip',
      headers: auth(GUEST_ID, true),
      payload: { frame_id: 'frame_bronze', dice_id: null },
    });

    expect(res.statusCode, res.body).toBe(200);
    // The dice slot was emptied, not filled: only the frame counts as worn.
    expect(eventMock).toHaveBeenCalledWith('cosmetic_equipped', { slots: 'frame', is_guest: true }, GUEST_ID);
    queryMock.mockImplementation(async () => []);
  });

  it('records nothing when the equip does not go through', async () => {
    // Not owned: refused before anything is saved.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/cosmetics/equip',
      headers: auth(GUEST_ID, true),
      payload: { frame_id: 'frame_gold' },
    });
    expect(res.statusCode).toBe(403);
    expect(eventMock).not.toHaveBeenCalledWith('cosmetic_equipped', expect.anything(), expect.anything());
  });

  it('records nothing for taking things off', async () => {
    txnQueryMock.mockResolvedValue({
      rows: [{ equipped_frame: 'frame_bronze', equipped_frame_type: 'profile_frame', equipped_banner: null, equipped_marker: null, equipped_dice: null }],
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/me/cosmetics/equip',
      headers: auth(GUEST_ID, true),
      payload: { frame_id: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(eventMock).not.toHaveBeenCalledWith('cosmetic_equipped', expect.anything(), expect.anything());
  });
});
