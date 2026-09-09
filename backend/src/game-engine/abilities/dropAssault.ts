/**
 * Drop Assault — the Space Age Moon Race, Phase 2b.
 *
 * Phase 2a's Orbital Drop reinforces ground you already hold; it cannot take a
 * tile, which is what kept it safe to ship without touching combat. This is the
 * one that takes ground: three units fall on an enemy or neutral Earth
 * territory and fight a normal battle for it.
 *
 * The danger the design named is that landing anywhere on Earth collapses
 * geography — a board where every tile borders every other tile is not a board.
 * Three rules answer that, and all three matter:
 *
 * 1. **It is telegraphed.** The drop is declared on your turn and lands at the
 *    start of your NEXT one, with the target marked for everyone in between.
 *    The defender's counterplay is simply to reinforce the marked tile.
 * 2. **It is rare.** 10 He-3 and a three-turn cooldown, so it is an operation
 *    rather than a tempo move.
 * 3. **It can be taken away.** Three Moon tiles are required at declaration AND
 *    at landing. Lose the foothold in between and the drop is cancelled with no
 *    refund — the Moon is a position, not a credential.
 *
 * Combat itself is NOT reimplemented here. The falling stack is materialised as
 * a transient origin territory and handed to `executeLandAttack`, so dice,
 * modifiers, defender reactions, capture, stability, elimination and the card
 * draw all behave exactly as they do for an ordinary attack. Survivors that did
 * not capture are lost: a failed drop is a real loss, not a retreat.
 *
 * See docs/space-age-moon/README.md §4.2.
 */

import { inferWorldId } from '@borderfall/shared';
import type { DropAssault, GameMap, GameState, TerritoryState } from '../../types';
import { executeLandAttack, type LandAttackOutcome } from '../combat/executeLandAttack';
import { syncTerritoryCounts } from '../state/gameStateManager';
import { countLunarTerritories } from '../state/helium3';
import { areMoonPowersEnabled } from './moonPowers';
import { TERRITORY_ABILITY_DEFS } from './techAbilities';

/** He-3 charged at declaration. Never refunded — a cancelled drop still cost the fuel. */
export const DROP_ASSAULT_HELIUM3_COST = 10;
/**
 * Lunar tiles required at declaration AND at landing. Read back from the
 * ability descriptor so the threshold the UI gates on and the threshold the
 * engine enforces cannot drift apart.
 */
export const DROP_ASSAULT_MOON_TILES = TERRITORY_ABILITY_DEFS.drop_assault?.requiresMoonTiles ?? 3;
/** Units in the falling stack. */
export const DROP_ASSAULT_UNITS = 3;
/** Own-turns between declarations, counted in rounds (`state.turn_number`). */
export const DROP_ASSAULT_COOLDOWN_TURNS = 3;

/**
 * Id of the transient origin the falling stack attacks from. Prefixed so it can
 * never collide with an authored territory, and deleted before this module
 * returns — it exists only for the duration of one `executeLandAttack` call and
 * is never persisted, broadcast, or seen by a client.
 */
const VIRTUAL_ORIGIN_PREFIX = '__drop_assault_origin__';

/** Whether a territory can be dropped on: Earth ground somebody else holds, or nobody. */
export function isDropAssaultTarget(state: GameState, playerId: string, territoryId: string): boolean {
  const t = state.territories[territoryId];
  if (!t) return false;
  if (t.owner_id === playerId) return false;
  // Earth only. The Moon is reached by orbit lanes and contested on the ground;
  // letting the drop skip that would make the lanes decorative.
  return inferWorldId({
    territory_id: t.territory_id,
    region_id: t.region_id ?? '',
    world_id: t.world_id,
    globe_id: t.globe_id,
  }) === 'earth';
}

/** Drops this player has in flight. At most one, but read as a list so the state shape can grow. */
export function pendingDropAssaultsFor(state: GameState, playerId: string): DropAssault[] {
  return (state.drop_assaults ?? []).filter((d) => d.owner_id === playerId);
}

