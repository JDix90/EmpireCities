import { useEffect, useState, useCallback, useRef } from 'react';
import { CombatResult } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import MatchStatsTab from './MatchStatsTab';
import { AiBadge } from '../ui/AiBadge';
import { Sword, Swords, Shield, ArrowRight, Crown, Skull, Flag, ChevronRight, ChevronLeft, Plus, Trophy, LogOut, Eye, Share2, Check, Flame, Coins, Link2, ExternalLink, Copy, RotateCcw, Film, MessageCircle, FastForward } from 'lucide-react';
import clsx from 'clsx';
import CombatAbilityCallouts from './CombatAbilityCallouts';
import { hapticImpact, ImpactStyle } from '../../utils/haptics';
import { generateShareCard, buildShareText } from '../../utils/shareCard';
import { api } from '../../services/api';
import { APP_NAME } from '../../constants/brand';
import { formatSecretMissionReveal, type MapNameLookup } from '../../utils/mapDisplayNames';
import { getFastCombatPreference } from '../../utils/userPreferences';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReinforcementEntry { territoryName: string; units: number }
export interface FortifyEntry { fromName: string; toName: string; units: number }

export interface CombatModalData {
  type: 'combat';
  result: CombatResult;
  perspective?: 'attacker' | 'defender';
  /** Same attack can be rolled again (not captured, enough attackers left) */
  repeatAttack?: { fromId: string; toId: string };
}

export interface TurnSummaryModalData {
  type: 'turn_summary';
  playerName: string;
  playerColor: string;
  turnNumber: number;
  combats: CombatResult[];
  isOwnTurn?: boolean;
  reinforcements?: ReinforcementEntry[];
  fortifications?: FortifyEntry[];
}

export interface WinProbabilitySnapshot {
  step: number;
  turn: number;
  probabilities: Record<string, number>;
}

export interface GameOverModalData {
  type: 'game_over';
  gameId?: string;
  isWinner: boolean;
  winnerName: string;
  winnerColor: string;
  turnCount: number;
  players: Array<{
    player_id: string;
    username: string;
    color: string;
    territory_count: number;
    peak_territory_count?: number;
    cards_redeemed_count?: number;
    card_set_bonus_units?: number;
    unlocked_techs_count?: number;
    buildings_built_count?: number;
    is_eliminated: boolean;
    is_ai: boolean;
    ai_difficulty?: string | null;
  }>;
  win_probability_history?: WinProbabilitySnapshot[];
  rating_change?: number;
  /** True while the local player's rating is still calibrating (high RD) — early deltas swing widely. */
  rating_provisional?: boolean;
  is_ranked?: boolean;
  achievements_unlocked?: string[];
  /** XP earned by the local player (from server `xp_earned_by_player`). */
  xpEarned?: number;
  /** Which victory condition ended the game. */
  victory_condition?: 'domination' | 'last_standing' | 'threshold' | 'capital' | 'secret_mission' | 'alliance_victory' | 'abandoned' | 'turn_limit' | 'resignation';
  /** Human-readable era name for the share card (e.g., "World War II"). */
  eraName?: string;
  /** All winner player_ids — two entries for alliance_victory. */
  winnerIds?: string[];
  /** Progression data from server (Phase 2). */
  progression?: {
    win_streak: number;
    daily_streak: number;
    daily_streak_milestone: number | null;
    gold_awarded: number;
    gold_multiplier: number;
    level_cosmetic: string | null;
    friend_streak_bonus?: number;
  };
  insights?: Array<{
    turn: number;
    title: string;
    impact: 'high' | 'medium';
    explanation: string;
    alternative: string;
  }>;
  rematchConfig?: {
    era_id: string;
    map_id: string;
    settings: Record<string, unknown>;
    human_player_ids: string[];
  };
  combat_stats?: Record<string, {
    attacks: number;
    attack_wins: number;
    defenses: number;
    defense_wins: number;
    territories_captured: number;
    units_lost?: number;
    units_destroyed?: number;
    sea_attacks?: number;
    eliminations_dealt?: number;
  }>;
  /** Full per-player XP map (for MatchStatsTab table). */
  xp_earned_by_player?: Record<string, number>;
  /** Full per-player MMR delta map (for MatchStatsTab table). */
  rating_deltas?: Record<string, number>;
  /** Wall-clock duration of the game in milliseconds. Null when start time unknown. */
  duration_ms?: number | null;
  /**
   * When the match ends as `abandoned`, we normally hide Watch Replay.
   * True when the local human's last tracked win probability was very low so
   * they can still review mistakes (early resign / quit-as-abandon UX).
   */
  allowReplayDespiteAbandon?: boolean;
  /** Highest AI difficulty present (for header chip). Null if all-human game. */
  ai_difficulty?: 'easy' | 'medium' | 'hard' | 'expert' | 'tutorial' | null;
  /** Snapshot of the human's best/worst single decision (used in Match Stats panel). */
  decision_summary?: {
    total_decisions: number;
    best?: {
      step: number;
      turn: number;
      player_id: string;
      action_type: string;
      summary: string;
      prob_before: number;
      prob_after: number;
      prob_delta: number;
    };
    worst?: {
      step: number;
      turn: number;
      player_id: string;
      action_type: string;
      summary: string;
      prob_before: number;
      prob_after: number;
      prob_delta: number;
    };
    biggest_swing?: {
      step: number;
      turn: number;
      player_id: string;
      action_type: string;
      summary: string;
      prob_before: number;
      prob_after: number;
      prob_delta: number;
    };
  };
}

export interface EliminationModalData {
  type: 'elimination';
  eliminatedName: string;
  eliminatorName: string;
  isSelf: boolean;
  secretMission?: { kind: string; territory_ids?: string[]; target_player_id?: string; region_ids?: string[]; ally_player_id?: string; territory_threshold?: number } | null;
}

export interface ResignModalData {
  type: 'resign_confirm';
}

export interface DraftRatingRow {
  playerId: string;
  playerName: string;
  color: string;
  score: number;
  grade: string;
  territories: number;
  cohesionPct: number;
  regionLeverage: number;
}

export interface DraftSummaryModalData {
  type: 'draft_summary';
  turnNumber: number;
  ratings: DraftRatingRow[];
}

export type ModalData =
  | CombatModalData
  | TurnSummaryModalData
  | GameOverModalData
  | EliminationModalData
  | ResignModalData
  | DraftSummaryModalData;

/**
 * Pivotal modals that "Skip all" must NOT discard — the player needs to see and
 * acknowledge them. Everything else (ordinary combat recaps, turn summaries) is
 * safe to drop when clearing the backlog. Losing your capital is a combat modal
 * but is flagged critical so it always surfaces (matches the lite-mode rule).
 */
export function isCriticalModal(data: ModalData): boolean {
  if (
    data.type === 'game_over' ||
    data.type === 'elimination' ||
    data.type === 'resign_confirm' ||
    data.type === 'draft_summary'
  ) {
    return true;
  }
  if (data.type === 'combat' && data.result.capitalLost) return true;
  return false;
}

export interface NotificationData {
  type: 'reinforce' | 'fortify' | 'phase_change';
  text: string;
  subtext?: string;
  icon: 'shield' | 'arrow' | 'sword';
  accentBg: string;
  accentBorder: string;
  accentText: string;
}

// ─── Animated Die ──────────────────────────────────────────────────────────

function getFastCombat(): boolean {
  return getFastCombatPreference();
}

/**
 * Dice scale down as a side rolls more of them, so stacked bonuses
 * (faction + tech + buildings + events + naval bombardment + era gap) never
 * push the row past the modal edge. Paired with `flex-wrap` on the container,
 * this keeps the dice inside the modal at any count on desktop and mobile.
 * Sized off the larger of the two sides so both columns stay symmetric.
 */
function diceSizing(maxDice: number): { box: string; text: string; gap: string } {
  if (maxDice <= 4) return { box: 'w-14 h-14', text: 'text-2xl', gap: 'gap-2.5' };
  if (maxDice <= 6) return { box: 'w-12 h-12', text: 'text-xl', gap: 'gap-2' };
  if (maxDice <= 8) return { box: 'w-10 h-10', text: 'text-lg', gap: 'gap-1.5' };
  return { box: 'w-9 h-9', text: 'text-base', gap: 'gap-1.5' };
}

