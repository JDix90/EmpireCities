/**
 * First Steps: "Complete the interactive tutorial." The tutorial's game is
 * abandoned when the player leaves its last card, so the game-end check that
 * granted it never saw a finished lesson. The client records the lesson done
 * here, and finishing the core lesson now grants it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const queryMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock('../../db/postgres', () => ({
  query: (...a: unknown[]) => queryMock(...(a as [])),
  queryOne: async () => null,
  withTransaction: vi.fn(),
}));
const grant = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock('../../game-engine/achievements/achievementService', () => ({ grantAchievementsOutsideGame: grant }));

const USER_ID = '11111111-2222-4333-8444-555555555555';

describe('POST /api/users/me/tutorial-modules/:moduleId', () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  beforeAll(async () => {
    const { signAccessToken } = await import('../../utils/jwt');
    auth = { authorization: `Bearer ${signAccessToken({ sub: USER_ID, username: 'tester', guest: false, admin: false })}` };
    const { usersRoutes } = await import('./users.routes');
    app = Fastify();
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.ready();
  });
  afterAll(() => app.close());
  beforeEach(() => grant.mockClear());

  const post = (moduleId: string) =>
    app.inject({ method: 'POST', url: `/api/users/me/tutorial-modules/${moduleId}`, headers: auth });

  it('grants First Steps when the core lesson is recorded done', async () => {
    expect((await post('core')).statusCode).toBe(204);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_tutorial_modules'), [USER_ID, 'core']);
    expect(grant).toHaveBeenCalledWith(USER_ID, ['tutorial_complete']);
  });

  it('grants nothing for a deep-dive lesson', async () => {
    expect((await post('tech_tree')).statusCode).toBe(204);
    expect(grant).not.toHaveBeenCalled();
  });
});
