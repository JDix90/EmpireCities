/**
 * POST /api/feedback's contract: what it accepts, what it refuses, and what it
 * stores. Free text from a player, so the limits are the point: a capped
 * comment, a closed set of everything else, and nothing without a rating or a
 * comment. The Postgres side (one game-over row per game, the admin report)
 * is in feedback.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const recordFeedbackMock = vi.hoisted(() => vi.fn(async () => 'fb-1'));
const queryOneMock = vi.hoisted(() => vi.fn());
const flags = vi.hoisted(() => ({ beta: true, menu: true }));
const caller = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('./feedback.service', () => ({
  FEEDBACK_COMMENT_MAX: 1000,
  recordFeedback: recordFeedbackMock,
}));
vi.mock('../../db/postgres', () => ({ queryOne: queryOneMock }));
vi.mock('../../config/featureFlags', () => ({
  featureFlags: {
    get galaxyAgeBetaEnabled() { return flags.beta; },
    get feedbackMenuEnabled() { return flags.menu; },
  },
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string; isAdmin?: boolean }) => {
    req.userId = 'user-1';
    req.isAdmin = caller.isAdmin;
  },
}));

import { feedbackRoutes } from './feedback.routes';

const GAME = '0b6f3c1e-9f7e-4f8f-8a43-0d3a3f1e2a11';

async function post(payload: Record<string, unknown>) {
  const app: FastifyInstance = Fastify();
  await app.register(feedbackRoutes, { prefix: '/api/feedback' });
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: { topic: 'galactic_age', ...payload } });
  await app.close();
  return res;
}

async function postGeneral(payload: Record<string, unknown>) {
  const app: FastifyInstance = Fastify();
  await app.register(feedbackRoutes, { prefix: '/api/feedback' });
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/api/feedback', payload: { topic: 'general', source: 'menu', ...payload } });
  await app.close();
  return res;
}

describe('POST /api/feedback', () => {
  beforeEach(() => {
    recordFeedbackMock.mockClear();
    queryOneMock.mockReset();
    flags.beta = true;
    flags.menu = true;
    caller.isAdmin = false;
  });

  it('stores a rating with its context', async () => {
    queryOneMock.mockResolvedValue({ era_id: 'galaxy_age', map_id: 'era_galaxy' });
    const res = await post({ source: 'game_over', rating: 'up', game_id: GAME, turn: 12, device: 'tablet', viewport: '820x1180' });
    expect(res.statusCode).toBe(201);
    expect(recordFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', source: 'game_over', rating: 'up', comment: null, gameId: GAME, turn: 12, device: 'tablet', viewport: '820x1180',
      category: null, page: null,
    }));
  });

  it('trims a comment and drops NUL bytes, which Postgres would refuse', async () => {
    const res = await post({ source: 'beta_panel', comment: '  lanes\u0000 feel fair  ' });
    expect(res.statusCode).toBe(201);
    expect(recordFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({ comment: 'lanes feel fair', rating: null, gameId: null }));
  });

  it.each([
    ['nothing to say', { source: 'beta_panel' }],
    ['only spaces', { source: 'beta_panel', comment: '    ' }],
    ['a comment over 1,000 characters', { source: 'beta_panel', comment: 'x'.repeat(1001) }],
    ['a rating that is not a thumb', { source: 'beta_panel', rating: 'meh' }],
    ['a source it does not know', { source: 'email', rating: 'up' }],
    ['a game-over answer without its game', { source: 'game_over', rating: 'up' }],
    ['a screen size that is not one', { source: 'beta_panel', rating: 'up', viewport: '<b>x</b>' }],
    ['a device it does not know', { source: 'beta_panel', rating: 'up', device: 'fridge' }],
  ])('refuses %s', async (_label, payload) => {
    const res = await post(payload);
    expect(res.statusCode).toBe(400);
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });

  it('refuses a game the sender did not play in the Galactic Age', async () => {
    queryOneMock.mockResolvedValue(null);
    expect((await post({ source: 'game_over', rating: 'up', game_id: GAME })).statusCode).toBe(403);
    queryOneMock.mockResolvedValue({ era_id: 'ww2', map_id: 'era_ww2' });
    expect((await post({ source: 'game_over', rating: 'up', game_id: GAME })).statusCode).toBe(403);
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });

  it('is closed while the beta is, except to an admin', async () => {
    flags.beta = false;
    expect((await post({ source: 'beta_panel', rating: 'up' })).statusCode).toBe(403);
    caller.isAdmin = true;
    expect((await post({ source: 'beta_panel', rating: 'up' })).statusCode).toBe(201);
  });
});

describe('POST /api/feedback from the lobby menu', () => {
  beforeEach(() => {
    recordFeedbackMock.mockClear();
    queryOneMock.mockReset();
    flags.beta = false;
    flags.menu = true;
    caller.isAdmin = false;
  });

  it('stores a note with its category and the page it came from, beta or not', async () => {
    const res = await postGeneral({ category: 'bug', comment: 'The chat box covers the map on my phone.', page: '/lobby', device: 'phone', viewport: '390x844' });
    expect(res.statusCode).toBe(201);
    expect(recordFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'general', source: 'menu', category: 'bug', comment: 'The chat box covers the map on my phone.',
      page: '/lobby', gameId: null, rating: null,
    }));
  });

  it.each([
    ['no note', { category: 'idea' }],
    ['only spaces', { comment: '   ' }],
    ['a category it does not know', { category: 'rant', comment: 'x' }],
    ['a page that is not a path', { comment: 'x', page: 'https://example.com' }],
    ['a game', { comment: 'x', game_id: GAME }],
    ['the wrong source', { source: 'beta_panel', comment: 'x' }],
  ])('refuses %s', async (_label, payload) => {
    expect((await postGeneral(payload)).statusCode).toBe(400);
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });

  it('keeps the Galactic Age form from posting as the menu', async () => {
    flags.beta = true;
    expect((await post({ source: 'menu', comment: 'x' })).statusCode).toBe(400);
  });

  it('is closed while its switch is off, except to an admin', async () => {
    flags.menu = false;
    expect((await postGeneral({ comment: 'hello' })).statusCode).toBe(403);
    caller.isAdmin = true;
    expect((await postGeneral({ comment: 'hello' })).statusCode).toBe(201);
  });
});