function AnimatedDie({ value, index, variant, fast, boxClass = 'w-14 h-14', textClass = 'text-2xl' }: { value: number; index: number; variant: 'attacker' | 'defender'; fast?: boolean; boxClass?: string; textClass?: string }) {
  const [display, setDisplay] = useState(fast ? value : Math.ceil(Math.random() * 6));
  const [settled, setSettled] = useState(!!fast);

  useEffect(() => {
    if (fast) { setDisplay(value); setSettled(true); return; }
    let frame = 0;
    const totalFrames = 8 + index * 4;
    const timer = setInterval(() => {
      if (frame < totalFrames) {
        setDisplay(Math.ceil(Math.random() * 6));
        frame++;
      } else {
        setDisplay(value);
        setSettled(true);
        clearInterval(timer);
      }
    }, 55);
    return () => clearInterval(timer);
  }, [value, index, fast]);

  const isAttacker = variant === 'attacker';
  return (
    <div
      className={clsx(
        boxClass, textClass,
        'rounded-xl flex items-center justify-center font-bold font-mono shrink-0',
        'transition-colors duration-200',
        settled
          ? isAttacker
            ? 'bg-red-500/25 text-red-300 ring-2 ring-red-500/40 animate-dice-settle'
            : 'bg-blue-500/25 text-blue-300 ring-2 ring-blue-500/40 animate-dice-settle'
          : 'bg-white/5 text-white/30'
      )}
    >
      {display}
    </div>
  );
}

// ─── Pip display for die faces (visual embellishment) ──────────────────────

function DieFace({ value, index, variant, fast, boxClass, textClass }: { value: number; index: number; variant: 'attacker' | 'defender'; fast?: boolean; boxClass?: string; textClass?: string }) {
  return <AnimatedDie value={value} index={index} variant={variant} fast={fast} boxClass={boxClass} textClass={textClass} />;
}

// ─── Combat Result View ────────────────────────────────────────────────────

/**
 * Exported for DefenderBattleTheater, which replays incoming attacks live
 * (non-blocking, auto-advancing) during the attacker's turn instead of
 * queueing blocking modals for the defender's turn start.
 */
