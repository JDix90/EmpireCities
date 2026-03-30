import { useEffect, useState, useCallback, useRef } from 'react';
import { CombatResult } from '../../store/gameStore';
import { Sword, Shield, ArrowRight, Crown, Skull, Flag, ChevronRight, ChevronLeft, Plus, Trophy, LogOut, Eye } from 'lucide-react';
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

export interface GameOverModalData {
  type: 'game_over';
  isWinner: boolean;
  winnerName: string;
  winnerColor: string;
  turnCount: number;
  players: Array<{
    player_id: string;
    username: string;
    color: string;
    territory_count: number;
    is_eliminated: boolean;
    is_ai: boolean;
  }>;
}

export interface EliminationModalData {
  type: 'elimination';
  eliminatedName: string;
  eliminatorName: string;
  isSelf: boolean;
}

export interface ResignModalData {
  type: 'resign_confirm';
}

export type ModalData = CombatModalData | TurnSummaryModalData | GameOverModalData | EliminationModalData | ResignModalData;

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
        <div className="space-y-2">
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
        <div>
          <div className="grid grid-cols-3 gap-3 mb-5">
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
          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
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
        <div className="space-y-2">
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

  const isLastSlide = currentSlide === slides.length - 1;
  const slide = slides[currentSlide];

  return (
    <div className="w-full max-w-lg" onClick={() => setAutoPaused(true)}>
      {/* Header */}
      <div className="text-center mb-5">
        <div className={clsx(
          'inline-flex items-center gap-2.5 px-5 py-2 rounded-full border mb-3',
          isOwnTurn ? 'bg-cc-gold/10 border-cc-gold/25' : 'bg-white/5 border-white/10'
        )}>
          {!isOwnTurn && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: playerColor }} />}
          <span className={clsx(
            'text-xs font-bold tracking-[0.2em] uppercase',
            isOwnTurn ? 'text-cc-gold' : 'text-white/60'
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
      <div className="relative overflow-hidden min-h-[200px]">
        <div
          key={slide.id}
          className={clsx(
            'transition-all duration-300',
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
            disabled={currentSlide === 0}
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
                  i === currentSlide ? 'bg-white w-6' : 'bg-white/25 hover:bg-white/40'
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

// ─── Game Over View ─────────────────────────────────────────────────────────

function GameOverView({ data, onDismiss }: { data: GameOverModalData; onDismiss: () => void }) {
  const [showContent, setShowContent] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShowContent(true), 300); return () => clearTimeout(t); }, []);

  const sortedPlayers = [...data.players].sort((a, b) => b.territory_count - a.territory_count);

  return (
    <div className="w-full max-w-md text-center">
      {/* Trophy / Skull Animation */}
      <div className={clsx('mb-6 transition-all duration-700', showContent ? 'opacity-100 scale-100' : 'opacity-0 scale-50')}>
        {data.isWinner ? (
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
        data.isWinner ? 'text-yellow-400' : 'text-red-400'
      )}>
        {data.isWinner ? 'Victory!' : 'Defeat'}
      </h2>
      <p className={clsx(
        'text-white/50 text-sm mb-6 transition-all duration-500 delay-300',
        showContent ? 'opacity-100' : 'opacity-0'
      )}>
        {data.isWinner
          ? 'You have conquered the world!'
          : `${data.winnerName} has won the game`}
      </p>

      {/* Stats */}
      <div className={clsx(
        'grid grid-cols-2 gap-3 mb-6 transition-all duration-500 delay-400',
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
      </div>

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
              <span className={clsx('flex-1 text-left truncate', i === 0 ? 'text-yellow-300 font-semibold' : 'text-white/60')}>
                {p.username} {p.is_ai ? <span className="text-white/25 text-xs">(AI)</span> : ''}
              </span>
              <span className="text-white/30 text-xs tabular-nums">{p.territory_count}T</span>
              {p.is_eliminated && <span className="text-red-400/50 text-xs">Eliminated</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className={clsx(
        'flex gap-3 transition-all duration-500 delay-600',
        showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      )}>
        <button
          onClick={onDismiss}
          className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10
                     text-white font-medium transition-all flex items-center justify-center gap-2"
        >
          Return to Lobby
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Elimination View ───────────────────────────────────────────────────────

function EliminationView({ data, onDismiss }: { data: EliminationModalData; onDismiss: () => void }) {
  return (
    <div className="w-full max-w-sm text-center">
      <Skull className={clsx('w-14 h-14 mx-auto mb-4', data.isSelf ? 'text-red-400' : 'text-white/30')} />
      <h2 className={clsx('text-2xl font-bold font-display mb-2', data.isSelf ? 'text-red-400' : 'text-white')}>
        {data.isSelf ? 'You Have Been Eliminated' : 'Player Eliminated'}
      </h2>
      <p className="text-white/50 text-sm mb-6">
        {data.isSelf
          ? `${data.eliminatorName} has conquered your last territory.`
          : `${data.eliminatedName} was eliminated by ${data.eliminatorName}.`}
      </p>
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
    <div className="w-full max-w-sm text-center">
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

// ─── Main Modal Overlay ────────────────────────────────────────────────────

interface ActionModalProps {
  data: ModalData | null;
  onDismiss: () => void;
  onResignConfirm?: () => void;
}

export default function ActionModal({ data, onDismiss, onResignConfirm }: ActionModalProps) {
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
      className="fixed inset-0 z-50 flex items-center justify-center animate-modal-backdrop"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)' }}
      onClick={allowBackdropDismiss ? onDismiss : undefined}
    >
      <div
        className="relative px-8 py-8 rounded-2xl border border-white/[0.08] shadow-2xl animate-modal-in max-h-[90vh] overflow-y-auto"
        style={{
          background: 'linear-gradient(180deg, rgba(30,35,50,0.97) 0%, rgba(15,17,23,0.98) 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {data.type === 'combat' && <CombatResultView result={data.result} perspective={data.perspective} onDismiss={onDismiss} />}
        {data.type === 'turn_summary' && <TurnSummaryView data={data} onDismiss={onDismiss} />}
        {data.type === 'game_over' && <GameOverView data={data} onDismiss={onDismiss} />}
        {data.type === 'elimination' && <EliminationView data={data} onDismiss={onDismiss} />}
        {data.type === 'resign_confirm' && <ResignConfirmView onConfirm={() => { onResignConfirm?.(); onDismiss(); }} onCancel={onDismiss} />}
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
