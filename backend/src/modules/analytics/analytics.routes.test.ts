/**
 * The client→server event allowlist is the contract between the UI and the
 * funnel. A name the UI sends that is missing here is not an error the UI can
 * see: `api.post(...).catch(() => {})` swallows the 400 and the event simply
 * never lands, so the funnel quietly reads as "nobody ever did this".
 *
 * `tutorial_exited` is covered specifically because it is the only view we
 * have of WHERE players leave the tutorial — `tutorial_started` and
 * `tutorial_completed` are server-side and give the rate, not the step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const recordServerEventMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/analyticsEvents', () => ({
  recordServerEvent: (...a: unknown[]) => recordServerEventMock(...a),
}));
vi.mock('../../middleware/authenticate', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = 'user-1';
  },
}));

import { analyticsRoutes } from './analytics.routes';

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.ready();
  return app;
}

describe('POST /api/analytics/ui-event', () => {
  beforeEach(() => recordServerEventMock.mockReset());

  it.each(['push_optin_granted', 'push_optin_refused'])(
    "accepts %s with the browser's answer — the opt-in card's conversion depends on it landing",
    async (event) => {
      const app = await build();
      const res = await app.inject({
        method: 'POST',
        url: '/api/analytics/ui-event',
        payload: { event, properties: { result: event.endsWith('granted') ? 'granted' : 'denied' } },
      });
      expect(res.statusCode).toBe(200);
      expect(recordServerEventMock).toHaveBeenCalledWith(event, expect.objectContaining({ result: expect.any(String) }), 'user-1');
      await app.close();
    },
  );

  it('accepts tutorial_exited with the step it was left on', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: {
        event: 'tutorial_exited',
        properties: {
          via: 'exit_button',
          module: 'core',
          step: 'draft_do',
          step_index: '2',
          step_count: '9',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith(
      'tutorial_exited',
      expect.objectContaining({ via: 'exit_button', step: 'draft_do', step_index: '2' }),
      'user-1',
    );
    await app.close();
  });

  it('accepts turn_dismiss_taps with the round tally, zeros included', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: {
        event: 'turn_dismiss_taps',
        properties: { layout: 'phone', turn: '6', tier1: '0', tier2: '1', tier3: '0', era: 'ancient', is_tutorial: 'false' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith(
      'turn_dismiss_taps',
      expect.objectContaining({ layout: 'phone', turn: '6', tier2: '1', tier3: '0' }),
      'user-1',
    );
    await app.close();
  });

  it("accepts app_opened, a player's daily visit, against the signed-in player", async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: { event: 'app_opened', properties: { device: 'phone' } },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith('app_opened', { device: 'phone' }, 'user-1');
    await app.close();
  });

  it('accepts first_turn_step, a step of a real game\'s first turn, against the signed-in player', async () => {
    const app = await build();
    const properties = { step: 'territory_opened', game_id: 'g1', era: 'medieval', first_match: 'true', layout: 'phone', seconds: '14' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: { event: 'first_turn_step', properties },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith('first_turn_step', properties, 'user-1');
    await app.close();
  });

  it('accepts the coach tips answer and the strip\u2019s Hide tips, with a known choice only', async () => {
    const app = await build();
    for (const event of ['coach_tips_choice', 'coach_tips_hidden']) {
      const ok = await app.inject({
        method: 'POST', url: '/api/analytics/ui-event',
        payload: { event, properties: { choice: 'off', first_match: 'true' } },
      });
      expect(ok.statusCode).toBe(200);
    }
    const bad = await app.inject({
      method: 'POST', url: '/api/analytics/ui-event',
      payload: { event: 'coach_tips_choice', properties: { choice: 'maybe' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(recordServerEventMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects a first_turn_step that names no step, or one it does not know', async () => {
    const app = await build();
    for (const properties of [{ game_id: 'g1' }, { step: 'clicked_everything', game_id: 'g1' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analytics/ui-event',
        payload: { event: 'first_turn_step', properties },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(recordServerEventMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts results_action, what a player pressed on the game-over screen', async () => {
    const app = await build();
    const properties = { action: 'rematch', outcome: 'lost', game_id: 'g1', first_match: 'true', is_tutorial: 'false', is_guest: 'true' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: { event: 'results_action', properties },
    });

    expect(res.statusCode).toBe(200);
    expect(recordServerEventMock).toHaveBeenCalledWith('results_action', properties, 'user-1');
    await app.close();
  });

  it('rejects a results_action that names no action, or one it does not know', async () => {
    const app = await build();
    for (const properties of [{ outcome: 'won' }, { action: 'rage_quit', outcome: 'lost' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/analytics/ui-event',
        payload: { event: 'results_action', properties },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(recordServerEventMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('still rejects a name that is not on the allowlist', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analytics/ui-event',
      payload: { event: 'tutorial_vibes', properties: { step: 'draft_do' } },
    });

    expect(res.statusCode).toBe(400);
    expect(recordServerEventMock).not.toHaveBeenCalled();
    await app.close();
  });
});