/** Drops in flight aimed at this territory — what the client's marker reads. */
export function dropAssaultsTargeting(state: GameState, territoryId: string): DropAssault[] {
  return (state.drop_assaults ?? []).filter((d) => d.target_id === territoryId);
}

/** Rounds left on this player's cooldown, 0 when they may declare now. */
export function dropAssaultCooldownRemaining(state: GameState, playerId: string): number {
  const last = state.players.find((p) => p.player_id === playerId)?.drop_assault_last_turn;
  if (last == null) return 0;
  return Math.max(0, DROP_ASSAULT_COOLDOWN_TURNS - (state.turn_number - last));
}

/**
 * Why this player cannot declare a drop right now, or null when they can.
 * Target-independent, so the UI can decide whether to offer the button at all.
 */
export function dropAssaultBlockReason(state: GameState, playerId: string): string | null {
  if (!areMoonPowersEnabled(state)) return 'Drop Assault is not enabled in this game';
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 'Player not found';
  const tiles = countLunarTerritories(state, playerId);
  if (tiles < DROP_ASSAULT_MOON_TILES) {
    return `Drop Assault needs ${DROP_ASSAULT_MOON_TILES} Moon territories (you hold ${tiles})`;
  }
  if ((player.helium3 ?? 0) < DROP_ASSAULT_HELIUM3_COST) {
    return `Drop Assault needs ${DROP_ASSAULT_HELIUM3_COST} Helium-3 (you have ${player.helium3 ?? 0})`;
  }
  if (pendingDropAssaultsFor(state, playerId).length > 0) {
    return 'You already have a Drop Assault in flight';
  }
  const cooldown = dropAssaultCooldownRemaining(state, playerId);
  if (cooldown > 0) {
    return `Drop Assault is reloading (${cooldown} turn${cooldown > 1 ? 's' : ''} remaining)`;
  }
  return null;
}

export type { DropAssault };

export interface DeclareDropAssaultResult {
  ok: boolean;
  error?: string;
  assault?: DropAssault;
}

/**
 * Declare a drop. Charges the He-3 now and marks the target for every player;
 * nothing lands until the declarer's next turn begins.
 */
export function declareDropAssault(
  state: GameState,
  playerId: string,
  targetId: string,
): DeclareDropAssaultResult {
  const blocked = dropAssaultBlockReason(state, playerId);
  if (blocked) return { ok: false, error: blocked };
  if (!isDropAssaultTarget(state, playerId, targetId)) {
    return { ok: false, error: 'Drop Assault must target an Earth territory you do not hold' };
  }

  const player = state.players.find((p) => p.player_id === playerId)!;
  player.helium3 = (player.helium3 ?? 0) - DROP_ASSAULT_HELIUM3_COST;
  player.drop_assault_last_turn = state.turn_number;

  const assault: DropAssault = {
    owner_id: playerId,
    target_id: targetId,
    declared_turn: state.turn_number,
    units: DROP_ASSAULT_UNITS,
  };
  state.drop_assaults = [...(state.drop_assaults ?? []), assault];
  return { ok: true, assault };
}

export interface DropAssaultResolution {
  assault: DropAssault;
  /** 'landed' resolved a battle; 'cancelled' never reached the ground. */
  status: 'landed' | 'cancelled';
  /** Why it was cancelled — shown to the declarer, and to nobody else. */
  cancelReason?: string;
  /** The same reason as a tag, for metrics that need to tell the cases apart. */
  cancelCode?: 'lost_foothold' | 'already_held' | 'target_gone' | 'unresolvable';
  outcome?: LandAttackOutcome;
  /** Owner of the target immediately before the battle, for elimination handling. */
  previousOwner?: string | null;
  captured?: boolean;
}

