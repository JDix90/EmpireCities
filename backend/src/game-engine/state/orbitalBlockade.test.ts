import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  GALAXY_LANE_SEAL_DURATION,
  SPACE_AGE_LANE_SEAL_DURATION,
  SPACE_AGE_LANE_SEAL_HELIUM3_COST,
  canSealLane,
  isLaneSealedForPlayer,
  laneSealDuration,
  laneSealHelium3Cost,
  orbitLaneId,
  tickLaneBlockades,
} from './moonAccess';

/**
 * The Orbital Blockade (Space Age Moon Race, Phase 4).
 *
 * One rule carries the whole phase: a Launch Pad's own lane can never be
 * sealed. The anchors are the convenient route and may be denied; the pad is
 * the contest route and stays open — otherwise a Hegemon could seal the very
 * route a rival built to come and break their clock, and Phase 3's contest rule
 * would be undone.
 */

const ANCHOR_EARTH = 'euro_spaceport';
const ANCHOR_MOON = 'moon_mare_imbrium';
const PAD_EARTH = 'na_launch_base';
const PAD_MOON = 'moon_polar_north';

const MAP = {
  territories: [],
  regions: [],
  connections: [
    { from: ANCHOR_EARTH, to: ANCHOR_MOON, type: 'orbit' },
    // A lane a Launch Pad opened — same type, different provenance.
    { from: PAD_EARTH, to: PAD_MOON, type: 'orbit', source: 'launch_pad' },
    { from: ANCHOR_EARTH, to: PAD_EARTH, type: 'land' },
  ],
} as unknown as GameMap;

function mkState(over: {
  era?: string;
  enabled?: boolean;
  helium3?: number;
  owners?: Record<string, string | null>;
} = {}): GameState {
  const owners = {
    [ANCHOR_EARTH]: 'p1', [ANCHOR_MOON]: 'p1',
    [PAD_EARTH]: 'p2', [PAD_MOON]: 'p2',
    ...over.owners,
  };
  return {
    era: over.era ?? 'space_age',
    phase: 'attack',
    turn_number: 10,
    current_player_index: 0,
    settings: { lanes_contestable_enabled: over.enabled !== false },
    territories: Object.fromEntries(
      Object.entries(owners).map(([id, owner]) => [id, {
        territory_id: id, owner_id: owner, unit_count: 3, unit_type: 'infantry', buildings: [],
      }]),
    ),
    players: [
      { player_id: 'p1', helium3: over.helium3 ?? 10 },
      { player_id: 'p2', helium3: 10 },
    ] as unknown as PlayerState[],
    lane_blockades: {},
  } as unknown as GameState;
}

describe('what the Space Age lets you seal', () => {
  it('seals an authored anchor lane for the player holding an end', () => {
    const state = mkState();
    expect(canSealLane(state, MAP, ANCHOR_EARTH, ANCHOR_MOON, 'p1').ok).toBe(true);
  });

  it('NEVER seals a Launch Pad lane', () => {
    // The rule the phase rests on. Without it a Hegemon seals the route their
    // rival built to come and break the clock, and contesting an occupied Moon
    // becomes unbounded again.
    const state = mkState();
    const res = canSealLane(state, MAP, PAD_EARTH, PAD_MOON, 'p2');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Launch Pad lanes cannot be blockaded/);
  });

  it('still lets the Galaxy seal any orbit lane it holds', () => {
    // The exclusion is Space Age only; the Galactic Age has no Launch Pads and
    // its own tuning. What it DOES have is a different key: sealing there is the
    // Void Custodians' Emergency Seal (or the Vault holder's), not a purchase
    // open to whoever holds an end — so the galaxy call carries an ability id.
    const state = mkState({ era: 'galaxy_age' });
    const viaVault = canSealLane(state, MAP, PAD_EARTH, PAD_MOON, 'p2', undefined, { vaultHolder: true });
    expect(viaVault.ok).toBe(true);
  });

  it('refuses a lane you hold neither end of', () => {
    const state = mkState();
    expect(canSealLane(state, MAP, ANCHOR_EARTH, ANCHOR_MOON, 'p2').ok).toBe(false);
  });

  it('refuses a land connection outright', () => {
    const state = mkState();
    expect(canSealLane(state, MAP, ANCHOR_EARTH, PAD_EARTH, 'p1').ok).toBe(false);
  });
});

