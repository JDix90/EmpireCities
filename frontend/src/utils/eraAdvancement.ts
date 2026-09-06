import type { GameState, PlayerState } from '../store/gameStore';

/**
 * Era advancement display helpers. All gate math (cost, tech tiers, stability)
 * is server-authoritative: the backend attaches a viewer-scoped
 * `era_advancement_preview` to every `game:state` payload and broadcasts the
 * spine snapshot as `era_spine`. This module only reshapes that data for the
 * UI — it deliberately contains no mirrored rules or tech-tier tables.
 */

export type EraAdvancementTechGateMode = 'milestone' | 'percent';

/** Era id at `index` along the match's spine snapshot, clamped to the final step. */
export function getEraIdForAdvancementIndex(gameState: GameState, index: number): string {
  const steps = gameState.era_spine ?? [];
  if (steps.length === 0) return gameState.era;
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  return steps[clamped].era_id;
}

/** Which era's tech tree / rules apply to this player right now. */
export function resolvePlayerTechEraId(
  gameState: GameState,
  player: PlayerState | null | undefined,
): string {
  if (!gameState.settings.era_advancement_enabled || !player) return gameState.era;
  return getEraIdForAdvancementIndex(gameState, player.current_era_index ?? 0);
}

export interface AdvanceEraClientStatus {
  enabled: boolean;
  atMaxEra: boolean;
  canPhase: boolean;
  cost: number;
  gold: number;
  gateMode: EraAdvancementTechGateMode;
  techUnlocked: number;
  techRequired: number;
  techMet: boolean;
  tier1Met: boolean;
  tier1Current: number;
  tier1Required: number;
  tier2Met: boolean;
  tier2Current: number;
  tier2Required: number;
  /** tier-3 fields are only meaningful when tier3Required > 0 (later spine steps). */
  tier3Met: boolean;
  tier3Current: number;
  tier3Required: number;
  buildingsMet: boolean;
  buildingsCurrent: number;
  buildingsRequired: number;
  stability?: number;
  stabilityGate?: number;
  stabilityMet: boolean;
  goldMet: boolean;
  blockers: string[];
  ready: boolean;
  currentEraId: string;
  nextEraId: string;
  /** Eras behind the leader (0 = leading/tied). */
  catchupGap: number;
  /** Percentage off the advance cost while catching up (0 when not behind). */
  catchupDiscountPct: number;
  /** Signature payoff name/description granted on arriving in the next era. */
  nextSignatureName?: string;
  nextSignatureDescription?: string;
}

/**
 * Reshape the server's era advancement preview into the panel/banner status.
 * Only phase and turn awareness are layered in client-side; every gate value
 * comes from the server. Returns null when the mode is off or no preview has
 * arrived yet (e.g. mid-deploy against an older server).
 */
export function getAdvanceEraClientStatus(
  gameState: GameState,
  player: PlayerState | null | undefined,
): AdvanceEraClientStatus | null {
  if (!gameState.settings.era_advancement_enabled || !player) return null;
  const preview = gameState.era_advancement_preview;
  if (!preview) return null;

  const atMaxEra = preview.current_era_index >= preview.max_era_index;
  // Mirrors the server's rule (gameSocket `game:advance_era`): advancing is
  // allowed either side of combat, never during it.
  const canPhase = gameState.phase === 'draft' || gameState.phase === 'fortify';
  const cost = preview.cost;
  const gold = player.special_resource ?? 0;
  const gateMode = preview.gate_mode;
  const readiness = preview.readiness;

  const tier1Current = readiness?.tier1?.current ?? 0;
  const tier1Required = readiness?.tier1?.required ?? 0;
  const tier2Current = readiness?.tier2?.current ?? 0;
  const tier2Required = readiness?.tier2?.required ?? 0;
  const tier3Current = readiness?.tier3?.current ?? 0;
  const tier3Required = readiness?.tier3?.required ?? 0;
  const buildingsCurrent = readiness?.buildings?.current ?? 0;
  const buildingsRequired = readiness?.buildings?.required ?? 0;
  const techUnlocked = readiness?.percent?.unlocked ?? 0;
  const techRequired = readiness?.percent?.required ?? 0;

  const tier1Met = readiness?.tier1?.met ?? true;
  const tier2Met = readiness?.tier2?.met ?? true;
  const tier3Met = readiness?.tier3?.met ?? true;
  const buildingsMet = readiness?.buildings?.met ?? true;
  const techMet = readiness?.met ?? true;

  const stability = preview.stability;
  const stabilityGate = preview.stability_gate;
  const stabilityMet = stabilityGate == null || (stability ?? 0) >= stabilityGate;
  const goldMet = gold >= cost && cost > 0;

  const blockers: string[] = [];
  if (atMaxEra) blockers.push('Already at maximum era');
  if (!canPhase) blockers.push('Available during Reinforcement or Fortify phase');
  if (readiness && !readiness.met) {
    if (gateMode === 'percent') {
      blockers.push(`Research ${techRequired} technologies (${techUnlocked}/${techRequired})`);
    } else {
      if (!tier1Met) {
        blockers.push(`Research ${tier1Required} tier-1 technologies (${tier1Current}/${tier1Required})`);
      }
      if (!tier2Met) {
        blockers.push(`Research at least ${tier2Required} tier-2 technolog${tier2Required === 1 ? 'y' : 'ies'} (${tier2Current}/${tier2Required})`);
      }
      if (tier3Required > 0 && !tier3Met) {
        blockers.push(`Research at least ${tier3Required} tier-3 technolog${tier3Required === 1 ? 'y' : 'ies'} (${tier3Current}/${tier3Required})`);
      }
      if (!buildingsMet) {
        blockers.push(`Build at least ${buildingsRequired} building${buildingsRequired === 1 ? '' : 's'} (${buildingsCurrent}/${buildingsRequired})`);
      }
    }
  }
  if (!stabilityMet && stabilityGate != null) {
    blockers.push(`Empire stability ${Math.round(stability ?? 0)}% (need ${stabilityGate}%)`);
  }
  if (cost <= 0) blockers.push('Wait for production income on your next turn');
  else if (!goldMet) blockers.push(`Need ${cost} gold (have ${gold})`);

  return {
    enabled: true,
    atMaxEra,
    canPhase,
    cost,
    gold,
    gateMode,
    techUnlocked,
    techRequired,
    techMet,
    tier1Met,
    tier1Current,
    tier1Required,
    tier2Met,
    tier2Current,
    tier2Required,
    tier3Met,
    tier3Current,
    tier3Required,
    buildingsMet,
    buildingsCurrent,
    buildingsRequired,
    stability,
    stabilityGate,
    stabilityMet,
    goldMet,
    blockers,
    // cost > 0 mirrors the legacy client rule: a free advance (no income yet)
    // stays locked even though the server's gold gate trivially passes.
    ready: canPhase && cost > 0 && preview.can_advance,
    currentEraId: preview.current_era_id,
    nextEraId: preview.next_era_id,
    catchupGap: preview.catchup_gap ?? 0,
    catchupDiscountPct: preview.catchup_discount_pct ?? 0,
    nextSignatureName: preview.next_signature?.name,
    nextSignatureDescription: preview.next_signature?.description,
  };
}

