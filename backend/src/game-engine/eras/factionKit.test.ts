import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';
import {
  ANCIENT_FACTIONS, MEDIEVAL_FACTIONS, DISCOVERY_FACTIONS, WW2_FACTIONS, COLDWAR_FACTIONS,
  MODERN_FACTIONS, ACW_FACTIONS, RISORGIMENTO_FACTIONS, SPACE_AGE_FACTIONS, GALAXY_AGE_FACTIONS,
} from './index';

const ALL_FACTIONS = [
  ...ANCIENT_FACTIONS, ...MEDIEVAL_FACTIONS, ...DISCOVERY_FACTIONS, ...WW2_FACTIONS,
  ...COLDWAR_FACTIONS, ...MODERN_FACTIONS, ...ACW_FACTIONS, ...RISORGIMENTO_FACTIONS,
  ...SPACE_AGE_FACTIONS, ...GALAXY_AGE_FACTIONS,
];

/**
 * Every place a faction kit may actually be implemented, besides
 * TERRITORY_ABILITY_DEFS. Ids are read out of these files rather than restated
 * here, so a branch deleted from combat stops being a valid kit on the same
 * commit instead of leaving a faction pointing at something that is gone.
 *
 * The list is deliberately explicit and short. A kit wired up somewhere else
 * fails this test, which is the point: `blitzkrieg` lived only as a socket
 * state machine and was invisible to the balance harness for as long as it
 * existed, and `drift_jump` and `emergency_seal` are the same bespoke shape.
 * A new one should have to say so here.
 */
const KIT_SOURCES = [
  '../combat/defenderReactions.ts',
  '../combat/combatModifiers.ts',
  '../../sockets/gameSocket.ts',
  '../state/moonAccess.ts',
] as const;

function implementedAbilityIds(): Set<string> {
  const ids = new Set<string>();
  for (const rel of KIT_SOURCES) {
    const src = readFileSync(join(__dirname, rel), 'utf-8');
    // Three spellings in use: a local `abilityId`, a faction read inline
    // (`attackerFaction?.ability_id === '…'`), and a hoisted constant.
    for (const m of src.matchAll(/(?:abilityId|ability_id) === '([a-z_0-9]+)'/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/[A-Z_]*ABILITY_ID = '([a-z_0-9]+)'/g)) ids.add(m[1]!);
  }
  return ids;
}

