import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  DROP_ASSAULT_COOLDOWN_TURNS,
  DROP_ASSAULT_HELIUM3_COST,
  clearDropAssaultsFor,
  declareDropAssault,
  dropAssaultBlockReason,
  dropAssaultCooldownRemaining,
  isDropAssaultTarget,
  resolveDropAssaultsFor,
} from './dropAssault';

/**
 * The drop that can take a tile. Two things carry the design: the telegraph
 * (declared on one turn, landing on the next, with the target marked for
 * everyone in between) and the fact that the falling stack is a TRANSIENT
 * territory — so most of what these pin is that the transient never leaks and
 * that the foothold is re-checked at landing rather than trusted from
 * declaration.
 */

type Seed = { id: string; owner?: string | null; units?: number; moon?: boolean };

function mkState(seeds: Seed[], over: {
  helium3?: number;
  turn?: number;
  settings?: Partial<GameState['settings']>;
} = {}): GameState {
  const territories = Object.fromEntries(
    seeds.map((s) => [
      s.id,
      {
        territory_id: s.id,
        owner_id: s.owner ?? null,
        unit_count: s.units ?? 3,
        unit_type: 'infantry',
        buildings: [],
        region_id: s.moon ? 'lunar_surface' : 'north_america_2100',
        globe_id: s.moon ? 'moon' : 'earth',
      },
    ]),
  );
  const state = {
    era: 'space_age',
    phase: 'draft',
    turn_number: over.turn ?? 5,
    current_player_index: 0,
    map_era_floor: 1,
    diplomacy: [],
    settings: {
      space_age_moon_helium3_enabled: true,
      space_age_moon_gated_tier_enabled: true,
      tech_trees_enabled: true,
      ...over.settings,
    },
    territories,
    players: [
      { player_id: 'p1', helium3: over.helium3 ?? 20, cards: [], ability_uses: {}, unlocked_techs: [] },
      { player_id: 'p2', helium3: 0, cards: [], ability_uses: {}, unlocked_techs: [] },
    ] as unknown as PlayerState[],
  } as unknown as GameState;
  for (const p of state.players) {
    p.territory_count = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
  }
  return state;
}

const MAP = { territories: [], connections: [] } as unknown as GameMap;

const MOON: Seed[] = [
  { id: 'moon_polar_north', owner: 'p1', moon: true },
  { id: 'moon_mare_imbrium', owner: 'p1', moon: true },
  { id: 'moon_near_side_north', owner: 'p1', moon: true },
];

const EARTH: Seed[] = [
  { id: 'na_launch_base', owner: 'p1', units: 5 },
  { id: 'euro_spaceport', owner: 'p2', units: 2 },
];

/**
 * Dice are consumed as all attacker dice then all defender dice, so a scripted
 * sequence decides the battle outright: sixes for the attacker, ones for the
 * defender wins it, and the reverse loses it.
 */
const riggedDice = (attacker: number, defender: number) => {
  // Dice are drawn attacker-first: a three-unit stack rolls min(3-1, 3) = 2,
  // and everything after those two belongs to the defender.
  const ATTACKER_DICE = 2;
  let call = 0;
  return () => (call++ < ATTACKER_DICE ? attacker : defender);
};
const attackerWins = () => riggedDice(6, 1);
const attackerLoses = () => riggedDice(1, 6);

const declaredLastTurn = (state: GameState) => { state.turn_number += 1; };

describe('what can be dropped on', () => {
  it('takes enemy and neutral Earth ground', () => {
    const state = mkState([...EARTH, ...MOON, { id: 'asia_frontier', owner: null, units: 2 }]);
    expect(isDropAssaultTarget(state, 'p1', 'euro_spaceport')).toBe(true);
    expect(isDropAssaultTarget(state, 'p1', 'asia_frontier')).toBe(true);
  });

  it('refuses your own ground', () => {
    const state = mkState([...EARTH, ...MOON]);
    expect(isDropAssaultTarget(state, 'p1', 'na_launch_base')).toBe(false);
  });

  it('refuses the Moon', () => {
    // The Moon is reached by orbit lanes and fought over on the ground. A drop
    // that could skip that would make the lanes decorative.
    const state = mkState([...EARTH, ...MOON, { id: 'moon_far_side_north', owner: 'p2', moon: true }]);
    expect(isDropAssaultTarget(state, 'p1', 'moon_far_side_north')).toBe(false);
  });
});