export interface EraGateRow {
  key: string;
  /** Is this requirement satisfied? */
  ok: boolean;
  /** Compact form for the tech-tree rail's chip row. */
  chip: string;
  /** Sentence form for the sidebar panel's list. */
  label: string;
}

/**
 * Every advancement requirement worth showing, in one place.
 *
 * Both surfaces — the tech-tree gate rail and the sidebar panel — used to
 * hand-roll their own row lists while summarising progress as
 * `blockers.length`. The two drifted: `blockers` counts the phase requirement
 * and neither surface drew it, so opening the tree outside Reinforcement or
 * Attack showed every chip green above the words "1 to go" with nothing
 * naming the one thing left. Deriving both the rows and the count from this
 * list means the number can never exceed what the player can see.
 *
 * The phase row appears only while it blocks; a satisfied one would be noise
 * on the surface players actually read (the gold and tech rows are the ones
 * they plan against). Callers handle `atMaxEra` before reaching here.
 */
export function listEraGateRows(
  gameState: GameState,
  status: AdvanceEraClientStatus,
): EraGateRow[] {
  const rows: EraGateRow[] = [];
  const techTrees = gameState.settings.tech_trees_enabled;

  if (techTrees && status.gateMode === 'percent') {
    rows.push({
      key: 'tech',
      ok: status.techMet,
      chip: `Tech ${status.techUnlocked}/${status.techRequired}`,
      label: `Technologies researched: ${status.techUnlocked}/${status.techRequired}`,
    });
  }

  if (techTrees && status.gateMode === 'milestone') {
    // A requirement of 0 is not a requirement: "T2 0/0" reads as something
    // still to do, and counting it would inflate the summary invisibly.
    const tiers: Array<[string, boolean, number, number, number]> = [
      ['tier1', status.tier1Met, status.tier1Current, status.tier1Required, 1],
      ['tier2', status.tier2Met, status.tier2Current, status.tier2Required, 2],
      ['tier3', status.tier3Met, status.tier3Current, status.tier3Required, 3],
    ];
    for (const [key, met, current, required, tier] of tiers) {
      if (required > 0) {
        rows.push({
          key,
          ok: met,
          chip: `T${tier} ${current}/${required}`,
          label: `Tier-${tier} technologies: ${current}/${required}`,
        });
      }
    }
    if (status.buildingsRequired > 0) {
      rows.push({
        key: 'buildings',
        ok: status.buildingsMet,
        chip: `Bldg ${status.buildingsCurrent}/${status.buildingsRequired}`,
        label: `Buildings built: ${status.buildingsCurrent}/${status.buildingsRequired}`,
      });
    }
  }

  if (status.stabilityGate != null) {
    rows.push({
      key: 'stability',
      ok: status.stabilityMet,
      chip: `Stab ${Math.round(status.stability ?? 0)}/${status.stabilityGate}%`,
      label: `Empire stability: ${Math.round(status.stability ?? 0)}% (need ${status.stabilityGate}%)`,
    });
  }

  rows.push({
    key: 'gold',
    ok: status.goldMet,
    chip: status.cost > 0 ? `Gold ${status.gold}/${status.cost}` : 'Gold pending',
    label: status.cost > 0
      ? `Gold: ${status.gold} / ${status.cost} required`
      : 'Production income: pending (starts after your first economy tick)',
  });

  if (!status.canPhase) {
    rows.push({
      key: 'phase',
      ok: false,
      chip: 'Reinforce/Fortify phase',
      label: 'Advance during your Reinforcement or Fortify phase — not mid-attack',
    });
  }

  return rows;
}

/** How many requirements are still unmet — always equal to the rows shown. */
export function countEraGateBlockers(gameState: GameState, status: AdvanceEraClientStatus): number {
  return listEraGateRows(gameState, status).filter((r) => !r.ok).length;
}