describe('what a Space Age seal costs', () => {
  it('needs the He-3 and says how much is short', () => {
    const broke = mkState({ helium3: SPACE_AGE_LANE_SEAL_HELIUM3_COST - 1 });
    const res = canSealLane(broke, MAP, ANCHOR_EARTH, ANCHOR_MOON, 'p1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/3 Helium-3 \(you have 2\)/);
  });

  it('charges nothing in the Galaxy, which has no lunar economy', () => {
    expect(laneSealHelium3Cost(mkState({ era: 'galaxy_age' }))).toBe(0);
    expect(laneSealHelium3Cost(mkState())).toBe(SPACE_AGE_LANE_SEAL_HELIUM3_COST);
  });

  it('lasts longer here than in the Galaxy, because here you paid for it', () => {
    expect(laneSealDuration(mkState())).toBe(SPACE_AGE_LANE_SEAL_DURATION);
    expect(laneSealDuration(mkState({ era: 'galaxy_age' }))).toBe(GALAXY_LANE_SEAL_DURATION);
    // The order used to run the other way, when the Galaxy's seal was an open
    // rule anyone could use for three rounds. The Emergency Seal replaced it: a
    // free once-per-turn faction charge that buys a round, not a wall. A Space
    // Age blockade costs He-3, so it outlasts it.
    expect(SPACE_AGE_LANE_SEAL_DURATION).toBeGreaterThan(GALAXY_LANE_SEAL_DURATION);
  });
});

describe('a seal outliving its owner', () => {
  const sealed = (over: Parameters<typeof mkState>[0] = {}) => {
    const state = mkState(over);
    state.lane_blockades = {
      [orbitLaneId(ANCHOR_EARTH, ANCHOR_MOON)]: { owner_id: 'p1', turns_remaining: 2 },
    };
    return state;
  };

  it('counts down while its owner still holds an end', () => {
    const state = sealed();
    tickLaneBlockades(state);
    expect(state.lane_blockades![orbitLaneId(ANCHOR_EARTH, ANCHOR_MOON)].turns_remaining).toBe(1);
  });

  it('drops the moment its owner holds neither end', () => {
    // Before this, a seal survived its owner being thrown off both ends — a
    // blockade nobody was mounting. Holding an end is what raising one requires,
    // so it is what keeping one requires.
    const state = sealed({ owners: { [ANCHOR_EARTH]: 'p2', [ANCHOR_MOON]: 'p2' } });
    tickLaneBlockades(state);
    expect(state.lane_blockades![orbitLaneId(ANCHOR_EARTH, ANCHOR_MOON)]).toBeUndefined();
  });

  it('survives losing only ONE end', () => {
    const state = sealed({ owners: { [ANCHOR_EARTH]: 'p2' } });
    tickLaneBlockades(state);
    expect(state.lane_blockades![orbitLaneId(ANCHOR_EARTH, ANCHOR_MOON)]?.turns_remaining).toBe(1);
  });

  it('shuts the lane to everyone but its owner while it stands', () => {
    const state = sealed();
    expect(isLaneSealedForPlayer(state, ANCHOR_EARTH, ANCHOR_MOON, 'p2')).toBe(true);
    expect(isLaneSealedForPlayer(state, ANCHOR_EARTH, ANCHOR_MOON, 'p1')).toBe(false);
  });

  it('expires after its duration', () => {
    const state = sealed();
    tickLaneBlockades(state);
    tickLaneBlockades(state);
    expect(state.lane_blockades![orbitLaneId(ANCHOR_EARTH, ANCHOR_MOON)]).toBeUndefined();
  });
});