describe('declaring a drop', () => {
  it('charges the fuel, marks the target, and starts the reload', () => {
    const state = mkState([...EARTH, ...MOON]);
    const res = declareDropAssault(state, 'p1', 'euro_spaceport');
    expect(res.ok).toBe(true);
    expect(state.players[0].helium3).toBe(20 - DROP_ASSAULT_HELIUM3_COST);
    expect(state.drop_assaults).toHaveLength(1);
    expect(state.drop_assaults![0]).toMatchObject({ owner_id: 'p1', target_id: 'euro_spaceport', units: 3 });
    expect(dropAssaultCooldownRemaining(state, 'p1')).toBe(DROP_ASSAULT_COOLDOWN_TURNS);
  });

  it('changes nothing on the ground yet — that is the whole point of the telegraph', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    expect(state.territories.euro_spaceport.unit_count).toBe(2);
    expect(state.territories.euro_spaceport.owner_id).toBe('p2');
  });

  it('needs three Moon tiles', () => {
    const state = mkState([...EARTH, MOON[0], MOON[1]]);
    expect(dropAssaultBlockReason(state, 'p1')).toMatch(/3 Moon territories \(you hold 2\)/);
    expect(declareDropAssault(state, 'p1', 'euro_spaceport').ok).toBe(false);
    expect(state.players[0].helium3).toBe(20);
  });

  it('needs the fuel', () => {
    const state = mkState([...EARTH, ...MOON], { helium3: 9 });
    expect(dropAssaultBlockReason(state, 'p1')).toMatch(/10 Helium-3 \(you have 9\)/);
  });

  it('allows only one in flight', () => {
    const state = mkState([...EARTH, ...MOON], { helium3: 40 });
    declareDropAssault(state, 'p1', 'euro_spaceport');
    expect(declareDropAssault(state, 'p1', 'euro_spaceport').error).toMatch(/already have a Drop Assault/);
  });

  it('reloads for three rounds, counting from the declaration', () => {
    const state = mkState([...EARTH, ...MOON], { helium3: 40 });
    declareDropAssault(state, 'p1', 'euro_spaceport');
    state.drop_assaults = [];              // it landed
    state.turn_number += 1;
    expect(dropAssaultCooldownRemaining(state, 'p1')).toBe(2);
    expect(declareDropAssault(state, 'p1', 'euro_spaceport').error).toMatch(/reloading \(2 turns/);
    state.turn_number += 2;
    expect(dropAssaultCooldownRemaining(state, 'p1')).toBe(0);
    expect(declareDropAssault(state, 'p1', 'euro_spaceport').ok).toBe(true);
  });

  it('refuses while the phase is off', () => {
    const state = mkState([...EARTH, ...MOON], { settings: { space_age_moon_gated_tier_enabled: false } });
    expect(declareDropAssault(state, 'p1', 'euro_spaceport').error).toMatch(/not enabled/);
  });
});

