import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { useGameStore } from '../store/gameStore';
import { useCombatExplainEnabled } from '../store/featureFlagsStore';

export interface AttackOddsPair {
  fromId: string;
  toId: string;
}

/** The key a pair's odds are filed under. */
export const attackOddsKey = (fromId: string, toId: string) => `${fromId}>${toId}`;

let nextRequest = 0;

/**
 * The chance of taking each target in `pairs` if the attack is pressed to the
 * end (combat_explain_enabled): the server's exact odds (`game:attack_odds`),
 * the ones the bots plan with. Asked again whenever an army on either side of
 * a pair changes, so the number is the one for the board as it stands; until
 * the answer comes a pair has no entry rather than a stale one. The server
 * answers only on the asker's own turn in the attack phase and leaves out
 * targets fog hides, which just get no number.
 */
export function useAttackOdds(pairs: AttackOddsPair[]): Map<string, number> {
  const enabled = useCombatExplainEnabled();
  const gameId = useGameStore((s) => (s.replayMode ? null : s.gameState?.game_id ?? null));
  const territories = useGameStore((s) => s.gameState?.territories);
  const phase = useGameStore((s) => s.gameState?.phase);
  const turnIndex = useGameStore((s) => s.gameState?.current_player_index);

  // What the odds depend on: the pairs and the armies on both ends of each.
  const signature = useMemo(() => {
    if (!enabled || !gameId || phase !== 'attack' || pairs.length === 0) return '';
    const units = (id: string) => territories?.[id]?.unit_count ?? '?';
    return pairs
      .map((p) => `${attackOddsKey(p.fromId, p.toId)}:${units(p.fromId)}:${units(p.toId)}`)
      .sort()
      .join('|') + `#${turnIndex ?? ''}`;
  }, [enabled, gameId, phase, pairs, territories, turnIndex]);

  const [odds, setOdds] = useState<Map<string, number>>(() => new Map());
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;

  useEffect(() => {
    setOdds((prev) => (prev.size ? new Map() : prev));
    if (!signature || !gameId) return;
    const requestId = `odds-${++nextRequest}`;
    const socket = getSocket();
    const onOdds = (payload: { gameId?: string; requestId?: string; odds?: Array<{ fromId: string; toId: string; p: number }> }) => {
      if (payload?.gameId !== gameId || payload.requestId !== requestId || !Array.isArray(payload.odds)) return;
      const next = new Map<string, number>();
      for (const o of payload.odds) {
        if (typeof o?.p === 'number' && Number.isFinite(o.p)) next.set(attackOddsKey(o.fromId, o.toId), o.p);
      }
      setOdds(next);
    };
    socket.on('game:attack_odds', onOdds);
    socket.emit('game:attack_odds', {
      gameId,
      requestId,
      pairs: pairsRef.current.map(({ fromId, toId }) => ({ fromId, toId })),
    });
    return () => {
      socket.off('game:attack_odds', onOdds);
    };
  }, [signature, gameId]);

  return odds;
}

/** "72%"; under 1% and over 99% say so rather than round to a certainty. */
export function formatWinChance(p: number): string {
  if (p > 0 && p < 0.01) return '<1%';
  if (p < 1 && p > 0.99) return '>99%';
  return `${Math.round(p * 100)}%`;
}

/** Text colour for a chance on the dark panels: good, a gamble, or poor. */
export function winChanceTone(p: number): string {
  return p >= 0.7 ? 'text-emerald-300' : p >= 0.4 ? 'text-amber-200' : 'text-rose-300';
}

/** What the number means, for a title or screen reader. */
export const WIN_CHANCE_HINT =
  'Chance to take it if you keep attacking until it falls or you are down to one unit';