export function CombatResultView({
  result,
  perspective,
  onDismiss,
  repeatAttack,
  onRepeatAttack,
  autoAdvance = false,
  hurry = false,
  onSkipAll,
  backlogCount = 0,
}: {
  result: CombatResult;
  perspective?: 'attacker' | 'defender';
  onDismiss: () => void;
  repeatAttack?: { fromId: string; toId: string };
  onRepeatAttack?: () => void;
  /** Auto-dismiss after the dice settle plus a short read window (theater mode). */
  autoAdvance?: boolean;
  /** Backlog is deep: shorten the auto-advance dwell so the pile drains faster. */
  hurry?: boolean;
  /** Clear the entire animation backlog in one action (combat modals + theater + globe). */
  onSkipAll?: () => void;
  /** How many items are piled up; gates the "Skip all" button. */
  backlogCount?: number;
}) {
  const [showResult, setShowResult] = useState(false);
  // A deep backlog drains at fast-combat speed even if the player hasn't opted
  // into fast combat globally — keeps incoming-attack piles from dragging.
  const fast = getFastCombat() || hurry;

  useEffect(() => {
    hapticImpact(ImpactStyle.Light);
    const maxDice = Math.max(result.attacker_rolls.length, result.defender_rolls.length);
    const settleTime = fast ? 300 : (8 + (maxDice - 1) * 4) * 55 + 500;
    const timer = setTimeout(() => {
      hapticImpact(ImpactStyle.Medium);
      setShowResult(true);
    }, settleTime);
    return () => clearTimeout(timer);
  }, [result]);

  // Theater mode: linger long enough to read the outcome, then move on. A
  // lost territory earns extra dwell; fast-combat players get a tighter loop.
  useEffect(() => {
    if (!autoAdvance) return;
    const maxDice = Math.max(result.attacker_rolls.length, result.defender_rolls.length);
    const settleTime = fast ? 300 : (8 + (maxDice - 1) * 4) * 55 + 500;
    const linger = (fast ? 1_200 : 2_200) + (result.territory_captured ? 800 : 0);
    const timer = setTimeout(onDismiss, settleTime + linger);
    return () => clearTimeout(timer);
  }, [autoAdvance, result, fast, onDismiss]);

  const diceSize = diceSizing(Math.max(result.attacker_rolls.length, result.defender_rolls.length));

  const isDefending = perspective === 'defender';
  const headerLabel = isDefending ? 'Incoming Attack!' : perspective === 'attacker' ? 'Your Attack' : 'Battle';
  const headerBg = isDefending ? 'bg-orange-500/15 border-orange-500/25' : 'bg-red-500/15 border-red-500/25';
  const headerText = isDefending ? 'text-orange-300' : 'text-red-300';
  const headerIcon = isDefending ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="w-full min-w-0">
      {/* Header */}
      <div className="text-center mb-8">
        <div className={clsx('inline-flex items-center gap-2 px-5 py-2 rounded-full border mb-4', headerBg)}>
          {isDefending ? <Shield className={clsx('w-4 h-4', headerIcon)} /> : <Sword className={clsx('w-4 h-4', headerIcon)} />}
          <span className={clsx('text-sm font-bold tracking-[0.2em] uppercase', headerText)}>{headerLabel}</span>
        </div>
        {result.fromName && result.toName && (
          <p className="text-white/80 text-lg font-medium">
            {result.fromName}
            <span className="text-white/30 mx-3">
              <ArrowRight className="w-4 h-4 inline" />
            </span>
            {result.toName}
          </p>
        )}
      </div>

      {/* Dice Area — dice scale + wrap so stacked-bonus rolls stay inside the modal */}
      <div className="flex gap-4 mb-8">
        {/* Attacker Column */}
        <div className="flex-1 min-w-0">
          <p className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-3 text-center">
            {result.attackerName ?? 'Attacker'}
          </p>
          <div className={clsx('flex flex-wrap justify-center', diceSize.gap)}>
            {result.attacker_rolls.map((roll, i) => (
              <DieFace key={i} value={roll} index={i} variant="attacker" fast={fast} boxClass={diceSize.box} textClass={diceSize.text} />
            ))}
          </div>
        </div>

        {/* VS */}
        <div className="flex items-center pt-6">
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
        </div>

        {/* Defender Column */}
        <div className="flex-1 min-w-0">
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3 text-center">
            {result.defenderName ?? 'Defender'}
          </p>
          <div className={clsx('flex flex-wrap justify-center', diceSize.gap)}>
            {result.defender_rolls.map((roll, i) => (
              <DieFace key={i} value={roll} index={i} variant="defender" fast={fast} boxClass={diceSize.box} textClass={diceSize.text} />
            ))}
          </div>
        </div>
      </div>

      {/* Result Panel — slides in after dice settle */}
      <div className={clsx(
        'transition-all duration-500 ease-out',
        showResult ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
      )}>
        {/* Ability + faction activation feedback */}
        {(result.combat_ability_callouts?.length ?? 0) > 0 && (
          <CombatAbilityCallouts
            callouts={result.combat_ability_callouts!}
            perspective={perspective}
          />
        )}
        {((result.attacker_bonus_breakdown?.faction ?? 0) > 0 || (result.defender_bonus_breakdown?.faction ?? 0) > 0) && (
          <div className="mb-4 space-y-2">
            {(result.attacker_bonus_breakdown?.faction ?? 0) > 0 && (
              <p className={clsx(
                'text-xs px-3 py-2 rounded-lg border animate-pulse',
                perspective === 'attacker'
                  ? 'border-red-400/70 bg-red-500/15 text-red-200'
                  : 'border-red-500/40 bg-red-900/20 text-red-300',
              )}>
                ⚔️ Faction attack bonus activated (+{result.attacker_bonus_breakdown?.faction} die)
              </p>
            )}
            {(result.defender_bonus_breakdown?.faction ?? 0) > 0 && (
              <p className={clsx(
                'text-xs px-3 py-2 rounded-lg border animate-pulse',
                perspective === 'defender'
                  ? 'border-blue-300/70 bg-blue-500/15 text-blue-100'
                  : 'border-blue-500/40 bg-blue-900/20 text-blue-300',
              )}>
                🛡️ Faction defense bonus activated (+{result.defender_bonus_breakdown?.faction} die)
              </p>
            )}
          </div>
        )}
        {(result.defender_bonus_breakdown?.naval_bombardment ?? 0) > 0 && (
          <div className="mb-4">
            <p className={clsx(
              'text-xs px-3 py-2 rounded-lg border',
              perspective === 'defender'
                ? 'border-cyan-300/70 bg-cyan-500/15 text-cyan-100'
                : 'border-cyan-500/40 bg-cyan-900/20 text-cyan-300',
            )}>
              🌊 Enemy fleet bombarded the landing (+{result.defender_bonus_breakdown?.naval_bombardment} defense {result.defender_bonus_breakdown!.naval_bombardment === 1 ? 'die' : 'dice'})
            </p>
          </div>
        )}
        {(result.attacker_bonus_breakdown?.pending ?? 0) > 0
          && !(result.combat_ability_callouts ?? []).some((c) =>
            c.id === 'knights_charge' || c.id === 'cannon_barrage' || c.id === 'extra_attack_die',
          ) && (
          <p className={clsx(
            'text-xs px-3 py-2 rounded-lg border animate-pulse mb-4',
            perspective === 'attacker'
              ? 'border-amber-300/70 bg-amber-500/15 text-amber-100'
              : 'border-amber-500/40 bg-amber-900/20 text-amber-200',
          )}>
            ⚔️ Bonus attack die activated (+{result.attacker_bonus_breakdown?.pending} die)
          </p>
        )}

        {/* Losses */}
        <div className="flex gap-3 mb-4">
          {result.attacker_losses > 0 && (
            <div className="flex-1 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
              <Skull className="w-4 h-4 mx-auto mb-1 text-red-400/70" />
              <p className="text-red-300 text-sm font-semibold">
                &minus;{result.attacker_losses} troop{result.attacker_losses > 1 ? 's' : ''}
              </p>
            </div>
          )}
          {result.defender_losses > 0 && (
            <div className="flex-1 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
              <Skull className="w-4 h-4 mx-auto mb-1 text-blue-400/70" />
              <p className="text-blue-300 text-sm font-semibold">
                &minus;{result.defender_losses} defender{result.defender_losses > 1 ? 's' : ''}
              </p>
            </div>
          )}
          {result.attacker_losses === 0 && result.defender_losses === 0 && (
            <div className="flex-1 p-3 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="text-white/50 text-sm">No losses</p>
            </div>
          )}
        </div>

        {/* Territory Captured / Lost */}
        {result.territory_captured && (
          <div className={clsx(
            'mb-5 p-4 rounded-xl border text-center',
            isDefending
              ? 'bg-gradient-to-r from-red-500/15 via-red-500/20 to-red-500/15 border-red-500/30'
              : 'bg-gradient-to-r from-amber-500/15 via-yellow-500/20 to-amber-500/15 border-yellow-500/30 animate-capture-glow'
          )}>
            <div className="flex items-center justify-center gap-2.5">
              {isDefending ? (
                <>
                  <Skull className="w-5 h-5 text-red-400" />
                  <span className="text-red-300 font-bold text-lg tracking-wide font-display">
                    {result.capitalLost ? 'Your Capital Has Fallen!' : 'Territory Lost!'}
                  </span>
                  <Skull className="w-5 h-5 text-red-400" />
                </>
              ) : (
                <>
                  <Crown className="w-5 h-5 text-yellow-400" />
                  <span className="text-yellow-300 font-bold text-lg tracking-wide font-display">Territory Captured!</span>
                  <Crown className="w-5 h-5 text-yellow-400" />
                </>
              )}
            </div>
          </div>
        )}

        {/* Repeat same attack (attacker only, failed capture, enough troops) */}
        {showResult && onRepeatAttack && repeatAttack && !result.territory_captured && perspective === 'attacker' && (
          <button
            type="button"
            onClick={onRepeatAttack}
            className="w-full mb-3 py-3 rounded-xl bg-bf-gold/15 hover:bg-bf-gold/25 border border-bf-gold/40
                       text-bf-gold font-medium transition-all duration-200
                       flex items-center justify-center gap-2"
          >
            <Sword className="w-4 h-4" />
            Attack again (same battle)
          </button>
        )}

        {/* Continue (manual) / Skip hint (theater auto-advances on its own) */}
        {autoAdvance ? (
          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-2 rounded-xl text-white/40 hover:text-white/80 text-sm
                       transition-colors flex items-center justify-center gap-1.5"
          >
            Tap or press Enter to skip
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/[0.15] border border-white/10
                         text-white font-medium transition-all duration-200
                         flex items-center justify-center gap-2 group"
            >
              Continue
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
            {/* Backlog relief valve: one click clears the whole pile. Hidden on a
                lost-capital modal (that one must be acknowledged, not skipped). */}
            {onSkipAll && backlogCount > 1 && !result.capitalLost && (
              <button
                type="button"
                onClick={onSkipAll}
                className="w-full mt-2 py-2 rounded-xl text-white/45 hover:text-white/80 text-sm
                           transition-colors flex items-center justify-center gap-1.5"
              >
                <FastForward className="w-3.5 h-3.5" />
                Skip all ({backlogCount})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stagger-reveal wrapper ─────────────────────────────────────────────────

function StaggerItem({ index, children }: { index: number; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80 + index * 90);
    return () => clearTimeout(t);
  }, [index]);
  return (
    <div className={clsx('transition-all duration-300', visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3')}>
      {children}
    </div>
  );
}

// ─── Slide types ────────────────────────────────────────────────────────────

interface SlideConfig {
  id: string;
  icon: React.ReactNode;
  title: string;
  accentClass: string;
  render: () => React.ReactNode;
}

// ─── Turn Summary Slide Carousel ────────────────────────────────────────────

function TurnSummaryView({ data, onDismiss }: { data: TurnSummaryModalData; onDismiss: () => void }) {
  const { playerName, playerColor, turnNumber, combats, isOwnTurn, reinforcements, fortifications } = data;
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState<'left' | 'right'>('right');
  const [animating, setAnimating] = useState(false);
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);

  const totalBattles = combats.length;
  const captures = combats.filter(c => c.territory_captured).length;
  const totalEnemyDestroyed = combats.reduce((s, c) => s + c.defender_losses, 0);
  const totalOwnLost = combats.reduce((s, c) => s + c.attacker_losses, 0);
  const totalReinforced = reinforcements?.reduce((s, r) => s + r.units, 0) ?? 0;
  const totalFortified = fortifications?.reduce((s, f) => s + f.units, 0) ?? 0;

  const slides: SlideConfig[] = [];

  if (isOwnTurn && reinforcements && reinforcements.length > 0) {
    slides.push({
      id: 'reinforce',
      icon: <Shield className="w-6 h-6 text-emerald-400" />,
      title: 'Reinforcements',
      accentClass: 'text-emerald-400',
      render: () => (
        <div className="space-y-2 w-full">
          <div className="text-center mb-5">
            <span className="text-4xl font-bold text-emerald-400 tabular-nums">+{totalReinforced}</span>
            <p className="text-white/40 text-sm mt-1">troops deployed</p>
          </div>
          {reinforcements.map((r, i) => (
            <StaggerItem key={i} index={i}>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/10">
                <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-white/70 flex-1 truncate">{r.territoryName}</span>
                <span className="text-emerald-400 font-bold tabular-nums">+{r.units}</span>
              </div>
            </StaggerItem>
          ))}
        </div>
      ),
    });
  }

  if (totalBattles > 0) {
    slides.push({
      id: 'battles',
      icon: <Sword className="w-6 h-6 text-red-400" />,
      title: isOwnTurn ? 'Your Battles' : `${playerName}'s Battles`,
      accentClass: 'text-red-400',
      render: () => (
        <div className="w-full">
          <div className="grid grid-cols-3 gap-3 mb-5 w-full">
            <StaggerItem index={0}>
              <div className="p-3 rounded-xl bg-red-500/[0.06] border border-red-500/10 text-center">
                <Sword className="w-5 h-5 mx-auto mb-1.5 text-red-400" />
                <p className="text-2xl font-bold text-white tabular-nums">{totalBattles}</p>
                <p className="text-white/35 text-xs">{totalBattles === 1 ? 'Battle' : 'Battles'}</p>
              </div>
            </StaggerItem>
            <StaggerItem index={1}>
              <div className="p-3 rounded-xl bg-yellow-500/[0.06] border border-yellow-500/10 text-center">
                <Flag className="w-5 h-5 mx-auto mb-1.5 text-yellow-400" />
                <p className="text-2xl font-bold text-white tabular-nums">{captures}</p>
                <p className="text-white/35 text-xs">{captures === 1 ? 'Capture' : 'Captures'}</p>
              </div>
            </StaggerItem>
            <StaggerItem index={2}>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
                <Skull className="w-5 h-5 mx-auto mb-1.5 text-white/40" />
                <p className="text-2xl font-bold text-white tabular-nums">{isOwnTurn ? totalOwnLost : totalEnemyDestroyed}</p>
                <p className="text-white/35 text-xs">{isOwnTurn ? 'Lost' : 'Destroyed'}</p>
              </div>
            </StaggerItem>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 w-full">
            {combats.map((c, i) => (
              <StaggerItem key={i} index={i + 3}>
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.04] text-sm">
                  <Sword className="w-3.5 h-3.5 text-red-400/60 shrink-0" />
                  <span className="text-white/60 flex-1 truncate">
                    {c.fromName ?? '?'} &rarr; {c.toName ?? '?'}
                  </span>
                  {c.territory_captured ? (
                    <span className="text-yellow-400 text-xs font-semibold shrink-0 flex items-center gap-1">
                      <Flag className="w-3 h-3" /> Captured
                    </span>
                  ) : c.defender_losses > 0 ? (
                    <span className="text-blue-400/50 text-xs shrink-0">&minus;{c.defender_losses} def</span>
                  ) : c.attacker_losses > 0 ? (
                    <span className="text-red-400/50 text-xs shrink-0">&minus;{c.attacker_losses} atk</span>
                  ) : null}
                </div>
              </StaggerItem>
            ))}
          </div>
        </div>
      ),
    });
  }

  if (isOwnTurn && fortifications && fortifications.length > 0) {
    slides.push({
      id: 'fortify',
      icon: <ArrowRight className="w-6 h-6 text-sky-400" />,
      title: 'Fortifications',
      accentClass: 'text-sky-400',
      render: () => (
        <div className="space-y-2 w-full">
          <div className="text-center mb-5">
            <span className="text-4xl font-bold text-sky-400 tabular-nums">{totalFortified}</span>
            <p className="text-white/40 text-sm mt-1">troops moved</p>
          </div>
          {fortifications.map((f, i) => (
            <StaggerItem key={i} index={i}>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-sky-500/[0.07] border border-sky-500/10">
                <ArrowRight className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-white/70 flex-1 truncate">{f.fromName} &rarr; {f.toName}</span>
                <span className="text-sky-400 font-bold tabular-nums">{f.units}</span>
              </div>
            </StaggerItem>
          ))}
        </div>
      ),
    });
  }

  if (slides.length === 0) {
    slides.push({
      id: 'empty',
      icon: <Shield className="w-6 h-6 text-white/30" />,
      title: isOwnTurn ? 'Turn Complete' : `${playerName}'s Turn`,
      accentClass: 'text-white/40',
      render: () => (
        <div className="p-8 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <Shield className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40 text-sm font-medium">
            {isOwnTurn ? 'No actions taken this turn' : 'No battles this turn'}
          </p>
        </div>
      ),
    });
  }

  const goTo = useCallback((idx: number, dir?: 'left' | 'right') => {
    if (animating || idx === currentSlide) return;
    setDirection(dir ?? (idx > currentSlide ? 'right' : 'left'));
    setAnimating(true);
    setTimeout(() => {
      setCurrentSlide(idx);
      setAnimating(false);
    }, 300);
  }, [animating, currentSlide]);

  const goNext = useCallback(() => {
    if (currentSlide < slides.length - 1) goTo(currentSlide + 1, 'right');
  }, [currentSlide, slides.length, goTo]);

  const goPrev = useCallback(() => {
    if (currentSlide > 0) goTo(currentSlide - 1, 'left');
  }, [currentSlide, goTo]);

  useEffect(() => {
    if (autoPaused || slides.length <= 1) return;
    autoRef.current = setTimeout(() => {
      if (currentSlide < slides.length - 1) goTo(currentSlide + 1, 'right');
    }, 4000);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [currentSlide, autoPaused, slides.length, goTo]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { setAutoPaused(true); goNext(); }
      else if (e.key === 'ArrowLeft') { setAutoPaused(true); goPrev(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev]);

  const safeSlideIndex = slides.length === 0 ? 0 : Math.min(Math.max(0, currentSlide), slides.length - 1);
  const slide = slides[safeSlideIndex];
  const isLastSlide = safeSlideIndex === slides.length - 1;

  if (!slide) {
    return (
      <div className="w-full max-w-sm mx-auto text-center py-6">
        <p className="text-white/50 text-sm">Turn summary unavailable.</p>
        <button type="button" onClick={onDismiss} className="mt-4 w-full py-3 rounded-xl bg-white/10 border border-white/10 text-white font-medium">
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0" onClick={() => setAutoPaused(true)}>
      {/* Header */}
      <div className="text-center mb-5">
        <div className={clsx(
          'inline-flex items-center gap-2.5 px-5 py-2 rounded-full border mb-3',
          isOwnTurn ? 'bg-bf-gold/10 border-bf-gold/25' : 'bg-white/5 border-white/10'
        )}>
          {!isOwnTurn && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: playerColor }} />}
          <span className={clsx(
            'text-xs font-bold tracking-[0.2em] uppercase',
            isOwnTurn ? 'text-bf-gold' : 'text-white/60'
          )}>
            {isOwnTurn ? 'Your Turn Complete' : 'Turn Complete'}
          </span>
        </div>
        <p className="text-white/30 text-xs">Turn {turnNumber}</p>
      </div>

      {/* Slide Header */}
      <div className="flex items-center justify-center gap-3 mb-5">
        {slide.icon}
        <h2 className={clsx('text-xl font-bold font-display', slide.accentClass)}>
          {slide.title}
        </h2>
      </div>

      {/* Slide Content */}
      <div className="relative overflow-hidden min-h-[200px] w-full">
        <div
          key={slide.id}
          className={clsx(
            'transition-all duration-300 w-full',
            animating
              ? direction === 'right' ? 'opacity-0 -translate-x-8' : 'opacity-0 translate-x-8'
              : 'opacity-100 translate-x-0'
          )}
        >
          {slide.render()}
        </div>
      </div>

      {/* Navigation Dots */}
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-4 mt-5 mb-4">
          <button
            onClick={goPrev}
            disabled={safeSlideIndex === 0}
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-20 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-white/60" />
          </button>
          <div className="flex gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => { setAutoPaused(true); goTo(i); }}
                className={clsx(
                  'w-2 h-2 rounded-full transition-all duration-300',
                  i === safeSlideIndex ? 'bg-white w-6' : 'bg-white/25 hover:bg-white/40'
                )}
              />
            ))}
          </div>
          <button
            onClick={goNext}
            disabled={isLastSlide}
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-20 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-white/60" />
          </button>
        </div>
      )}

      {/* Continue / Next Button */}
      <button
        onClick={isLastSlide ? onDismiss : () => { setAutoPaused(true); goNext(); }}
        className={clsx(
          'w-full py-3 rounded-xl border text-white font-medium transition-all duration-200',
          'flex items-center justify-center gap-2 group',
          isLastSlide ? 'bg-white/10 hover:bg-white/15 border-white/10' : 'bg-white/5 hover:bg-white/10 border-white/[0.06]'
        )}
      >
        {isLastSlide ? 'Continue' : 'Next'}
        <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

// ─── Win probability chart (endgame) ───────────────────────────────────────

function WinProbabilityChart({
  history,
  players,
}: {
  history: WinProbabilitySnapshot[];
  players: GameOverModalData['players'];
}) {
  const W = 420;
  const H = 168;
  const pad = { l: 40, r: 12, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = history.length;
  if (n < 2) return null;

  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (p: number) => pad.t + innerH - p * innerH;

  const lines = players.map((pl) => {
    const pts = history.map((snap, i) => {
      const prob = snap.probabilities[pl.player_id] ?? 0;
      return `${xAt(i)},${yAt(prob)}`;
    });
    return { pl, d: pts.join(' ') };
  });

  // Calculate tick positions and turn numbers for the x-axis
  const tickCount = Math.min(8, n); // Show up to 8 ticks for clarity
  const tickIndexes = Array.from({ length: tickCount }, (_, i) => Math.round(i * (n - 1) / (tickCount - 1)));
  const tickSet = new Set(tickIndexes);

  return (
    <div className="w-full text-left">
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2 text-center">Win probability over time</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[200px]" role="img" aria-label="Win probability by turn">
        <defs>
          <linearGradient id="chart-grid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
        </defs>
        <rect x={pad.l} y={pad.t} width={innerW} height={innerH} fill="url(#chart-grid)" rx={4} />
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={pad.l + innerW}
            y1={yAt(t)}
            y2={yAt(t)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray={t === 0.5 ? '4 4' : '0'}
          />
        ))}
        {/* X-axis ticks and turn numbers */}
        {history.map((snap, i) => tickSet.has(i) && (
          <g key={i}>
            <line
              x1={xAt(i)}
              x2={xAt(i)}
              y1={pad.t + innerH}
              y2={pad.t + innerH + 6}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
            />
            <text
              x={xAt(i)}
              y={pad.t + innerH + 16}
              textAnchor="middle"
              fill="rgba(255,255,255,0.38)"
              fontSize={9}
            >
              {snap.turn}
            </text>
          </g>
        ))}
        <text x={pad.l - 4} y={yAt(1) + 4} textAnchor="end" fill="rgba(255,255,255,0.28)" fontSize={9}>100%</text>
        <text x={pad.l - 4} y={yAt(0) + 4} textAnchor="end" fill="rgba(255,255,255,0.28)" fontSize={9}>0%</text>
        {lines.map(({ pl, d }) => (
          <polyline
            key={pl.player_id}
            fill="none"
            stroke={pl.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.92}
            points={d}
          />
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fill="rgba(255,255,255,0.28)" fontSize={9}>Match progression →</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
        {players.map((pl) => (
          <span key={pl.player_id} className="inline-flex items-center gap-1.5 text-[10px] text-white/50">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pl.color }} />
            <span className="truncate max-w-[7rem]">{pl.username}</span>
            {pl.is_ai ? <AiBadge size="xs" showLabel={false} /> : null}
          </span>
        ))}
      </div>
      <p className="text-white/25 text-[10px] text-center mt-2 leading-snug">
        Estimated each turn from territory control and total armies on the map (not actual RNG).
      </p>
    </div>
  );
}

// ─── Game Over View ─────────────────────────────────────────────────────────

function GameOverView({ data, onDismiss, onRematch, onWatchReplay, onChallengeFriend, onUpgradeAccount }: {
  data: GameOverModalData;
  onDismiss: () => void;
  onRematch?: (cfg: NonNullable<GameOverModalData['rematchConfig']>) => void;
  onWatchReplay?: (gameId: string) => void;
  onChallengeFriend?: () => void;
  onUpgradeAccount?: () => void;
}) {
  const [showContent, setShowContent] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShowContent(true), 300); return () => clearTimeout(t); }, []);
  const [statsTab, setStatsTab] = useState<'result' | 'stats'>('result');

  const { user } = useAuthStore();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareBlob, setShareBlob] = useState<Blob | null>(null);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  useEffect(() => {
    return () => { if (shareImageUrl) URL.revokeObjectURL(shareImageUrl); };
  }, [shareImageUrl]);

  const myPlayer = user ? data.players.find((p) => p.player_id === user.user_id) : null;

  // Canonical shareable replay URL. `?source=share` opens recipients straight
  // into the condensed Highlights reel.
  const replayShareUrl = data.gameId
    ? `${window.location.origin}/replay/${data.gameId}?source=share`
    : window.location.origin;

  const handleOpenShare = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    // Make the replay public so the link works for anyone — without this the
    // recipient hits the "not public" gate. Fire-and-forget; the viewer also
    // re-asserts public when copying from the replay page.
    if (data.gameId) {
      api.post(`/share/${data.gameId}/make-public`).catch(() => {});
    }
    try {
      const blob = await generateShareCard({
        eraName: data.eraName ?? APP_NAME,
        factionColor: myPlayer?.color ?? data.winnerColor,
        victoryCondition: data.victory_condition ?? 'domination',
        territoryCount: myPlayer?.territory_count ?? 0,
        turnCount: data.turnCount,
        username: user?.username ?? data.winnerName,
        shareUrl: replayShareUrl,
        isWinner: data.isWinner,
        achievements: data.achievements_unlocked,
        friendStreakBonus: data.progression?.friend_streak_bonus,
      });
      const url = URL.createObjectURL(blob);
      if (shareImageUrl) URL.revokeObjectURL(shareImageUrl);
      setShareBlob(blob);
      setShareImageUrl(url);
      setShareOpen(true);
    } catch {
      console.error('Share card generation failed');
    } finally {
      setShareBusy(false);
    }
  };

  const handleNativeShare = async () => {
    if (!shareBlob) return;
    const file = new File([shareBlob], 'eras-result.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* user cancelled */ }
    } else {
      await handleCopyImage();
    }
  };

  const handleCopyImage = async () => {
    if (!shareBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareBlob })]);
    } catch {
      const text = buildShareText({
        username: user?.username ?? data.winnerName,
        isWinner: data.isWinner,
        eraName: data.eraName ?? APP_NAME,
        victoryCondition: data.victory_condition ?? 'domination',
        turnCount: data.turnCount,
        shareUrl: window.location.origin,
      });
      try { await navigator.clipboard.writeText(text); } catch { /* silent */ }
    }
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const sortedPlayers = [...data.players].sort((a, b) => b.territory_count - a.territory_count);
  const probHistory = data.win_probability_history;

  const victoryReasonLabel = (condition: GameOverModalData['victory_condition']): string | null => {
    switch (condition) {
      case 'domination':      return 'Total Domination — all territories conquered';
      case 'last_standing':   return 'Last Commander Standing — all opponents eliminated';
      case 'threshold':       return 'Territorial Threshold — controlling majority of the map';
      case 'capital':         return 'Capital Conquest — all rival capitals seized';
      case 'secret_mission':  return 'Secret Mission completed';
      case 'alliance_victory':return 'Alliance Victory — allied commanders triumphed together';
      case 'abandoned':       return 'Game ended — no human players remained';
      case 'turn_limit':      return 'Turn Limit Reached — strongest position wins';
      case 'resignation':     return 'Resignation — the last commander conceded the field';
      default:                return null;
    }
  };

  const isAbandoned = data.victory_condition === 'abandoned';
  const isAlliance = data.victory_condition === 'alliance_victory';
  const winnerIds = data.winnerIds ?? [];
  const allyName = isAlliance
    ? data.players.find((p) => winnerIds.includes(p.player_id) && p.player_id !== data.players.find((pl) => pl.username === data.winnerName)?.player_id)?.username
    : undefined;

  const reasonLabel = victoryReasonLabel(data.victory_condition);

  const showWatchReplay = Boolean(
    data.gameId &&
      onWatchReplay &&
      (data.victory_condition !== 'abandoned' || data.allowReplayDespiteAbandon),
  );
  const showRematch = Boolean(
    data.rematchConfig &&
      !data.rematchConfig.settings?.daily_challenge_date &&
      !data.rematchConfig.settings?.tutorial &&
      onRematch,
  );
  const showChallenge = Boolean(onChallengeFriend);
  const tertiaryCount = 1 + (showWatchReplay ? 1 : 0) + (showChallenge ? 1 : 0);

  return (
    <div className="w-full min-w-0 text-center">
      {/* Trophy / Skull / Flag Animation */}
      <div className={clsx('mb-6 transition-all duration-700', showContent ? 'opacity-100 scale-100' : 'opacity-0 scale-50')}>
        {isAbandoned ? (
          <Skull className="w-20 h-20 text-white/30 mx-auto" />
        ) : data.isWinner ? (
          <div className="relative inline-block">
            <Trophy className="w-20 h-20 text-yellow-400 drop-shadow-[0_0_30px_rgba(234,179,8,0.4)]" />
            <div className="absolute inset-0 animate-ping">
              <Trophy className="w-20 h-20 text-yellow-400/20" />
            </div>
          </div>
        ) : (
          <Skull className="w-20 h-20 text-red-400/60 mx-auto" />
        )}
      </div>

      {/* Title */}
      <h2 className={clsx(
        'text-3xl font-bold font-display mb-2 transition-all duration-500 delay-200',
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        isAbandoned ? 'text-white/50' : data.isWinner ? 'text-yellow-400' : 'text-red-400'
      )}>
        {isAbandoned ? 'Game Abandoned' : isAlliance && data.isWinner ? '🤝 Alliance Victory!' : data.isWinner ? 'Victory!' : 'Defeat'}
      </h2>
      <p className={clsx(
        'text-white/50 text-sm mb-3 transition-all duration-500 delay-300',
        showContent ? 'opacity-100' : 'opacity-0'
      )}>
        {isAbandoned
          ? 'You resigned. The game ended with no human players remaining.'
          : data.isWinner
            ? isAlliance && allyName
              ? `You and ${allyName} have triumphed together!`
              : 'You have conquered the world!'
            : isAlliance
              ? 'Defeated by an Alliance.'
              : `${data.winnerName} has won the game`}
      </p>

      {/* Alliance co-winners display */}
      {isAlliance && winnerIds.length >= 2 && (
        <div className={clsx(
          'mb-4 flex items-center justify-center gap-3 transition-all duration-500 delay-300',
          showContent ? 'opacity-100' : 'opacity-0'
        )}>
          {winnerIds.map((wid) => {
            const wp = data.players.find((p) => p.player_id === wid);
            if (!wp) return null;
            return (
              <span
                key={wid}
                className="px-3 py-1 rounded-full text-sm font-semibold border"
                style={{ borderColor: wp.color, color: wp.color, background: `${wp.color}15` }}
              >
                {wp.username}
              </span>
            );
          })}
          <span className="text-yellow-400 text-lg">🤝</span>
        </div>
      )}

      {/* Victory condition reason */}
      {reasonLabel && (
        <div className={clsx(
          'mb-5 px-3 py-2 rounded-lg border text-xs font-medium transition-all duration-500 delay-350',
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
          data.isWinner
            ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
            : 'bg-white/5 border-white/10 text-white/45'
        )}>
          {data.isWinner ? '🏆 ' : ''}Victory by {reasonLabel}
        </div>
      )}

      {data.xpEarned != null && data.xpEarned > 0 && (
        <p className="text-bf-gold/90 text-sm font-medium mb-2">+{data.xpEarned} XP</p>
      )}

      {/* Progression rewards summary */}
      {data.progression && data.progression.gold_awarded > 0 && (
        <div className={clsx(
          'flex flex-wrap items-center justify-center gap-3 mb-4 transition-all duration-500 delay-350',
          showContent ? 'opacity-100' : 'opacity-0',
        )}>
          <span className="inline-flex items-center gap-1 text-sm text-bf-gold font-medium">
            <Coins size={14} /> +{data.progression.gold_awarded} Gold
          </span>
          {data.progression.gold_multiplier > 1 && (
            <span className="inline-flex items-center gap-1 text-xs text-orange-400 font-bold bg-orange-400/10 border border-orange-400/30 rounded-md px-2 py-0.5">
              <Flame size={12} /> {data.progression.gold_multiplier}× streak bonus
            </span>
          )}
          {data.progression.win_streak >= 3 && (
            <span className="inline-flex items-center gap-1 text-xs text-orange-300">
              🔥 {data.progression.win_streak} win streak
            </span>
          )}
          {(data.progression.friend_streak_bonus ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-sky-300 font-medium bg-sky-400/10 border border-sky-400/20 rounded-md px-2 py-0.5">
              <Flame size={12} /> +{data.progression.friend_streak_bonus}% friend streak bonus
            </span>
          )}
        </div>
      )}

      {/* Stats */}
      <div className={clsx(
        `grid ${data.rating_change != null ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-6 transition-all duration-500 delay-400`,
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      )}>
        <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <p className="text-2xl font-bold text-white tabular-nums">{data.turnCount}</p>
          <p className="text-white/35 text-xs">Turns</p>
        </div>
        <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          <p className="text-2xl font-bold text-white tabular-nums">{data.players.length}</p>
          <p className="text-white/35 text-xs">Players</p>
        </div>
        {data.rating_change != null && (
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <p className={clsx(
              'font-bold tabular-nums flex items-center justify-center gap-1.5 flex-wrap',
              data.rating_provisional ? 'text-xl' : 'text-2xl',
              data.rating_change >= 0 ? 'text-green-400' : 'text-red-400',
            )}>
              {data.rating_change >= 0 ? '+' : ''}{data.rating_change}
              {data.rating_provisional && (
                <span
                  className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300"
                  title="Early ratings swing widely while the system calibrates — they settle after a few games."
                >
                  Calibrating
                </span>
              )}
            </p>
            <p className="text-white/35 text-xs">
              {data.is_ranked ? 'Ranked' : 'Solo'} Rating
              {data.rating_provisional ? ' · settles after a few games' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Guest conversion: progression is the part guests keep — make the
          claim explicit at the exact moment it was just earned. Skipped in
          tutorial games, which run their own account prompt. */}
      {user?.is_guest && onUpgradeAccount && !data.rematchConfig?.settings?.tutorial && (
        <div className={clsx(
          'mb-6 p-4 rounded-xl bg-bf-gold/10 border border-bf-gold/30 transition-all duration-500 delay-450',
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        )}>
          <p className="text-sm text-bf-text mb-3">
            Your XP, level, and streaks are saved to this guest session —{' '}
            <span className="text-bf-gold font-medium">create a free account to make them permanent.</span>
          </p>
          <button
            type="button"
            onClick={onUpgradeAccount}
            className="w-full py-2.5 rounded-lg bg-bf-gold text-bf-dark font-display hover:bg-bf-gold/90 transition-colors"
          >
            Create Free Account
          </button>
        </div>
      )}

      {probHistory && probHistory.length >= 2 && (
        <div className={clsx(
          'mb-6 transition-all duration-500 delay-500',
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        )}>
          <WinProbabilityChart history={probHistory} players={data.players} />
        </div>
      )}

      {data.insights && data.insights.length > 0 && (
        <div className={clsx(
          'mb-6 transition-all duration-500 delay-500',
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        )}>
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Coaching Turning Points</p>
          <div className="space-y-2">
            {data.insights.map((insight, idx) => (
              <div key={`${insight.turn}-${idx}`} className="text-left rounded-lg bg-white/[0.03] border border-white/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-white/80 font-medium">{insight.title}</p>
                  <span className={clsx(
                    'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border',
                    insight.impact === 'high'
                      ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                      : 'text-sky-300 border-sky-500/40 bg-sky-500/10',
                  )}>
                    {insight.impact}
                  </span>
                </div>
                <p className="text-[11px] text-white/45 mt-1">Turn {insight.turn}</p>
                <p className="text-xs text-white/70 mt-2">{insight.explanation}</p>
                <p className="text-xs text-emerald-300/90 mt-2">Alternative: {insight.alternative}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar — Results vs Match Stats */}
      <div className={clsx(
        'mb-4 flex border-b border-white/10 transition-all duration-500 delay-500',
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}>
        {(['result', 'stats'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setStatsTab(tab)}
            className={clsx(
              'flex-1 pb-2.5 pt-1 text-xs font-semibold uppercase tracking-widest transition-colors',
              statsTab === tab
                ? 'text-bf-gold border-b-2 border-bf-gold -mb-px'
                : 'text-white/30 hover:text-white/50',
            )}
          >
            {tab === 'result' ? 'Results' : 'Match Stats'}
          </button>
        ))}
      </div>

      {statsTab === 'stats' ? (
        /* ── Match Stats Tab ─────────────────────────────────────────────── */
        <div className={clsx(
          'mb-6 transition-all duration-500 delay-500',
          showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}>
          <MatchStatsTab data={data} myId={user?.user_id ?? null} />
        </div>
      ) : (
        /* ── Results Tab (original content) ─────────────────────────────── */
        <>
          {/* Leaderboard */}
          <div className={clsx(
            'mb-6 transition-all duration-500 delay-500',
            showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          )}>
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Final Standings</p>
            <div className="space-y-1.5">
              {sortedPlayers.map((p, i) => (
                <div key={p.player_id} className={clsx(
                  'flex items-center gap-3 p-2.5 rounded-lg text-sm',
                  i === 0 ? 'bg-yellow-500/[0.08] border border-yellow-500/15' : 'bg-white/[0.03]'
                )}>
                  <span className="text-white/30 text-xs w-5 text-right">#{i + 1}</span>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className={clsx('flex-1 text-left flex items-center gap-1.5 min-w-0', i === 0 ? 'text-yellow-300 font-semibold' : 'text-white/60')}>
                    <span className="truncate">{p.username}</span>
                    {p.is_ai ? <AiBadge difficulty={p.ai_difficulty} size="xs" showLabel={false} /> : null}
                  </span>
                  <span className="text-white/30 text-xs tabular-nums">{p.territory_count}T</span>
                  {p.is_eliminated && <span className="text-red-400/50 text-xs">Eliminated</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Achievements unlocked */}
          {data.achievements_unlocked && data.achievements_unlocked.length > 0 && (
            <div className={clsx(
              'mb-6 transition-all duration-500 delay-500',
              showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            )}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Medals Earned</p>
              <div className="flex flex-wrap justify-center gap-2">
                {data.achievements_unlocked.map((id) => (
                  <div key={id} className="px-3 py-1.5 rounded-lg bg-yellow-500/10
                              border border-yellow-500/20 text-yellow-300 text-xs
                              font-medium animate-fade-in">
                    {id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Actions — primary CTAs stack; secondary actions in an equal grid (no overflow) */}
      <div className={clsx(
        'flex flex-col gap-3 w-full min-w-0 transition-all duration-500 delay-600',
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      )}>
        {showRematch && (
          <button
            type="button"
            onClick={() => onRematch!(data.rematchConfig!)}
            className="w-full py-3 px-4 rounded-xl bg-bf-gold/20 hover:bg-bf-gold/30
                       border border-bf-gold/40 text-bf-gold font-semibold transition-all
                       flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            Rematch
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className={clsx(
            'w-full py-3 px-4 rounded-xl border font-medium transition-all',
            'flex items-center justify-center gap-2 whitespace-nowrap',
            showRematch
              ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white/80'
              : 'bg-white/10 hover:bg-white/15 border-white/10 text-white',
          )}
        >
          Return to Lobby
          <ChevronRight className="w-4 h-4 shrink-0" />
        </button>

        <div
          className={clsx(
            'grid gap-2 w-full min-w-0',
            tertiaryCount === 3 && 'grid-cols-3',
            tertiaryCount === 2 && 'grid-cols-2',
            tertiaryCount === 1 && 'grid-cols-1',
          )}
        >
          <button
            type="button"
            onClick={handleOpenShare}
            disabled={shareBusy}
            className="py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
                       text-white/70 text-xs sm:text-sm font-medium transition-all
                       flex flex-col sm:flex-row items-center justify-center gap-1.5 min-w-0
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{shareBusy ? '…' : 'Share'}</span>
          </button>
          {showWatchReplay && (
            <button
              type="button"
              onClick={() => onWatchReplay!(data.gameId!)}
              className="py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
                         text-white/70 text-xs sm:text-sm font-medium transition-all
                         flex flex-col sm:flex-row items-center justify-center gap-1.5 min-w-0"
            >
              <Film className="w-4 h-4 shrink-0" />
              <span className="truncate">Replay</span>
            </button>
          )}
          {showChallenge && (
            <button
              type="button"
              onClick={onChallengeFriend}
              className="py-2.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
                         text-white/70 text-xs sm:text-sm font-medium transition-all
                         flex flex-col sm:flex-row items-center justify-center gap-1.5 min-w-0"
            >
              <Swords className="w-4 h-4 shrink-0" />
              <span className="truncate">Challenge</span>
            </button>
          )}
        </div>
      </div>

      {/* Share preview overlay */}
      {shareOpen && shareImageUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 p-6 gap-4"
             onClick={() => setShareOpen(false)}>
          <div className="flex flex-col items-center gap-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Share Your Result</p>
            <img src={shareImageUrl} alt="Share card preview" className="w-full rounded-xl shadow-2xl" />

            {/* Replay link */}
            {data.gameId && (
              <div className="w-full flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                <Link2 className="w-4 h-4 text-white/40 shrink-0" />
                <span className="text-white/60 text-xs truncate flex-1">
                  {window.location.origin}/replay/{data.gameId}
                </span>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(replayShareUrl).catch(() => {});
                    setCopyStatus('copied');
                    setTimeout(() => setCopyStatus('idle'), 2000);
                    // Track share
                    if (data.gameId) {
                      api.post(`/share/${data.gameId}`, { platform: 'clipboard' }).catch(() => {});
                    }
                  }}
                  className="text-bf-gold text-xs font-medium hover:text-white transition-colors shrink-0 flex items-center gap-1"
                >
                  {copyStatus === 'copied' ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
            )}

            {/* Platform share buttons */}
            <div className="grid grid-cols-2 gap-2 w-full">
              <button
                onClick={handleCopyImage}
                className="py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium
                           flex items-center justify-center gap-2 transition-all border border-white/10"
              >
                {copyStatus === 'copied'
                  ? <><Check className="w-4 h-4 text-green-400" /> Copied!</>
                  : <><Copy className="w-4 h-4" /> Copy Image</>}
              </button>

              <button
                onClick={() => {
                  const text = buildShareText({
                    username: user?.username ?? data.winnerName,
                    isWinner: data.isWinner,
                    eraName: data.eraName ?? APP_NAME,
                    victoryCondition: data.victory_condition ?? 'domination',
                    turnCount: data.turnCount,
                    shareUrl: replayShareUrl,
                  });
                  window.open(
                    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
                    '_blank',
                    'noopener,noreferrer',
                  );
                  if (data.gameId) {
                    api.post(`/share/${data.gameId}`, { platform: 'twitter' }).catch(() => {});
                  }
                }}
                className="py-2.5 rounded-xl bg-[#1da1f2]/10 hover:bg-[#1da1f2]/20 text-[#1da1f2] text-sm font-medium
                           flex items-center justify-center gap-2 transition-all border border-[#1da1f2]/20"
              >
                <ExternalLink className="w-4 h-4" /> Twitter / X
              </button>

              {/* Discord: copy a ready-to-paste message (link + result blurb)
                  since Discord has no web intent URL. */}
              <button
                onClick={async () => {
                  const text = buildShareText({
                    username: user?.username ?? data.winnerName,
                    isWinner: data.isWinner,
                    eraName: data.eraName ?? APP_NAME,
                    victoryCondition: data.victory_condition ?? 'domination',
                    turnCount: data.turnCount,
                    shareUrl: replayShareUrl,
                  });
                  await navigator.clipboard.writeText(text).catch(() => {});
                  setCopyStatus('copied');
                  setTimeout(() => setCopyStatus('idle'), 2000);
                  if (data.gameId) {
                    api.post(`/share/${data.gameId}`, { platform: 'discord' }).catch(() => {});
                  }
                  window.open('https://discord.com/app', '_blank', 'noopener,noreferrer');
                }}
                className="py-2.5 rounded-xl bg-[#5865f2]/10 hover:bg-[#5865f2]/20 text-[#5865f2] text-sm font-medium
                           flex items-center justify-center gap-2 transition-all border border-[#5865f2]/20"
              >
                <MessageCircle className="w-4 h-4" /> Discord
              </button>
            </div>

            {typeof navigator.canShare === 'function' && (
              <button
                onClick={() => {
                  handleNativeShare();
                  if (data.gameId) {
                    api.post(`/share/${data.gameId}`, { platform: 'native' }).catch(() => {});
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-bf-gold/20 hover:bg-bf-gold/30 text-bf-gold text-sm font-medium
                           flex items-center justify-center gap-2 transition-all border border-bf-gold/30"
              >
                <Share2 className="w-4 h-4" /> Share via Device
              </button>
            )}

            <button
              onClick={() => setShareOpen(false)}
              className="text-white/30 hover:text-white/60 text-sm transition-colors mt-1"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Elimination View ───────────────────────────────────────────────────────

function formatMission(
  m: NonNullable<EliminationModalData['secretMission']>,
  lookup?: MapNameLookup | null,
  players?: Array<{ player_id: string; username: string }>,
): string {
  return formatSecretMissionReveal(m, lookup, players);
}

function EliminationView({
  data,
  onDismiss,
  mapNameLookup,
  players,
}: {
  data: EliminationModalData;
  onDismiss: () => void;
  mapNameLookup?: MapNameLookup | null;
  players?: Array<{ player_id: string; username: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto text-center">
      <Skull className={clsx('w-14 h-14 mx-auto mb-4', data.isSelf ? 'text-red-400' : 'text-white/30')} />
      <h2 className={clsx('text-2xl font-bold font-display mb-2', data.isSelf ? 'text-red-400' : 'text-white')}>
        {data.isSelf ? 'You Have Been Eliminated' : 'Player Eliminated'}
      </h2>
      <p className="text-white/50 text-sm mb-4">
        {data.isSelf
          ? `${data.eliminatorName} has conquered your last territory.`
          : `${data.eliminatedName} was eliminated by ${data.eliminatorName}.`}
      </p>
      {data.secretMission && (
        <div className="mb-6 p-3 bg-amber-950/30 rounded-lg border border-amber-600/30">
          <p className="text-xs text-amber-400 uppercase tracking-wide mb-1 font-bold">Secret Mission Revealed</p>
          <p className="text-sm text-white/70">{formatMission(data.secretMission, mapNameLookup, players)}</p>
        </div>
      )}
      <div className="flex gap-3">
        {data.isSelf && (
          <button
            onClick={onDismiss}
            className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/[0.06]
                       text-white/60 font-medium transition-all flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" /> Spectate
          </button>
        )}
        <button
          onClick={onDismiss}
          className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10
                     text-white font-medium transition-all flex items-center justify-center gap-2"
        >
          {data.isSelf ? <><LogOut className="w-4 h-4" /> Leave</> : <>Continue <ChevronRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}

// ─── Resign Confirm View ────────────────────────────────────────────────────

function ResignConfirmView({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="w-full max-w-md mx-auto text-center">
      <Flag className="w-12 h-12 text-white/30 mx-auto mb-4" />
      <h2 className="text-xl font-bold font-display text-white mb-2">Resign Game?</h2>
      <p className="text-white/50 text-sm mb-6">
        Your territories will become neutral. This cannot be undone.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/[0.06]
                     text-white/60 font-medium transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/20
                     text-red-300 font-medium transition-all"
        >
          Resign
        </button>
      </div>
    </div>
  );
}

// ─── Territory Draft Summary View ─────────────────────────────────────────

function DraftSummaryView({ data, onDismiss }: { data: DraftSummaryModalData; onDismiss: () => void }) {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="text-center mb-5">
        <Trophy className="w-12 h-12 mx-auto mb-3 text-amber-300" />
        <h2 className="text-2xl font-bold font-display text-amber-200">Territory Draft Complete</h2>
        <p className="text-white/65 text-sm mt-1">
          The war begins on Turn {data.turnNumber}. Here is an objective draft grade snapshot.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden mb-5">
        {/* Header — 3 cols on mobile, 5 cols on sm+ */}
        <div className="grid grid-cols-[1fr,auto,auto] sm:grid-cols-[1.4fr,0.65fr,0.7fr,0.8fr,0.8fr] gap-x-3 px-4 py-2.5 bg-white/5 text-[11px] uppercase tracking-wider text-white/55">
          <span>Player</span>
          <span className="text-right">Grade</span>
          <span className="text-right sm:hidden">Stats</span>
          <span className="hidden sm:block text-right">Score</span>
          <span className="hidden sm:block text-right">Cohesion</span>
          <span className="hidden sm:block text-right">Leverage</span>
        </div>
        <div className="divide-y divide-white/10">
          {data.ratings.map((r, idx) => (
            <div key={r.playerId} className="grid grid-cols-[1fr,auto,auto] sm:grid-cols-[1.4fr,0.65fr,0.7fr,0.8fr,0.8fr] gap-x-3 px-4 py-3 text-sm items-center">
              <div className="min-w-0 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <div className="min-w-0">
                  <span className="truncate text-white font-medium block">{idx + 1}. {r.playerName}</span>
                  {/* On mobile: show Score / Cohesion / Leverage compactly under name */}
                  <span className="sm:hidden text-[11px] text-white/45 font-mono">
                    {Math.round(r.score)} pts · {Math.round(r.cohesionPct)}% coh · {r.regionLeverage.toFixed(1)} lev
                  </span>
                </div>
                <span className="hidden sm:inline text-white/45 text-xs shrink-0">{r.territories}T</span>
              </div>
              <div className="text-right font-display text-amber-200">{r.grade}</div>
              {/* Mobile: territory count replaces the collapsed stat columns */}
              <div className="text-right font-mono text-white/55 text-xs sm:hidden">{r.territories}T</div>
              <div className="hidden sm:block text-right font-mono text-white/85">{Math.round(r.score)}</div>
              <div className="hidden sm:block text-right font-mono text-white/75">{Math.round(r.cohesionPct)}%</div>
              <div className="hidden sm:block text-right font-mono text-white/75">{r.regionLeverage.toFixed(1)}</div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-white/45 mb-5 text-center">
        Score weighs region leverage, territorial cohesion, and board position quality.
      </p>

      <button
        onClick={onDismiss}
        className="w-full py-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30
                   text-amber-200 font-medium transition-all"
      >
        Begin War
      </button>
    </div>
  );
}

// ─── Main Modal Overlay ────────────────────────────────────────────────────

interface ActionModalProps {
  data: ModalData | null;
  onDismiss: () => void;
  onResignConfirm?: () => void;
  /** Re-roll the same attack after a failed capture (attacker still has 2+ on source) */
  onRepeatCombat?: (fromId: string, toId: string) => void;
  onRematch?: (cfg: NonNullable<GameOverModalData['rematchConfig']>) => void;
  /** Navigate to the post-match replay (rendered as a CTA on GameOverView). */
  onWatchReplay?: (gameId: string) => void;
  /** Open the "Challenge a friend" flow (rendered as a CTA on GameOverView). */
  onChallengeFriend?: () => void;
  /** Guest viewers only: leave the game cleanly and open the account-upgrade page. */
  onUpgradeAccount?: () => void;
  /** Clear the whole animation backlog at once (combat modals + theater + globe). */
  onSkipAll?: () => void;
  /** Total queued items; gates the in-modal "Skip all" button (shown when > 1). */
  backlogCount?: number;
  mapNameLookup?: MapNameLookup | null;
  players?: Array<{ player_id: string; username: string }>;
}

export default function ActionModal({
  data,
  onDismiss,
  onResignConfirm,
  onRepeatCombat,
  onRematch,
  onWatchReplay,
  onChallengeFriend,
  onUpgradeAccount,
  onSkipAll,
  backlogCount = 0,
  mapNameLookup,
  players,
}: ActionModalProps) {
  const isGameOver = data?.type === 'game_over';
  const isResign = data?.type === 'resign_confirm';

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isGameOver || isResign) return;
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onDismiss();
    }
  }, [onDismiss, isGameOver, isResign]);

  useEffect(() => {
    if (!data) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, handleKeyDown]);

  if (!data) return null;

  const allowBackdropDismiss = !isGameOver && !isResign;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-modal-backdrop p-4 pt-safe pb-safe px-safe"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)' }}
      onClick={allowBackdropDismiss ? onDismiss : undefined}
    >
      <div
        className="relative px-6 sm:px-8 py-8 rounded-2xl border border-white/[0.08] shadow-2xl animate-modal-in max-h-[min(90vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem))] overflow-y-auto w-full min-w-0 max-w-[min(100%,42rem)]"
        style={{
          background: 'linear-gradient(180deg, rgba(30,35,50,0.97) 0%, rgba(15,17,23,0.98) 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {data.type === 'combat' && (
          <CombatResultView
            result={data.result}
            perspective={data.perspective}
            onDismiss={onDismiss}
            repeatAttack={data.repeatAttack}
            onRepeatAttack={
              data.repeatAttack && onRepeatCombat
                ? () => {
                    onDismiss();
                    onRepeatCombat(data.repeatAttack!.fromId, data.repeatAttack!.toId);
                  }
                : undefined
            }
            onSkipAll={onSkipAll}
            backlogCount={backlogCount}
          />
        )}
        {data.type === 'turn_summary' && (
          <TurnSummaryView
            key={`turn-summary-${data.turnNumber}-${data.playerName}-${data.isOwnTurn ? 'me' : 'opp'}-${data.combats.length}-${data.reinforcements?.length ?? 0}-${data.fortifications?.length ?? 0}-${(data.combats ?? []).map((c) => `${c.fromName ?? ''}->${c.toName ?? ''}`).join(';')}`}
            data={data}
            onDismiss={onDismiss}
          />
        )}
        {data.type === 'game_over' && <GameOverView data={data} onDismiss={onDismiss} onRematch={onRematch} onWatchReplay={onWatchReplay} onChallengeFriend={onChallengeFriend} onUpgradeAccount={onUpgradeAccount} />}
        {data.type === 'elimination' && (
          <EliminationView
            data={data}
            onDismiss={onDismiss}
            mapNameLookup={mapNameLookup}
            players={players}
          />
        )}
        {data.type === 'resign_confirm' && <ResignConfirmView onConfirm={() => { onResignConfirm?.(); onDismiss(); }} onCancel={onDismiss} />}
        {data.type === 'draft_summary' && <DraftSummaryView data={data} onDismiss={onDismiss} />}
      </div>
    </div>
  );
}

// ─── Action Notification (auto-dismiss, non-blocking) ──────────────────────

interface ActionNotificationProps {
  data: NotificationData | null;
}

const NOTIF_ICONS = {
  shield: <Shield className="w-4 h-4" />,
  arrow:  <ArrowRight className="w-4 h-4" />,
  sword:  <Sword className="w-4 h-4" />,
};

export function ActionNotification({ data }: ActionNotificationProps) {
  const [phase, setPhase] = useState<'in' | 'out' | 'hidden'>('hidden');

  useEffect(() => {
    if (!data) { setPhase('hidden'); return; }
    setPhase('in');
    const outTimer = setTimeout(() => setPhase('out'), 1800);
    const hideTimer = setTimeout(() => setPhase('hidden'), 2200);
    return () => { clearTimeout(outTimer); clearTimeout(hideTimer); };
  }, [data]);

  if (phase === 'hidden' || !data) return null;

  return (
    <div className="fixed top-14 left-1/2 z-40 pointer-events-none">
      <div
        className={clsx(
          'px-6 py-3 rounded-xl border shadow-2xl',
          phase === 'in' ? 'animate-notif-in' : 'animate-notif-out',
          data.accentBg,
          data.accentBorder,
        )}
        style={{ backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className={data.accentText}>{NOTIF_ICONS[data.icon]}</span>
          <div>
            <p className="text-white font-semibold text-sm">{data.text}</p>
            {data.subtext && <p className="text-white/40 text-xs mt-0.5">{data.subtext}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
