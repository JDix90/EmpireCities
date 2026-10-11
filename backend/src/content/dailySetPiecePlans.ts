/**
 * Scripted-opponent plans and themes for the v2 daily (docs/DAILY_PUZZLE_V2.md).
 *
 * A set-piece in dailySetPieces.ts says where the fight is and why it is hard.
 * The plan here says what the opponent will DO about it, in the vocabulary of
 * game-engine/daily/puzzle/opponent.ts, and the theme names the idea the day
 * teaches. A set-piece listed here is eligible to be served as a v2 decision
 * puzzle; one that is not stays a v1 day. The library migrates entry by
 * entry, which is the point of keeping this file separate.
 *
 * Conventions, enforced by dailySetPiecePlans.test.ts against the real maps:
 * - every territory a plan names is on the day's board (a role of the
 *   set-piece: anchor, target, support, relief, extra, or the region lists);
 * - marches and assaults run between adjacent territories;
 * - a hold plan may only name the hold board's territories (roles swap: the
 *   AI holds the anchor and the capture day's support; the human keeps the
 *   target and the capture day's relief as a reserve).
 */
import { DAILY_SET_PIECES, type DailySetPiece, type TacticalSetPiece } from './dailySetPieces';
import type { OpponentPlan } from '../game-engine/daily/puzzle/opponent';

export interface SetPiecePlan {
  theme: string;
  plan: OpponentPlan;
  /**
   * The reading's clock in human turns, when it is not the tier's. On the
   * tier's clock a front with a deep human stack has time to recover from
   * any opening, so every first move scores alike and nothing is decided,
   * and a wide board runs out of search budget besides; on a shorter clock
   * the first move matters. Measured per reading with scripts/benchDailyV2.ts.
   */
  clock?: number;
}

export interface SetPiecePlans {
  /** The capture / region / chain day. */
  capture?: SetPiecePlan;
  /** The defended reading of a tactical set-piece (its `hold` variant). */
  hold?: SetPiecePlan;
}

// ── Builders for the common shapes ───────────────────────────────────────────
// Explicit per entry below so a plan reads as authored, but the shapes recur:
// a relief that feeds the objective while the AI holds it and strikes back
// once it falls; a besieger that masses and assaults every turn.

function tactical(id: string): TacticalSetPiece {
  const sp = DAILY_SET_PIECES.find((s) => s.id === id);
  if (!sp || sp.kind !== 'tactical') throw new Error(`no tactical set-piece ${id}`);
  return sp;
}

/** The relief reinforces the objective while the AI holds it and counterattacks when it falls. */
function reliefPlan(sp: TacticalSetPiece, opts: { minOdds?: number; counterFromExtra?: boolean } = {}): OpponentPlan {
  const steps: OpponentPlan['steps'] = [{ kind: 'draft', to: sp.target, when: 'objective_ai' }];
  if (sp.relief) {
    steps.push({ kind: 'march', from: sp.relief, to: sp.target, when: 'objective_ai' });
    steps.push({ kind: 'draft', to: sp.relief, when: 'objective_human' });
    steps.push({ kind: 'assault', from: sp.relief, to: sp.target, min_odds: opts.minOdds ?? 0.4, keep: 1, when: 'objective_human' });
  }
  if (opts.counterFromExtra) {
    for (const extra of sp.extra_ai ?? []) {
      steps.push({ kind: 'assault', from: extra, to: sp.target, min_odds: opts.minOdds ?? 0.4, keep: 1, when: 'objective_human' });
    }
  }
  return { steps };
}

/**
 * The besieger drafts onto its stack and assaults the target every turn, at
 * any odds. Its second stack (the capture day's human reserve, an AI garrison
 * on the hold board) stands where it is: measured on the solver, a siege that
 * also marched that stack in put every hold day at 30–50% under best play,
 * a coin flip; without the march, and with the reserve the v2 reading deals
 * (dailyScheduleV2.ts), the days land at 60–75% with a pre-emptive strike
 * and the timing of the reserve as the decisions.
 */
