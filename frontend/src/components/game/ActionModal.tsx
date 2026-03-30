import { useEffect, useState, useCallback } from 'react';
import { CombatResult } from '../../store/gameStore';
import { Sword, Shield, ArrowRight, Crown, Skull, Flag, ChevronRight, Plus } from 'lucide-react';
import clsx from 'clsx';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReinforcementEntry { territoryName: string; units: number }
export interface FortifyEntry { fromName: string; toName: string; units: number }

export interface CombatModalData {
  type: 'combat';
  result: CombatResult;
  perspective?: 'attacker' | 'defender';
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

export type ModalData = CombatModalData | TurnSummaryModalData;

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

function AnimatedDie({ value, index, variant }: { value: number; index: number; variant: 'attacker' | 'defender' }) {
  const [display, setDisplay] = useState(Math.ceil(Math.random() * 6));
  const [settled, setSettled] = useState(false);

  useEffect(() => {
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
  }, [value, index]);

  const isAttacker = variant === 'attacker';
  return (
    <div
      className={clsx(
        'w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold font-mono',
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

function DieFace({ value, index, variant }: { value: number; index: number; variant: 'attacker' | 'defender' }) {
  return <AnimatedDie value={value} index={index} variant={variant} />;
}

// ─── Combat Result View ────────────────────────────────────────────────────

function CombatResultView({ result, perspective, onDismiss }: { result: CombatResult; perspective?: 'attacker' | 'defender'; onDismiss: () => void }) {
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    const maxDice = Math.max(result.attacker_rolls.length, result.defender_rolls.length);
    const settleTime = (8 + (maxDice - 1) * 4) * 55 + 500;
    const timer = setTimeout(() => setShowResult(true), settleTime);
    return () => clearTimeout(timer);
  }, [result]);

  const isDefending = perspective === 'defender';
  const headerLabel = isDefending ? 'Incoming Attack!' : perspective === 'attacker' ? 'Your Attack' : 'Battle';
  const headerBg = isDefending ? 'bg-orange-500/15 border-orange-500/25' : 'bg-red-500/15 border-red-500/25';
  const headerText = isDefending ? 'text-orange-300' : 'text-red-300';
  const headerIcon = isDefending ? 'text-orange-400' : 'text-red-400';

  return (
    <div className="w-full max-w-md">
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

      {/* Dice Area */}
      <div className="flex gap-4 mb-8">
        {/* Attacker Column */}
        <div className="flex-1">
          <p className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-3 text-center">
            {result.attackerName ?? 'Attacker'}
          </p>
          <div className="flex justify-center gap-2.5">
            {result.attacker_rolls.map((roll, i) => (
              <DieFace key={i} value={roll} index={i} variant="attacker" />
            ))}
          </div>
        </div>

        {/* VS */}
        <div className="flex items-center pt-6">
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
        </div>

        {/* Defender Column */}
        <div className="flex-1">
          <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3 text-center">
            {result.defenderName ?? 'Defender'}
          </p>
          <div className="flex justify-center gap-2.5">
            {result.defender_rolls.map((roll, i) => (
              <DieFace key={i} value={roll} index={i} variant="defender" />
            ))}
          </div>
        </div>
      </div>

      {/* Result Panel — slides in after dice settle */}
      <div className={clsx(
        'transition-all duration-500 ease-out',
        showResult ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
      )}>
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
                  <span className="text-red-300 font-bold text-lg tracking-wide font-display">Territory Lost!</span>
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

        {/* Continue */}
        <button
          onClick={onDismiss}
          className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/[0.15] border border-white/10
                     text-white font-medium transition-all duration-200
                     flex items-center justify-center gap-2 group"
        >
          Continue
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
}

// ─── Turn Summary View ─────────────────────────────────────────────────────

function TurnSummaryView({ data, onDismiss }: { data: TurnSummaryModalData; onDismiss: () => void }) {
  const { playerName, playerColor, turnNumber, combats, isOwnTurn, reinforcements, fortifications } = data;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const totalBattles = combats.length;
  const captures = combats.filter(c => c.territory_captured).length;
  const totalEnemyDestroyed = combats.reduce((s, c) => s + c.defender_losses, 0);
  const totalOwnLost = combats.reduce((s, c) => s + c.attacker_losses, 0);
  const totalReinforced = reinforcements?.reduce((s, r) => s + r.units, 0) ?? 0;
  const totalFortified = fortifications?.reduce((s, f) => s + f.units, 0) ?? 0;
  const hasAnyActivity = totalBattles > 0 || totalReinforced > 0 || totalFortified > 0;

  const headerBadgeBg = isOwnTurn ? 'bg-cc-gold/15' : playerColor + '18';
  const headerBadgeBorder = isOwnTurn ? 'border-cc-gold/30' : playerColor + '35';
  const headerBadgeText = isOwnTurn ? 'text-cc-gold' : playerColor;

  return (
    <div className={clsx(
      'w-full max-w-lg transition-all duration-500',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
    )}>
      {/* Header */}
      <div className="text-center mb-6">
        <div
          className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full border mb-4"
          style={{ backgroundColor: headerBadgeBg, borderColor: headerBadgeBorder }}
        >
          {!isOwnTurn && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: playerColor }} />}
          <span
            className="text-sm font-bold tracking-[0.15em] uppercase"
            style={{ color: headerBadgeText }}
          >
            {isOwnTurn ? 'Your Turn Complete' : 'Turn Complete'}
          </span>
        </div>
        <h2 className="text-2xl font-bold text-white font-display">
          {isOwnTurn ? 'Your Turn Summary' : <>{playerName}&rsquo;s Turn</>}
        </h2>
        <p className="text-white/35 text-sm mt-1">Turn {turnNumber}</p>
      </div>

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {/* ── Reinforcements (own turn only) ──────────────────────── */}
        {isOwnTurn && reinforcements && reinforcements.length > 0 && (
          <div className="mb-5">
            <SectionLabel icon={<Shield className="w-3.5 h-3.5 text-emerald-400" />} label={`Reinforcements — ${totalReinforced} troops deployed`} />
            <div className="space-y-1">
              {reinforcements.map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-emerald-500/[0.06] text-sm">
                  <Plus className="w-3.5 h-3.5 text-emerald-400/60 shrink-0" />
                  <span className="text-white/60 flex-1 truncate">{r.territoryName}</span>
                  <span className="text-emerald-400 text-xs font-semibold shrink-0">+{r.units}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Battles ─────────────────────────────────────────────── */}
        {totalBattles > 0 && (
          <div className="mb-5">
            {isOwnTurn && <SectionLabel icon={<Sword className="w-3.5 h-3.5 text-red-400" />} label={`Battles — ${totalBattles} fought`} />}
            {!isOwnTurn && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatCard icon={<Sword className="w-5 h-5 text-red-400" />} value={totalBattles} label={totalBattles === 1 ? 'Battle' : 'Battles'} />
                <StatCard icon={<Flag className="w-5 h-5 text-yellow-400" />} value={captures} label={captures === 1 ? 'Capture' : 'Captures'} />
                <StatCard icon={<Skull className="w-5 h-5 text-white/50" />} value={totalEnemyDestroyed} label="Destroyed" />
              </div>
            )}

            {isOwnTurn && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatCard icon={<Sword className="w-5 h-5 text-red-400" />} value={totalBattles} label={totalBattles === 1 ? 'Battle' : 'Battles'} />
                <StatCard icon={<Flag className="w-5 h-5 text-yellow-400" />} value={captures} label={captures === 1 ? 'Capture' : 'Captures'} />
                <StatCard icon={<Skull className="w-5 h-5 text-white/50" />} value={totalOwnLost} label="Lost" />
              </div>
            )}

            <div className="max-h-36 overflow-y-auto space-y-1.5">
              {combats.map((c, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/[0.04] text-sm">
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
              ))}
            </div>
          </div>
        )}

        {/* ── Fortifications (own turn only) ──────────────────────── */}
        {isOwnTurn && fortifications && fortifications.length > 0 && (
          <div className="mb-5">
            <SectionLabel icon={<ArrowRight className="w-3.5 h-3.5 text-sky-400" />} label={`Fortifications — ${totalFortified} troops moved`} />
            <div className="space-y-1">
              {fortifications.map((f, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-sky-500/[0.06] text-sm">
                  <ArrowRight className="w-3.5 h-3.5 text-sky-400/60 shrink-0" />
                  <span className="text-white/60 flex-1 truncate">{f.fromName} &rarr; {f.toName}</span>
                  <span className="text-sky-400 text-xs font-semibold shrink-0">{f.units}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── No activity (opponent or own) ───────────────────────── */}
        {!hasAnyActivity && (
          <div className="mb-5 p-8 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
            <Shield className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40 text-sm font-medium">
              {isOwnTurn ? 'No actions this turn' : 'No battles this turn'}
            </p>
            <p className="text-white/20 text-xs mt-1">Reinforced and fortified positions</p>
          </div>
        )}

        {/* ── Net Impact Tags ─────────────────────────────────────── */}
        {hasAnyActivity && (
          <div className="flex gap-2 mb-5 flex-wrap">
            {totalReinforced > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300/80 text-xs">
                +{totalReinforced} reinforced
              </span>
            )}
            {totalOwnLost > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-300/80 text-xs">
                &minus;{totalOwnLost} troop{totalOwnLost !== 1 ? 's' : ''} lost
              </span>
            )}
            {totalEnemyDestroyed > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300/80 text-xs">
                {totalEnemyDestroyed} enemy destroyed
              </span>
            )}
            {captures > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-500/10 text-yellow-300/80 text-xs">
                +{captures} territor{captures !== 1 ? 'ies' : 'y'}
              </span>
            )}
            {totalFortified > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-300/80 text-xs">
                {totalFortified} troops moved
              </span>
            )}
          </div>
        )}
      </div>

      {/* Continue */}
      <button
        onClick={onDismiss}
        className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/[0.15] border border-white/10
                   text-white font-medium transition-all duration-200
                   flex items-center justify-center gap-2 group"
      >
        Continue
        <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      {icon}
      <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">{label}</span>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-center">
      <div className="flex justify-center mb-1.5">{icon}</div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-white/35 text-xs">{label}</p>
    </div>
  );
}

// ─── Main Modal Overlay ────────────────────────────────────────────────────

interface ActionModalProps {
  data: ModalData | null;
  onDismiss: () => void;
}

export default function ActionModal({ data, onDismiss }: ActionModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onDismiss();
    }
  }, [onDismiss]);

  useEffect(() => {
    if (!data) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, handleKeyDown]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-modal-backdrop"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onDismiss}
    >
      <div
        className="relative px-8 py-8 rounded-2xl border border-white/[0.08] shadow-2xl animate-modal-in"
        style={{
          background: 'linear-gradient(180deg, rgba(30,35,50,0.97) 0%, rgba(15,17,23,0.98) 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {data.type === 'combat' && <CombatResultView result={data.result} perspective={data.perspective} onDismiss={onDismiss} />}
        {data.type === 'turn_summary' && <TurnSummaryView data={data} onDismiss={onDismiss} />}
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