describe('landing', () => {
  it('does not land on the turn it was declared', () => {
    // The defender gets a full round to reinforce; landing early would take
    // that away and make the marker pointless.
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    expect(resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerWins() })).toEqual([]);
    expect(state.drop_assaults).toHaveLength(1);
  });

  it('takes the tile and garrisons it with every survivor', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    const [res] = resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerWins() });

    expect(res.status).toBe('landed');
    expect(res.captured).toBe(true);
    expect(state.territories.euro_spaceport.owner_id).toBe('p1');
    // Three fell, none died to a defender rolling ones: three hold the ground.
    // The ordinary capture rule moves in at most three and leaves the rest at
    // home — there is no home here, so leaving any behind would delete them.
    expect(state.territories.euro_spaceport.unit_count).toBe(3);
  });

  it('loses every survivor when the assault fails', () => {
    const state = mkState([...EARTH, ...MOON, { id: 'euro_fortress', owner: 'p2', units: 8 }]);
    declareDropAssault(state, 'p1', 'euro_fortress');
    declaredLastTurn(state);
    const [res] = resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerLoses() });

    expect(res.status).toBe('landed');
    expect(res.captured).toBe(false);
    expect(state.territories.euro_fortress.owner_id).toBe('p2');
    // A failed drop is a real loss: nothing retreats, because there is nowhere
    // to retreat to.
    expect(state.players[0].territory_count).toBe(4); // launch base + three Moon tiles
  });

  it('never leaves the falling stack on the board', () => {
    // The transient origin is the one thing in this feature that could leak
    // into persisted state or a client broadcast. It must be gone either way.
    for (const dice of [attackerWins, attackerLoses]) {
      const state = mkState([...EARTH, ...MOON]);
      declareDropAssault(state, 'p1', 'euro_spaceport');
      declaredLastTurn(state);
      resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: dice() });
      const leaked = Object.keys(state.territories).filter((id) => id.startsWith('__'));
      expect(leaked, `leaked ${leaked.join(',')}`).toEqual([]);
      expect(state.players[0].territory_count).toBe(
        Object.values(state.territories).filter((t) => t.owner_id === 'p1').length,
      );
    }
  });

  it('clears the marker whether it landed or not', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerLoses() });
    expect(state.drop_assaults).toHaveLength(0);
  });

  it('cancels — without a refund — when the foothold is gone', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    // Thrown off the Moon while the drop was in flight.
    state.territories.moon_polar_north.owner_id = 'p2';
    const [res] = resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerWins() });

    expect(res.status).toBe('cancelled');
    expect(res.cancelReason).toMatch(/lunar foothold/);
    expect(state.territories.euro_spaceport.owner_id).toBe('p2');
    expect(state.players[0].helium3).toBe(20 - DROP_ASSAULT_HELIUM3_COST);
  });

  it('cancels when the target was taken by other means in the meantime', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    state.territories.euro_spaceport.owner_id = 'p1';
    const [res] = resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerWins() });
    expect(res.status).toBe('cancelled');
    expect(res.cancelReason).toMatch(/already hold/);
  });

  it('eliminates a defender whose last territory it takes', () => {
    const state = mkState([
      { id: 'na_launch_base', owner: 'p1', units: 5 },
      { id: 'euro_spaceport', owner: 'p2', units: 2 },
      ...MOON,
    ]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    const [res] = resolveDropAssaultsFor(state, MAP, 'p1', { dieRoll: attackerWins() });

    expect(res.outcome?.defenderEliminated).toBe(true);
    expect(state.players[1].is_eliminated).toBe(true);
  });

  it('draws the attacker a card through the same hook an ordinary capture uses', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    const captures: string[] = [];
    resolveDropAssaultsFor(state, MAP, 'p1', {
      dieRoll: attackerWins(),
      onCapture: (_s, _pid, toId) => captures.push(toId),
    });
    expect(captures).toEqual(['euro_spaceport']);
  });

  it('leaves another player\'s drop alone', () => {
    const state = mkState([...EARTH, ...MOON], { helium3: 40 });
    declareDropAssault(state, 'p1', 'euro_spaceport');
    declaredLastTurn(state);
    expect(resolveDropAssaultsFor(state, MAP, 'p2', {})).toEqual([]);
    expect(state.drop_assaults).toHaveLength(1);
  });
});

describe('an eliminated player\'s drop', () => {
  it('is dropped with them, rather than landing on their killer', () => {
    const state = mkState([...EARTH, ...MOON]);
    declareDropAssault(state, 'p1', 'euro_spaceport');
    clearDropAssaultsFor(state, 'p1');
    expect(state.drop_assaults).toHaveLength(0);
  });
});
