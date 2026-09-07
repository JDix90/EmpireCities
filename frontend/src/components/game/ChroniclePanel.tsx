import { useEffect, useState } from 'react';
import { ScrollText, Flag, Crown, Skull, Swords, Sparkles, Landmark, Milestone } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../services/api';

export type ChronicleKind =
  | 'opening'
  | 'first_blood'
  | 'region_secured'
  | 'capital_fell'
  | 'era_advanced'
  | 'elimination'
  | 'decisive_turn'
  | 'conclusion';

export interface ChronicleEntry {
  turn: number;
  date: string;
  kind: ChronicleKind;
  headline: string;
  detail?: string;
  playerId?: string;
  playerName?: string;
  playerColor?: string;
}

const ICONS: Record<ChronicleKind, typeof Flag> = {
  opening: Flag,
  first_blood: Swords,
  region_secured: Landmark,
  capital_fell: Skull,
  era_advanced: Sparkles,
  elimination: Skull,
  decisive_turn: Milestone,
  conclusion: Crown,
};

/**
 * One fetch of a finished match's chronicle, shared by everything that shows
 * one. Non-participants get a 403 and unfinished games a 409; neither is
 * something to report at the viewer, so both land on `failed` and every caller
 * renders nothing.
 */
export function useChronicle(gameId: string | undefined): {
  entries: ChronicleEntry[] | null;
  failed: boolean;
} {
  const [entries, setEntries] = useState<ChronicleEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setEntries(null);
    setFailed(false);
    api
      .get<{ entries: ChronicleEntry[] }>(`/games/${gameId}/chronicle`)
      .then((res) => { if (!cancelled) setEntries(res.data.entries ?? []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [gameId]);

  return { entries, failed };
}

/**
 * The dated timeline itself, without any surrounding chrome.
 *
 * The date column down the left is the whole difference between "turn 9: Rome
 * took Lusitania" and "1244 — Rome secures Iberia". Where a jump handler is
 * given, entries scrub playback to their turn, so the list doubles as a table
 * of contents for the replay beside it.
 */
export function ChronicleList({
  entries,
  currentTurn,
  onJumpToTurn,
}: {
  entries: ChronicleEntry[];
  currentTurn?: number;
  onJumpToTurn?: (turn: number) => void;
}) {
  return (
    <ol className="divide-y divide-bf-border/50">
      {entries.map((entry, i) => {
        const Icon = ICONS[entry.kind] ?? Flag;
        const isHere = currentTurn != null && entry.turn === currentTurn;
        const Row = onJumpToTurn ? 'button' : 'div';
        return (
          <li key={`${entry.turn}-${entry.kind}-${i}`}>
            <Row
              {...(onJumpToTurn
                ? { type: 'button' as const, onClick: () => onJumpToTurn(entry.turn) }
                : {})}
              className={clsx(
                'w-full text-left flex items-start gap-3 px-4 py-3 transition-colors',
                onJumpToTurn && 'hover:bg-bf-border/30 min-h-[44px]',
                isHere && 'bg-bf-gold/10',
              )}
              data-testid="chronicle-entry"
            >
              <span
                className="shrink-0 w-16 pt-0.5 text-xs tabular-nums text-bf-gold/90 font-medium"
                title={`Turn ${entry.turn}`}
              >
                {entry.date}
              </span>
              <Icon
                className="w-4 h-4 shrink-0 mt-0.5"
                style={entry.playerColor ? { color: entry.playerColor } : undefined}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-sm text-bf-text">{entry.headline}</span>
                {entry.detail && (
                  <span className="block text-xs text-bf-muted mt-0.5">{entry.detail}</span>
                )}
              </span>
            </Row>
          </li>
        );
      })}
    </ol>
  );
}

/** The chronicle in its own card — the replay page's sidebar form. */
export default function ChroniclePanel({
  gameId,
  currentTurn,
  onJumpToTurn,
  className,
}: {
  gameId: string;
  /** Highlights the entry the playback is sitting on. */
  currentTurn?: number;
  onJumpToTurn?: (turn: number) => void;
  className?: string;
}) {
  const { entries, failed } = useChronicle(gameId);

  if (failed || (entries && entries.length === 0)) return null;

  return (
    <div className={clsx('card p-0 overflow-hidden', className)} data-testid="chronicle-panel">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bf-border">
        <ScrollText className="w-4 h-4 text-bf-gold" aria-hidden />
        <h3 className="font-display text-sm text-bf-gold tracking-widest">CHRONICLE</h3>
      </div>
      {!entries ? (
        <p className="text-bf-muted text-sm px-4 py-6 text-center">Reading the record…</p>
      ) : (
        <ChronicleList entries={entries} currentTurn={currentTurn} onJumpToTurn={onJumpToTurn} />
      )}
    </div>
  );
}