describe('every faction ships with a kit', () => {
  const implemented = implementedAbilityIds();

  it('reads a plausible set of ids out of the kit sources', () => {
    // A regex that matched nothing would make the resolution test below pass
    // for every faction, including one pointing at an id that does not exist.
    expect(implemented.size).toBeGreaterThanOrEqual(10);
    for (const id of ['parting_shot', 'scorched_earth', 'interior_lines', 'blitzkrieg']) {
      expect(implemented, `${id} should be found in a kit source`).toContain(id);
    }
  });

  it('finds every faction (a vacuous sweep is not a passing one)', () => {
    expect(ALL_FACTIONS.length).toBeGreaterThanOrEqual(52);
  });

  /**
   * Five factions shipped with no ability at all — carthage, spain, ww2's uk,
   * the ussr and the confederacy — and the lore catalog covered for four of
   * them by advertising named abilities (Naval Supremacy, Conquistador,
   * Commonwealth, Southern Defense) that were buttons nobody could press. #403
   * removed the false copy; this is the rule that stops the hole reopening.
   */
  it('every faction has an ability_id', () => {
    const kitless = ALL_FACTIONS.filter((f) => !f.ability_id).map((f) => f.faction_id);
    expect(kitless).toEqual([]);
  });

  it('every ability_id resolves to a real mechanic', () => {
    const dangling = ALL_FACTIONS
      .filter((f) => f.ability_id)
      .filter((f) => !TERRITORY_ABILITY_DEFS[f.ability_id!] && !implemented.has(f.ability_id!))
      .map((f) => `${f.faction_id} -> ${f.ability_id}`);
    expect(dangling).toEqual([]);
  });

  it('every ability is described to the player', () => {
    const undescribed = ALL_FACTIONS
      .filter((f) => f.ability_id && !f.ability_description?.trim())
      .map((f) => `${f.faction_id} (${f.ability_id})`);
    expect(undescribed).toEqual([]);
  });

  /**
   * The client half of the same hole. A faction ability a player ACTIVATES
   * needs an entry in the frontend's FACTION_ABILITY_UI or no button is ever
   * rendered, so the kit exists only for bots. Reactions are exempt because
   * they resolve inside combat with nothing to press — and the test asserts
   * they are absent rather than merely tolerated, so a reaction cannot be
   * given a dead button either.
   *
   * Read out of the frontend source for the same reason the reaction ids are:
   * an entry deleted there fails here on the same commit.
   */
  it('every activatable faction ability has a client button', () => {
    const ui = readFileSync(
      join(__dirname, '../../../../frontend/src/utils/factionAbilities.ts'), 'utf-8',
    );
    const body = ui.slice(ui.indexOf('FACTION_ABILITY_UI: Record<string, FactionAbilityUiDef> = {'));
    const buttons = new Set([...body.matchAll(/^ {2}([a-z_][a-z0-9_]*): \{/gm)].map((m) => m[1]!));
    expect(buttons.size).toBeGreaterThanOrEqual(30);

    const reactions = new Set(
      [...readFileSync(join(__dirname, '../combat/defenderReactions.ts'), 'utf-8')
        .matchAll(/abilityId === '([a-z_0-9]+)'/g)].map((m) => m[1]!),
    );

    // Abilities resolved by a passive rule rather than a press: Portugal's sea
    // cap in combatModifiers, the Papal influence block, and the two galaxy
    // kits on bespoke handlers. Listed so the exemption is deliberate.
    const PASSIVE = new Set(['naval_charts', 'papal_dispensation', 'drift_jump', 'emergency_seal']);

    const buttonless = ALL_FACTIONS
      .filter((f) => f.ability_id && !reactions.has(f.ability_id) && !PASSIVE.has(f.ability_id))
      .filter((f) => !buttons.has(f.ability_id!))
      .map((f) => `${f.faction_id} -> ${f.ability_id}`);
    expect(buttonless).toEqual([]);

    const pressableReactions = ALL_FACTIONS
      .filter((f) => f.ability_id && reactions.has(f.ability_id) && buttons.has(f.ability_id))
      .map((f) => `${f.faction_id} -> ${f.ability_id}`);
    expect(pressableReactions).toEqual([]);
  });

  /**
   * Existing is not the same as VISIBLE. `requiresEconomy` hides a button
   * whenever the economy layer is off and `techCost` hides it until the player
   * can afford it — and both systems default OFF, so either one makes the
   * button unreachable in a normal game.
   *
   * Six faction kits were sitting behind that. Five also had a server-side
   * cost; `spice_trade` did not — #400 dropped ITS cost and measured Mughal
   * 3% -> 9% on the strength of it, but missed this file, so the bot got the
   * kit and the human never saw the button. That asymmetry is the worst shape
   * this bug takes, because the balance numbers say the faction is fixed.
   */
  it('no faction button is hidden by a system that is off by default', () => {
    const ui = readFileSync(
      join(__dirname, '../../../../frontend/src/utils/factionAbilities.ts'), 'utf-8',
    );
    const body = ui.slice(ui.indexOf('FACTION_ABILITY_UI: Record<string, FactionAbilityUiDef> = {'));
    const entries = new Map<string, string>();
    for (const m of body.matchAll(/^ {2}([a-z_][a-z0-9_]*): \{(.*?)^ {2}\},/gms)) {
      entries.set(m[1]!, m[2]!);
    }
    expect(entries.size).toBeGreaterThanOrEqual(30);

    const hidden = ALL_FACTIONS
      .filter((f) => f.ability_id && entries.has(f.ability_id))
      .filter((f) => /requiresEconomy|techCost/.test(entries.get(f.ability_id!)!))
      .map((f) => `${f.faction_id} -> ${f.ability_id}`);
    expect(hidden).toEqual([]);
  });

  /**
   * `stability_recovery_bonus` does nothing unless stability_enabled is on, and
   * it defaults FALSE (state/gameSettings.ts). The UK's description led with it
   * as its whole kit, and the Confederacy claimed it without even carrying the
   * field — the bonus sitting next to it in acw.ts belongs to the Union. A
   * faction may hold the stat, and may mention it, but it may not be the only
   * thing a faction offers.
   */
  it('no faction relies on stability recovery as its entire kit', () => {
    const offenders = ALL_FACTIONS
      .filter((f) => /stability/i.test(f.description ?? ''))
      .filter((f) => !f.ability_id
        && !(f.passive_attack_bonus ?? 0) && !(f.reinforce_bonus ?? 0) && !(f.tech_point_income ?? 0))
      .map((f) => f.faction_id);
    expect(offenders).toEqual([]);
  });

  it('a description claiming stability recovery has the field behind it', () => {
    const offenders = ALL_FACTIONS
      .filter((f) => /recovers stability|stability recovery|stability quickly/i.test(f.description ?? ''))
      .filter((f) => (f.stability_recovery_bonus ?? 0) <= 0)
      .map((f) => `${f.faction_id}: ${f.description}`);
    expect(offenders).toEqual([]);
  });
});