/** Discard the transient origin and put the board back in a consistent state. */
function removeVirtualOrigin(state: GameState, originId: string): void {
  delete state.territories[originId];
  // The origin briefly counted toward the attacker's territory_count inside
  // executeLandAttack's capture branch; re-derive both players' counts from the
  // real board before anything reads them (reinforcements, victory).
  syncTerritoryCounts(state);
}

/**
 * Land every drop this player declared on a previous turn.
 *
 * Called at the start of the declarer's turn, before they act — the defender
 * has had a full round of everyone else's turns to reinforce the marked tile,
 * which is the counterplay the telegraph exists to give them.
 */
export function resolveDropAssaultsFor(
  state: GameState,
  map: GameMap,
  playerId: string,
  opts: {
    dieRoll?: () => number;
    onCapture?: (state: GameState, attackerId: string, toId: string) => void;
  } = {},
): DropAssaultResolution[] {
  const pending = (state.drop_assaults ?? []).filter(
    (d) => d.owner_id === playerId && d.declared_turn < state.turn_number,
  );
  if (pending.length === 0) return [];

  const resolutions: DropAssaultResolution[] = [];
  for (const assault of pending) {
    state.drop_assaults = (state.drop_assaults ?? []).filter((d) => d !== assault);

    // The foothold is re-checked at landing, not just at declaration: a player
    // thrown off the Moon in the round the drop was in flight loses it, and the
    // He-3 with it.
    if (countLunarTerritories(state, playerId) < DROP_ASSAULT_MOON_TILES) {
      resolutions.push({
        assault, status: 'cancelled', cancelCode: 'lost_foothold',
        cancelReason: 'You lost your lunar foothold before the drop landed',
      });
      continue;
    }
    const target = state.territories[assault.target_id];
    if (!target) {
      resolutions.push({
        assault, status: 'cancelled', cancelCode: 'target_gone',
        cancelReason: 'The target no longer exists',
      });
      continue;
    }
    if (target.owner_id === playerId) {
      resolutions.push({
        assault, status: 'cancelled', cancelCode: 'already_held',
        cancelReason: 'You already hold the target',
      });
      continue;
    }

    const originId = `${VIRTUAL_ORIGIN_PREFIX}${playerId}`;
    const origin: TerritoryState = {
      territory_id: originId,
      owner_id: playerId,
      unit_count: assault.units,
      unit_type: target.unit_type,
      buildings: [],
    };
    state.territories[originId] = origin;

    const previousOwner = target.owner_id;
    const outcome = executeLandAttack(state, playerId, originId, assault.target_id, {
      dieRoll: opts.dieRoll,
      onCapture: opts.onCapture,
    });

    if (!outcome) {
      // Structurally impossible for the resolver (e.g. a target that lost its
      // last unit to an event). Nothing happened; the fuel is still spent.
      removeVirtualOrigin(state, originId);
      resolutions.push({
        assault, status: 'cancelled', cancelCode: 'unresolvable',
        cancelReason: 'The drop could not resolve against that target',
      });
      continue;
    }

    if (outcome.captured) {
      // Every surviving dropper garrisons what they took. The ordinary capture
      // rule moves in at most three and leaves the rest at home — but there is
      // no home here, and leaving survivors on a territory that is about to
      // stop existing would quietly delete them.
      const survivors = state.territories[originId]?.unit_count ?? 0;
      if (survivors > 0) state.territories[assault.target_id].unit_count += survivors;
    }
    removeVirtualOrigin(state, originId);

    resolutions.push({
      assault, status: 'landed', outcome, previousOwner, captured: outcome.captured,
    });
  }
  return resolutions;
}

/**
 * Drop a player's in-flight drops — used when they are eliminated, so a dead
 * player's assault does not land on their killer's new territory.
 */
export function clearDropAssaultsFor(state: GameState, playerId: string): void {
  if (!state.drop_assaults?.length) return;
  state.drop_assaults = state.drop_assaults.filter((d) => d.owner_id !== playerId);
}
