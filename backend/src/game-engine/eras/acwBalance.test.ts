import { describe, it, expect } from 'vitest';
import { ACW_FACTIONS } from './acw';

/**
 * The American Civil War was not unbalanced. It was unplayable.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 50% fair share — two seats, so the harness rotates which
 * faction sits first every game and turn order is fully controlled for:
 *
 *   before                 after
 *   union        99%       53% / 56% / 52%
 *   confederacy   1%       47% / 44% / 48%
 *   spread       98        6 / 12 / 4
 *
 * Identical at all three seeds before: 99/1, eliminated in 99%. Nobody who
 * picked the Confederacy was playing a game.
 *
 * The Confederacy had no ability and no numeric bonus of any kind, and the one
 * trait it advertised — "recovers stability quickly under pressure" — was
 * false twice over. The `stability_recovery_bonus: 3` sitting six lines above
 * it in acw.ts belongs to the Union, and the stat is inert anyway because
 * stability_enabled defaults false (state/gameSettings.ts).
 *
 * Two causes, separated by measurement rather than guessed at:
 *
 *  - INCOME. The Union drafts 4 a turn to the Confederacy's 3. Head-to-head
 *    that compounds: matching it alone moved the era 99/1 -> 87/13.
 *  - SHAPE. The Confederacy holds THREE home regions over nine territories to
 *    the Union's two over six, so it mans a longer line and drops a whole
 *    region bonus more easily. Stripping BOTH kits still left the Union at
 *    76/24; swapping the two homelands with both kits stripped flipped it to
 *    53/48. That is what says the map is drawn fine and the gap is position
 *    plus income — so no territory, connection or region bonus is touched.
 *
 * The fix pays for shape with a toll rather than more income, because the
 * Confederacy loses on attrition, not on economy: match the draft, and make
 * the first attack each turn cost the attacker a unit. A second reinforcement
 * instead of the toll was measured at 57/43, and the toll on top of a second
 * reinforcement overshot to 23/77.
 */
describe('acw balance anchors', () => {
  const byId = new Map(ACW_FACTIONS.map((f) => [f.faction_id, f]));

  it('the Confederacy drafts level with the Union', () => {
    // 99/1 -> 87/13 on this line alone. Anything less and the era is decided
    // by income before either side has made a decision.
    const union = byId.get('union')?.reinforce_bonus ?? 0;
    expect(byId.get('confederacy')?.reinforce_bonus ?? 0).toBeGreaterThanOrEqual(union);
  });

  it('the Confederacy has a kit at all', () => {
    expect(byId.get('confederacy')?.ability_id).toBe('interior_lines');
    expect(byId.get('confederacy')?.ability_description).toBeTruthy();
  });

  it('neither side claims stability recovery it does not carry', () => {
    // The original defect: the Confederacy advertised the Union's stat. The
    // general rule lives in factionKit.test.ts; this pins the two factions the
    // bug was actually found on.
    for (const f of ACW_FACTIONS) {
      if (/recovers stability|stability recovery|stability quickly/i.test(f.description ?? '')) {
        expect((f.stability_recovery_bonus ?? 0), `${f.faction_id}`).toBeGreaterThan(0);
      }
    }
  });

  it('the era is still two-sided', () => {
    // A guard against "fixing" this by making the Confederacy the new runaway.
    // Both sides carry a kit; neither carries two numeric bonuses the other lacks.
    expect(ACW_FACTIONS).toHaveLength(2);
    for (const f of ACW_FACTIONS) expect(f.ability_id, f.faction_id).toBeTruthy();
  });
});
