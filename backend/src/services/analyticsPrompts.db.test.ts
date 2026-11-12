/**
 * The Prompts report against real Postgres (funnel_events_v2_enabled): save
 * prompts and reminder asks shown against answered, by surface, in players;
 * the browser's answers; the Tomorrow panel; Daily Challenge links. Limited to
 * the players this file seeds, so it is safe beside the other PG_TEST files.
 *
 * Needs Postgres (migrated schema), gated on PG_TEST=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { getPromptFunnel as GetPromptFunnel } from './analyticsQueries';

const enabled = process.env.PG_TEST === '1';

describe.runIf(enabled)('prompts report (Postgres)', () => {
  let query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let getPromptFunnel: typeof GetPromptFunnel;
  const userIds: string[] = [];

  async function seedUser(name: string, opts: { guest?: boolean; excluded?: boolean } = {}): Promise<string> {
    const id = uuidv4();
    userIds.push(id);
    const username = `${name}_${id.slice(0, 8)}`;
    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest, exclude_from_stats) VALUES ($1, $2, $3, 'x', $4, $5)`,
      [id, username, `${username}@test.local`, opts.guest ?? true, opts.excluded ?? false],
    );
    return id;
  }

  async function event(userId: string, name: string, properties: Record<string, string> = {}, daysAgo = 0): Promise<void> {
    await query(
      `INSERT INTO analytics_events (event, user_id, properties, created_at) VALUES ($1, $2, $3::jsonb, NOW() - make_interval(days => $4::int))`,
      [name, userId, JSON.stringify(properties), daysAgo],
    );
  }

  beforeAll(async () => {
    ({ query } = (await import('../db/postgres')) as unknown as { query: typeof query });
    ({ getPromptFunnel } = await import('./analyticsQueries'));
  });

  afterAll(async () => {
    if (userIds.length === 0) return;
    await query(`DELETE FROM analytics_events WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [userIds]);
  });

  it('counts players per surface, shown against answered, and leaves out test accounts and old events', async () => {
    const a = await seedUser('prompt_a');
    const b = await seedUser('prompt_b');
    const c = await seedUser('prompt_c', { guest: false });
    const tester = await seedUser('prompt_test', { excluded: true });

    // a saw the results prompt three times and pressed it once: one player each way.
    for (let i = 0; i < 3; i++) await event(a, 'save_prompt_shown', { surface: 'results' });
    await event(a, 'save_prompt_clicked', { surface: 'results' });
    await event(b, 'save_prompt_shown', { surface: 'results' });
    await event(b, 'save_prompt_shown', { surface: 'guest_gate', page: 'friends' });
    // Outside the window, and a test account: neither counts.
    await event(c, 'save_prompt_shown', { surface: 'results' }, 40);
    await event(tester, 'save_prompt_shown', { surface: 'results' });

    await event(a, 'push_ask_shown', { surface: 'results', ios_tab: 'false' });
    await event(b, 'push_ask_shown', { surface: 'results', ios_tab: 'false' });
    await event(b, 'push_ask_dismissed', { surface: 'results', ios_tab: 'false' });
    await event(a, 'push_optin_granted', { result: 'granted' });

    await event(a, 'tomorrow_panel_shown', { is_guest: 'true', daily_streak: '1', daily_open: 'true' });
    await event(c, 'tomorrow_panel_shown', { is_guest: 'false', daily_streak: '4', daily_open: 'false' });
    await event(a, 'daily_link_clicked', { surface: 'tomorrow' });
    await event(c, 'daily_link_clicked', { surface: 'lobby', place: 'daily_card' });

    const r = await getPromptFunnel(30, userIds);
    expect(r.save).toEqual([
      { surface: 'results', shown: 2, clicked: 1 },
      { surface: 'guest_gate', shown: 1, clicked: 0 },
    ]);
    expect(r.push).toEqual([{ surface: 'results', shown: 2, dismissed: 1 }]);
    expect(r.push_granted).toBe(1);
    expect(r.push_refused).toBe(0);
    expect(r.tomorrow_shown).toBe(2);
    expect(r.tomorrow_shown_guests).toBe(1);
    expect(r.daily_links).toEqual(expect.arrayContaining([{ surface: 'tomorrow', players: 1 }, { surface: 'lobby', players: 1 }]));
    expect(r.measured_since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports nothing measured before any prompt is recorded', async () => {
    const r = await getPromptFunnel(30, [uuidv4()]);
    expect(r).toEqual({
      save: [], push: [], push_granted: 0, push_refused: 0, tomorrow_shown: 0, tomorrow_shown_guests: 0, daily_links: [], measured_since: null,
    });
  });
});