function siegePlan(sp: TacticalSetPiece, opts: { keep?: number; minOdds?: number } = {}): OpponentPlan {
  return {
    steps: [
      { kind: 'draft', to: sp.anchor },
      { kind: 'assault', from: sp.anchor, to: sp.target, keep: opts.keep ?? 1, min_odds: opts.minOdds ?? 0 },
    ],
  };
}

export const SET_PIECE_PLANS: Readonly<Record<string, SetPiecePlans>> = {
  // ── Tactical captures, and their defended readings ────────────────────────
  crossing_the_rubicon: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('crossing_the_rubicon')), clock: 2 },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('crossing_the_rubicon')) },
  },
  the_border_states: {
    // Tennessee retakes a thin Kentucky at bad odds; Appalachia joins in. On
    // three turns the search outgrew its budget on every date served.
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('the_border_states'), { minOdds: 0.3, counterFromExtra: true }), clock: 2 },
    hold: { theme: 'win on numbers', plan: siegePlan(tactical('the_border_states')) },
  },
  checkpoint: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('checkpoint'), { minOdds: 0.35 }) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('checkpoint')) },
  },
  // the_crowns_reach has no plan yet: with no relief and no counterstroke the
  // Channel is the whole opponent, and the solver finds nothing to decide
  // (the obvious line IS the best line). It needs a second AI stack before it
  // can be a v2 day; until then it is served as v1.
  andean_campaign: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('andean_campaign')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('andean_campaign')) },
  },
  alexanders_prize: {
    // Bactria feeds Persia while it stands and comes back for it once it falls.
    capture: { theme: 'tempo', plan: reliefPlan(tactical('alexanders_prize'), { minOdds: 0.35 }), clock: 2 },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('alexanders_prize')) },
  },
  the_bulge: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('the_bulge')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_bulge'), { keep: 2 }) },
  },
  the_38th_parallel: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('the_38th_parallel'), { minOdds: 0.3 }) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_38th_parallel')) },
  },
  vicksburg: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('vicksburg')), clock: 2 },
    hold: { theme: 'win on numbers', plan: siegePlan(tactical('vicksburg')) },
  },
  the_dacian_wars: {
    // On three turns waiting, striking Dacia and striking Pannonia all scored
    // alike: the legions had a turn to spare whatever they did first.
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('the_dacian_wars'), { minOdds: 0.35 }), clock: 2 },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_dacian_wars')) },
  },
  solferino: {
    capture: { theme: 'tempo', plan: reliefPlan(tactical('solferino')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('solferino')) },
  },
  inabayama: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('inabayama'), { minOdds: 0.3 }) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('inabayama')) },
  },
  the_fulda_gap: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('the_fulda_gap')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_fulda_gap')) },
  },
  barbarossa: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('barbarossa'), { minOdds: 0.35 }) },
    hold: { theme: 'win on numbers', plan: siegePlan(tactical('barbarossa')) },
  },
  the_ottoman_gates: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('the_ottoman_gates')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_ottoman_gates')) },
  },
  the_gates_of_vienna: {
    capture: { theme: 'tempo', plan: reliefPlan(tactical('the_gates_of_vienna')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_gates_of_vienna')) },
  },
  crecy: {
    // The Empire marches to the coast; on three turns the longbowmen could
    // wait it out.
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('crecy')), clock: 2 },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('crecy')) },
  },
  the_road_to_jerusalem: {
    capture: { theme: 'cut the supply line', plan: reliefPlan(tactical('the_road_to_jerusalem')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_road_to_jerusalem')) },
  },
  // The Armada's hold reading refused every date it is served under the
  // siege plan, at either keep and on either clock: it stays v1.
  the_armada: {
    capture: { theme: 'sea crossing', plan: reliefPlan(tactical('the_armada')), clock: 2 },
  },
  the_desert_fox: {
    capture: { theme: 'tempo', plan: reliefPlan(tactical('the_desert_fox')) },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_desert_fox')) },
  },
  savannah: {
    capture: { theme: 'the counterstroke', plan: reliefPlan(tactical('savannah')), clock: 2 },
    hold: { theme: 'win on numbers', plan: siegePlan(tactical('savannah')) },
  },
  the_thousand: {
    capture: { theme: 'tempo', plan: reliefPlan(tactical('the_thousand')), clock: 2 },
    hold: { theme: 'the reserve', plan: siegePlan(tactical('the_thousand')) },
  },

  // ── Regions ───────────────────────────────────────────────────────────────
  // A region's objective is the whole region in the map's order, whose first
  // territory is one the human holds, so each plan names the garrison its
  // conditions mean.
  the_parthian_shot: {
    // Bactria and Arabia garrison Parthia; each strikes back at the human
    // holding next to it once the human moves on the other. Two garrisons on
    // three or four turns outgrew the search budget.
    capture: {
      theme: 'the bridge',
      clock: 2,
      plan: {
        objective: 'bactria',
        steps: [
          { kind: 'draft', to: 'bactria', when: 'objective_ai' },
          { kind: 'draft', to: 'arabia', when: 'objective_human' },
          { kind: 'assault', from: 'bactria', to: 'persia', min_odds: 0.45, keep: 2, when: 'objective_ai' },
          { kind: 'assault', from: 'arabia', to: 'mesopotamia', min_odds: 0.45, keep: 2 },
        ],
      },
    },
  },
  mare_nostrum: {
    // Still outgrows the search budget on every date served, on two turns as
    // on three: five territories and a support, every one of them a sea
    // crossing from the next. Served as v1 until the board is narrower.
    capture: {
      theme: 'sea crossing',
      plan: {
        objective: 'sicilia',
        steps: [
          { kind: 'draft', to: 'sicilia', when: 'objective_ai' },
          { kind: 'draft', to: 'sardinia_corsica', when: 'objective_human' },
          { kind: 'assault', from: 'sicilia', to: 'italia_south', min_odds: 0.5, keep: 2, when: 'objective_ai' },
        ],
      },
    },
  },
  the_eastern_marches: {
    // Kiev feeds itself while it stands and strikes Poland; once it falls,
    // Byzantium masses and strikes Hungary.
    capture: {
      theme: 'tempo',
      clock: 2,
      plan: {
        objective: 'kievan_rus',
        steps: [
          { kind: 'draft', to: 'kievan_rus', when: 'objective_ai' },
          { kind: 'draft', to: 'byzantine', when: 'objective_human' },
          { kind: 'assault', from: 'kievan_rus', to: 'poland_bohemia', min_odds: 0.45, keep: 2, when: 'objective_ai' },
          { kind: 'assault', from: 'byzantine', to: 'hungary', min_odds: 0.45, keep: 2 },
        ],
      },
    },
  },
  // Fortress Europe (operation_sea_lion) and the Kantō have no plan: on two
  // turns or on the tier's, every date they are served outgrew the search
  // budget (five region territories, a support and, for Fortress Europe,
  // Britain). They stay v1 until their boards are narrower.
  bleeding_missouri: {
    // Missouri is the only AI stack, so once it falls nothing can strike
    // back and most dates are a walkover the gate refuses. It needs a second
    // AI stack outside the region (Arkansas borders Missouri and the Plains)
    // before it is a v2 day on most dates.
    capture: {
      theme: 'the counterstroke',
      clock: 2,
      plan: {
        steps: [
          { kind: 'draft', to: 'acw_missouri' },
          { kind: 'assault', from: 'acw_missouri', to: 'acw_plains', min_odds: 0.45, keep: 2 },
        ],
      },
    },
  },

  // ── Chains ────────────────────────────────────────────────────────────────
  the_road_to_greece: {
    // Anatolia feeds Greece while Italia stands, and retakes Greece if it falls thin.
    capture: {
      theme: 'the forced march',
      plan: {
        steps: [
          { kind: 'draft', to: 'italia', when: 'objective_ai' },
          { kind: 'draft', to: 'anatolia', when: 'objective_human' },
          { kind: 'march', from: 'anatolia', to: 'greece', when: 'objective_ai' },
          { kind: 'assault', from: 'anatolia', to: 'greece', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
  to_the_oxus: {
    capture: {
      theme: 'the forced march',
      clock: 2,
      plan: {
        steps: [
          { kind: 'draft', to: 'persia', when: 'objective_ai' },
          { kind: 'draft', to: 'central_steppe', when: 'objective_human' },
          { kind: 'march', from: 'central_steppe', to: 'bactria', when: 'objective_ai' },
          { kind: 'assault', from: 'central_steppe', to: 'bactria', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
  case_yellow: {
    // Morocco feeds Iberia while France stands, and retakes Iberia if it falls thin.
    capture: {
      theme: 'the forced march',
      plan: {
        steps: [
          { kind: 'draft', to: 'france_ww2', when: 'objective_ai' },
          { kind: 'draft', to: 'morocco_ww2', when: 'objective_human' },
          { kind: 'march', from: 'morocco_ww2', to: 'iberia_ww2', when: 'objective_ai' },
          { kind: 'assault', from: 'morocco_ww2', to: 'iberia_ww2', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
  the_northern_expedition: {
    capture: {
      theme: 'the forced march',
      plan: {
        steps: [
          { kind: 'draft', to: 'hunan', when: 'objective_ai' },
          { kind: 'draft', to: 'henan', when: 'objective_human' },
          { kind: 'march', from: 'henan', to: 'hubei', when: 'objective_ai' },
          { kind: 'assault', from: 'henan', to: 'hubei', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
  the_reconquista: {
    capture: {
      theme: 'the forced march',
      clock: 2,
      plan: {
        steps: [
          { kind: 'draft', to: 'toledo', when: 'objective_ai' },
          { kind: 'draft', to: 'galicia_asturias', when: 'objective_human' },
          { kind: 'march', from: 'galicia_asturias', to: 'cordoba', when: 'objective_ai' },
          { kind: 'assault', from: 'galicia_asturias', to: 'cordoba', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
  // atlanta_to_the_sea has no plan: every date it is served outgrew the
  // search budget, on two turns as on the tier's.
  down_the_river: {
    // Two hops on three or four turns outgrew the search budget on every date served.
    capture: {
      theme: 'the forced march',
      clock: 2,
      plan: {
        steps: [
          { kind: 'draft', to: 'acw_kentucky', when: 'objective_ai' },
          { kind: 'draft', to: 'acw_tennessee', when: 'objective_human' },
          { kind: 'march', from: 'acw_appalachia', to: 'acw_kentucky', when: 'objective_ai' },
          { kind: 'assault', from: 'acw_tennessee', to: 'acw_kentucky', min_odds: 0.4, keep: 1, when: 'objective_human' },
          { kind: 'assault', from: 'acw_appalachia', to: 'acw_kentucky', min_odds: 0.4, keep: 1, when: 'objective_human' },
        ],
      },
    },
  },
};

/** The plan for a set-piece as read on a given day, or null when the day stays v1. */
export function planFor(sp: DailySetPiece, hold: boolean): SetPiecePlan | null {
  const entry = SET_PIECE_PLANS[sp.id];
  if (!entry) return null;
  return (hold ? entry.hold : entry.capture) ?? null;
}

/** Set-pieces that can be served as v2 for a verb, in id order. */
export function plannedSetPieces(kind: 'tactical' | 'hold' | 'region' | 'chain'): DailySetPiece[] {
  return DAILY_SET_PIECES
    .filter((sp) => {
      const entry = SET_PIECE_PLANS[sp.id];
      if (!entry) return false;
      if (kind === 'hold') return sp.kind === 'tactical' && !!sp.hold && !!entry.hold;
      return sp.kind === kind && !!entry.capture;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
