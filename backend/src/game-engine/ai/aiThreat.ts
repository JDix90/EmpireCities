/**
 * How likely each of a bot's territories is to be lost before its next turn
 * (ai_defense_enabled). Planned fortify reads it (ai/aiFortify.ts), and so
 * does the arena, which checks it against the tiles bots actually lose.
 *
 * A rival stack beside a tile threatens it when it could attack it next
 * round: a hostile owner (no ally, no truce partner), two units or more, a
 * fleet for a sea crossing in a naval game, and an orbit lane only when that
 * rival may cross it. Each threat is priced as the attack planner prices the
 * bot's own attacks (ai/aiEdgeOdds.ts edgeOddsOptions, combat/combatOdds.ts
 * captureProbability), so dice caps, buildings, terrain and factions count
 * alike. It reads the board the seat may see: a garrison fog hides counts as
 * HIDDEN_UNITS, as it does when the bot chooses a target.
 *
 * The level's model (ai/aiProfiles.ts `threatModel`) combines them:
 *   adjacent     the strongest single stack, as Expert's draft prices a tile
 *                (ai/aiDraftPlan.ts);
 *   full         every stack, as one minus the chance that each one fails;
 *   full_drafts  as full, with each rival's expected reinforcements next turn
 *                added to its strongest stack beside the tile, shared over the
 *                bot's tiles that rival borders.
 *
 * Defender reactions are left out, as they are when the bot prices its own
 * attacks, which overstates a rival's odds slightly: the safe side for
 * defence.
 */
import type { GameMap, GameState } from '../../types';
import { captureProbability, type CaptureOddsOptions } from '../combat/combatOdds';
import { calculateReinforcements } from '../combat/combatResolver';
import { calculateContinentBonuses } from '../state/gameStateManager';
import { seenUnits } from '../state/fogOfWar';
import { isJumpGateOnlyEdge } from '../state/jumpGates';
import { connectionRequiresMoonAccess, getOrbitAccessResult, isLaneSealedForPlayer } from '../state/moonAccess';
import { isShieldedFrom } from '../state/teams';
import { buildAdjacencyMap, isTruceActive } from './aiBot';
import { edgeOddsOptions } from './aiEdgeOdds';

export type AiThreatModel = 'adjacent' | 'full' | 'full_drafts';

/** A rival stack that could attack one of the bot's tiles next round. */
export interface ThreatStack {
  rivalId: string;
  from: string;
  units: number;
  odds: CaptureOddsOptions;
}

export interface ThreatMap {
  model: AiThreatModel;
  /** The stacks that could attack each of the bot's tiles; a tile with none is absent. */
  stacks: Map<string, ThreatStack[]>;
  /** What each rival's draft adds to its strongest stack beside one of the bot's tiles (full_drafts). */
  draftShare: Map<string, number>;
}

/** The rival stacks that could attack each of `playerId`'s tiles next round, on the board `state` shows. */
export function buildThreatMap(
  state: GameState,
  map: GameMap,
  playerId: string,
  model: AiThreatModel,
): ThreatMap {
  const adjacency = buildAdjacencyMap(map);
  const stacks = new Map<string, ThreatStack[]>();
  const orbitAccess = new Map<string, boolean>();
  const mayCrossOrbit = (rivalId: string): boolean => {
    let allowed = orbitAccess.get(rivalId);
    if (allowed === undefined) {
      const rival = state.players.find((p) => p.player_id === rivalId);
      allowed = !!rival && getOrbitAccessResult(state, rival, map, state.era).allowed;
      orbitAccess.set(rivalId, allowed);
    }
    return allowed;
  };

  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.owner_id !== playerId) continue;
    const against: ThreatStack[] = [];
    for (const nid of adjacency[tid] ?? []) {
      const n = state.territories[nid];
      const rivalId = n?.owner_id;
      if (!n || !rivalId || rivalId === playerId) continue;
      if (isShieldedFrom(state, playerId, rivalId) || isTruceActive(state, playerId, rivalId)) continue;
      const units = seenUnits(n);
      // A single unit cannot attack, but with its owner's draft it may.
      if (units < (model === 'full_drafts' ? 1 : 2)) continue;
      if (isJumpGateOnlyEdge(map, nid, tid)) continue;
      const conn = map.connections.find(
        (c) => (c.from === tid && c.to === nid) || (c.from === nid && c.to === tid),
      );
      if (state.settings.naval_enabled && conn?.type === 'sea' && (n.naval_units ?? 0) <= 0) continue;
      if (connectionRequiresMoonAccess(map, nid, tid) && !mayCrossOrbit(rivalId)) continue;
      if (isLaneSealedForPlayer(state, nid, tid, rivalId)) continue;
      against.push({
        rivalId,
        from: nid,
        units,
        odds: edgeOddsOptions(state, map, rivalId, nid, tid, units, Math.max(1, t.unit_count)),
      });
    }
    if (against.length > 0) stacks.set(tid, against);
  }

  const draftShare = new Map<string, number>();
  if (model === 'full_drafts') {
    const fronts = new Map<string, number>();
    for (const against of stacks.values()) {
      for (const rivalId of new Set(against.map((s) => s.rivalId))) fronts.set(rivalId, (fronts.get(rivalId) ?? 0) + 1);
    }
    for (const [rivalId, tiles] of fronts) {
      const held = Object.values(state.territories).filter((t) => t.owner_id === rivalId).length;
      const draft = calculateReinforcements(held, calculateContinentBonuses(state, map, rivalId));
      draftShare.set(rivalId, draft / tiles);
    }
  }
  return { model, stacks, draftShare };
}

/**
 * How likely a rival stack is to attack a tile it could take: rivals choose
 * among their targets, and fight one another too. Measured in the arena
 * against the tiles bots lose (scripts/simAiArena.ts threat calibration).
 */
export const ATTACK_LIKELIHOOD = 0.6;

/** The chance the tile is lost before the bot's next turn, held by `defenders` units. */
export function lossChance(threats: ThreatMap, territoryId: string, defenders: number): number {
  const against = threats.stacks.get(territoryId);
  if (!against) return 0;
  if (threats.model === 'adjacent') {
    let worst = 0;
    for (const s of against) worst = Math.max(worst, captureProbability(s.units, defenders, s.odds));
    return ATTACK_LIKELIHOOD * worst;
  }
  // Each rival's draft lands on its strongest stack here.
  const boosted = new Map<string, ThreatStack>();
  if (threats.model === 'full_drafts') {
    for (const s of against) {
      const best = boosted.get(s.rivalId);
      if (!best || s.units > best.units) boosted.set(s.rivalId, s);
    }
  }
  let holds = 1;
  for (const s of against) {
    const extra = boosted.get(s.rivalId) === s ? Math.round(threats.draftShare.get(s.rivalId) ?? 0) : 0;
    holds *= 1 - ATTACK_LIKELIHOOD * captureProbability(s.units + extra, defenders, s.odds);
  }
  return 1 - holds;
}
