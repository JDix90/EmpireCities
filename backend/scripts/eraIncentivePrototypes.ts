/**
 * Era-advancement INCENTIVE PROTOTYPES — simulation only (EA-503).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IN THIS FILE IS ENGINE BEHAVIOUR. These are cheap models of rules
 * that do not exist yet, driven by `SIM_RULES` in scripts/simEraBalance.ts, so
 * a proposed rule can be measured BEFORE it is built. As each rule ships for
 * real, delete its prototype here and let the sim drive the shipped setting
 * instead — a prototype that outlives its feature will quietly disagree with
 * the engine and every sweep after that is fiction.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Why these rules exist at all: measured with `SIM_P0_POLICY`, a player who
 * NEVER advances beats one who always advances by ~10 points in 4p. Advancing
 * is a net negative in the shipped ruleset — it costs 30% of your army and
 * opens neutral frontier land that mostly benefits your penned-in rivals. See
 * eraBalanceTuning.md § "The stall problem" for the full table.
 *
 * ADOPTED (measured to flip the sign, recommended for implementation):
 *   gate        Era-gated frontier. A neutral frontier territory tagged
 *               `unlock_era_index = k` can only be attacked by a player whose
 *               own era index is >= k. The land the advance reveals belongs to
 *               the era that revealed it. (Precedent in shipped code: the Moon
 *               ladder in state/moonAccess.ts, and the `pathfinder_gate` era
 *               signature, which seals lanes to unreached worlds for its owner.)
 *   expedition  On advancing, settle one adjacent frontier of the arriving era
 *               for free — 3 armies walk over from the neighbouring stack. No
 *               dice. The visible, thematic payoff for the advance.
 *   renaissance On advancing, one free tier-1 technology of the arriving era,
 *               softening the `unlocked_techs = []` wipe. Largest single mover
 *               of the three, because a free tier-1 shortens the NEXT gate too.
 *
 * VARIANT (plumbed, off by default, kept as the de-escalation dial):
 *   grace       Makes `gate` temporary: a frontier opens to everyone
 *               `graceRounds` turns after it appears. Ship this if strict
 *               gating proves too strong against human opponents, who — unlike
 *               these bots — will actively race for an exclusive frontier.
 *
 * MEASURED AND REJECTED (kept so the rejection stays reproducible — delete
 * along with the rest of this file):
 *   garrison    Scale frontier garrisons to the board's mean owned stack
 *               instead of the flat 2+era. Erases most of the gain: it makes
 *               the advancer's own private frontier expensive to take.
 *   hegemony    Era-scaled victory — hold `pct` of the board for `turns`
 *               rounds at era >= `minEra`. Decided 60–75% of games and cut
 *               length from ~50 to ~32 turns while leaving the advancing seat
 *               at ~22–24% either way: it rewards whoever already holds the
 *               most land, which is the staller.
 */
import type { GameMap, GameState } from '../src/types';
import { territoryUnlockEra } from '../src/game-engine/eraAdvancement/territoryUnlock';
import { resolvePlayerEraId } from '../src/game-engine/eraAdvancement/constants';
import { getEraTechTree } from '../src/game-engine/eras';
import { applyResearch } from '../src/game-engine/state/techManager';

export const INCENTIVE_RULES = [
  'gate',
  'grace',
  'expedition',
  'renaissance',
  'garrison',
  'hegemony',
] as const;
export type IncentiveRule = (typeof INCENTIVE_RULES)[number];

export interface IncentiveOptions {
  /** Turns after a frontier appears before `grace` opens it to everyone. */
  graceRounds: number;
  /** Upper bound on a `garrison`-scaled frontier stack. */
  garrisonCap: number;
  /** Share of live territories a `hegemony` claim needs. */
  hegemonyPct: number;
  /** Consecutive rounds the share must hold. */
  hegemonyTurns: number;
  /** Minimum era index for a `hegemony` claim. */
  hegemonyMinEra: number;
  /** Armies an `expedition` walks onto the settled frontier. */
  expeditionUnits: number;
}

export const DEFAULT_INCENTIVE_OPTIONS: IncentiveOptions = {
  graceRounds: 2,
  garrisonCap: 12,
  hegemonyPct: 0.55,
  hegemonyTurns: 3,
  hegemonyMinEra: 1,
  expeditionUnits: 3,
};

/** Parse `SIM_RULES=gate,expedition,renaissance`. Throws on an unknown name. */
export function parseIncentiveRules(raw: string | undefined): Set<IncentiveRule> {
  const names = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!(INCENTIVE_RULES as readonly string[]).includes(n)) {
      throw new Error(`Unknown SIM_RULES entry "${n}" — expected one of ${INCENTIVE_RULES.join(', ')}`);
    }
  }
  return new Set(names as IncentiveRule[]);
}

function adjacency(map: GameMap): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const c of map.connections) {
    (adj[c.from] ??= []).push(c.to);
    (adj[c.to] ??= []).push(c.from);
  }
  return adj;
}

/**
 * One game's worth of prototype state. Construct per game — `unlockedOn` and
 * the hegemony streaks must not leak between games in a sweep.
 */
export class IncentiveModel {
  private readonly rules: Set<IncentiveRule>;
  private readonly opts: IncentiveOptions;
  private readonly adj: Record<string, string[]>;
  private readonly unlockEra: Map<string, number>;
  /** turn_number a frontier territory entered play, for `grace`. */
  private readonly unlockedOn = new Map<string, number>();
  private readonly hegemonyStreak = new Map<string, number>();

