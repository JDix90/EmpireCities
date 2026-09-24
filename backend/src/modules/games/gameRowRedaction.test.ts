import { describe, it, expect } from 'vitest';
import { redactGameRowForViewer } from './gameRowRedaction';

/** A daily-challenge game row as `GET /:gameId`'s `SELECT g.*` returns it. */
function dailyRow(): Record<string, unknown> {
  return {
    game_id: 'g1',
    status: 'in_progress',
    join_code: 'ABCD',
    settings_json: {
      max_players: 4,
      seed: 'top-secret-seed',
      daily_challenge_spec: { archetype: 'domination', dice_queue_seed: 'dice-seed-123' },
    },
  };
}

describe('redactGameRowForViewer', () => {
  it('strips join_code for non-participants', () => {
    const row = dailyRow();
    redactGameRowForViewer(row, false);
    expect(row.join_code).toBeUndefined();
  });

  it('keeps join_code for participants', () => {
    const row = dailyRow();
    redactGameRowForViewer(row, true);
    expect(row.join_code).toBe('ABCD');
  });

  it('always strips the daily dice seed (nested + top-level), even for participants', () => {
    const row = dailyRow();
    redactGameRowForViewer(row, true);
    const settings = row.settings_json as Record<string, unknown>;
    expect(settings.seed).toBeUndefined();
    expect((settings.daily_challenge_spec as Record<string, unknown>).dice_queue_seed).toBeUndefined();
    // Non-sensitive fields are preserved.
    expect(settings.max_players).toBe(4);
    expect((settings.daily_challenge_spec as Record<string, unknown>).archetype).toBe('domination');
  });

  it('handles settings_json delivered as a JSON string and preserves the string shape', () => {
    const row = dailyRow();
    row.settings_json = JSON.stringify(row.settings_json);
    redactGameRowForViewer(row, false);
    expect(typeof row.settings_json).toBe('string');
    const parsed = JSON.parse(row.settings_json as string) as Record<string, unknown>;
    expect(parsed.seed).toBeUndefined();
    expect((parsed.daily_challenge_spec as Record<string, unknown>).dice_queue_seed).toBeUndefined();
  });

  it('is a safe no-op for ordinary (non-daily) games', () => {
    const row: Record<string, unknown> = {
      game_id: 'g2',
      join_code: 'WXYZ',
      settings_json: { fog_of_war: true },
    };
    expect(() => redactGameRowForViewer(row, true)).not.toThrow();
    expect((row.settings_json as Record<string, unknown>).fog_of_war).toBe(true);
    expect(row.join_code).toBe('WXYZ');
  });

  it('tolerates a missing/unparseable settings_json', () => {
    const a: Record<string, unknown> = { game_id: 'g3', settings_json: null };
    const b: Record<string, unknown> = { game_id: 'g4', settings_json: '{not json' };
    expect(() => redactGameRowForViewer(a, false)).not.toThrow();
    expect(() => redactGameRowForViewer(b, false)).not.toThrow();
  });

  describe('a Daily v2 day', () => {
    const v2 = {
      version: 2,
      theme: 'cut the supply line',
      plan: { steps: [{ kind: 'draft', to: 'gaul', when: 'objective_ai' }] },
      plan_prose: ['While it holds the objective, it reinforces Gaul.'],
      decisions_target: 2,
      verdicts: 'before_dice',
      intent: 'arrows',
      solution: { equity: 0.7, obvious_equity: 0.4, decisions: [{ turn: 1 }, { turn: 2 }], line: [] },
    };
    const v2Row = (intent = 'arrows'): Record<string, unknown> => ({
      game_id: 'g5',
      status: 'in_progress',
      settings_json: {
        seed: 'top-secret-seed',
        daily_challenge_spec: { archetype: 'military_capture', dice_queue_seed: 7, v2: { ...v2, intent } },
      },
    });

    it("strips the answer key for everyone — this route is one request from any signed-in user", () => {
      for (const participant of [false, true]) {
        const row = v2Row();
        redactGameRowForViewer(row, participant);
        const spec = (row.settings_json as Record<string, unknown>).daily_challenge_spec as Record<string, unknown>;
        const pub = spec.v2 as Record<string, unknown>;
        expect(pub.solution).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain('solution');
        // The public reading, exactly as the live socket sends it.
        expect(pub.theme).toBe('cut the supply line');
        expect(pub.plan_prose).toEqual(v2.plan_prose);
        expect(pub.decisions).toBe(2);
        expect(pub.plan).toEqual(v2.plan);
        expect(spec.dice_queue_seed).toBeUndefined();
      }
    });

    it('withholds the raw plan on a prose day, as the live socket does', () => {
      const row = v2Row('prose');
      redactGameRowForViewer(row, true);
      const pub = ((row.settings_json as Record<string, unknown>).daily_challenge_spec as Record<string, unknown>).v2 as Record<string, unknown>;
      expect(pub.plan).toBeUndefined();
      expect(pub.plan_prose).toEqual(v2.plan_prose);
    });

    it('strips it from a settings_json string too', () => {
      const row = v2Row();
      row.settings_json = JSON.stringify(row.settings_json);
      redactGameRowForViewer(row, false);
      expect(typeof row.settings_json).toBe('string');
      expect(row.settings_json as string).not.toContain('solution');
      expect(row.settings_json as string).not.toContain('dice_queue_seed');
    });
  });
});