  constructor(map: GameMap, rules: Set<IncentiveRule>, opts: IncentiveOptions = DEFAULT_INCENTIVE_OPTIONS) {
    this.rules = rules;
    this.opts = opts;
    this.adj = adjacency(map);
    this.unlockEra = new Map(map.territories.map((t) => [t.territory_id, territoryUnlockEra(t)]));
  }

  get active(): boolean {
    return this.rules.size > 0;
  }

  has(rule: IncentiveRule): boolean {
    return this.rules.has(rule);
  }

  /**
   * Called with whatever `unlockTerritoriesForFloor` just added, mirroring the
   * point where gameSocket's `applyEraBoardChange` emits `game:territories_unlocked`.
   */
  noteUnlocked(state: GameState, added: string[]): void {
    if (added.length === 0) return;
    for (const id of added) this.unlockedOn.set(id, state.turn_number);
    if (!this.rules.has('garrison')) return;
    const owned = Object.values(state.territories).filter((t) => t.owner_id);
    if (owned.length === 0) return;
    const mean = owned.reduce((sum, t) => sum + t.unit_count, 0) / owned.length;
    for (const id of added) {
      const t = state.territories[id];
      if (t) t.unit_count = Math.min(this.opts.garrisonCap, Math.max(t.unit_count, Math.round(mean)));
    }
  }

  /**
   * `gate`: may `pid` attack `territoryId`? Owned land is never gated — this
   * only ever holds back a NEUTRAL frontier from a player who has not reached
   * the era that revealed it.
   */
  frontierOpenTo(state: GameState, pid: string, territoryId: string): boolean {
    if (!this.rules.has('gate')) return true;
    const target = state.territories[territoryId];
    if (!target || target.owner_id) return true;
    const need = this.unlockEra.get(territoryId) ?? 0;
    if (need <= 0) return true;
    const player = state.players.find((p) => p.player_id === pid);
    if ((player?.current_era_index ?? 0) >= need) return true;
    if (this.rules.has('grace')) {
      const opened = this.unlockedOn.get(territoryId);
      if (opened != null && state.turn_number - opened >= this.opts.graceRounds) return true;
    }
    return false;
  }

  /** `expedition` + `renaissance`, applied immediately after a successful advance. */
  onAdvance(state: GameState, pid: string): void {
    if (this.rules.has('expedition')) this.expedition(state, pid);
    if (this.rules.has('renaissance')) this.renaissance(state, pid);
  }

  /**
   * Settle one frontier of the era just entered, from the strongest adjacent
   * stack. Only frontiers of THIS era qualify — an expedition is the reward for
   * the advance that revealed the land, not a claim on everything still neutral.
   */
  private expedition(state: GameState, pid: string): void {
    const player = state.players.find((p) => p.player_id === pid);
    if (!player) return;
    const era = player.current_era_index ?? 0;
    let best: { from: string; to: string } | null = null;
    let bestStack = -1;
    for (const t of Object.values(state.territories)) {
      if (t.owner_id !== pid) continue;
      for (const neighbourId of this.adj[t.territory_id] ?? []) {
        const neighbour = state.territories[neighbourId];
        if (!neighbour || neighbour.owner_id) continue;
        if ((this.unlockEra.get(neighbourId) ?? 0) !== era) continue;
        if (t.unit_count > bestStack) {
          bestStack = t.unit_count;
          best = { from: t.territory_id, to: neighbourId };
        }
      }
    }
    if (!best) return;
    const from = state.territories[best.from];
    const settlers = Math.min(this.opts.expeditionUnits, from.unit_count - 1);
    if (settlers < 1) return;
    from.unit_count -= settlers;
    const to = state.territories[best.to];
    to.owner_id = pid;
    to.unit_count = settlers;
    player.territory_count += 1;
  }

  /**
   * One free tier-1 tech of the arriving era.
   *
   * Approximation: the prototype grants the CHEAPEST unresearched tier-1 and
   * refunds the points, because bots do not choose. The implementation sketch
   * is a 100%-off `pending_tech_discount` the player spends on the node they
   * want, which can land on a pricier node — so treat the measured effect as
   * indicative, not exact.
   */
  private renaissance(state: GameState, pid: string): void {
    const player = state.players.find((p) => p.player_id === pid);
    if (!player) return;
    const tree = getEraTechTree(resolvePlayerEraId(state, player));
    const held = new Set(player.unlocked_techs ?? []);
    const pick = tree
      .filter((n) => n.tier === 1 && !held.has(n.tech_id))
      .sort((a, b) => a.cost - b.cost)[0];
    if (!pick) return;
    const points = player.tech_points ?? 0;
    const discount = player.pending_tech_discount;
    applyResearch(state, pid, pick);
    // Free: restore what applyResearch spent, and any discount it consumed.
    player.tech_points = points;
    player.pending_tech_discount = discount;
  }

  /**
   * `hegemony`: evaluate once per round. Returns the winner's player_id, or null.
   * Rejected — see the header — but kept runnable so the rejection is checkable.
   */
  checkHegemony(state: GameState): string | null {
    if (!this.rules.has('hegemony')) return null;
    const live = Object.keys(state.territories).length;
    if (live === 0) return null;
    for (const p of state.players) {
      if (p.is_eliminated) {
        this.hegemonyStreak.set(p.player_id, 0);
        continue;
      }
      const holds = (p.current_era_index ?? 0) >= this.opts.hegemonyMinEra
        && p.territory_count / live >= this.opts.hegemonyPct;
      const streak = holds ? (this.hegemonyStreak.get(p.player_id) ?? 0) + 1 : 0;
      this.hegemonyStreak.set(p.player_id, streak);
      if (streak >= this.opts.hegemonyTurns) return p.player_id;
    }
    return null;
  }
}
