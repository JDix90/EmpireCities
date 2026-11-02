import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Clock, Swords, X } from 'lucide-react';
import { getSocket } from '../../services/socket';
import { usePlayOnStore, type PlayOnOffer, type PlayOnVoteView } from '../../store/playOnStore';

/** Seconds left until `at`, ticking once a second while `on`. */
function useSecondsLeft(at: number | null | undefined, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on, at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

const UNRANKED_LINE = 'Unranked, with no extra rewards: the win already recorded stands.';

function Countdown({ seconds }: { seconds: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-bf-muted tabular-nums" aria-label={`${seconds} seconds left`}>
      <Clock className="w-3.5 h-3.5" aria-hidden />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function VoterList({ vote, viewerId }: { vote: PlayOnVoteView; viewerId?: string }) {
  return (
    <ul className="space-y-1 text-sm">
      {vote.voters.map((v) => (
        <li key={v.player_id} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.color }} aria-hidden />
            <span className="truncate text-bf-text">{v.player_id === viewerId ? 'You' : v.username}</span>
          </span>
          {v.vote === true ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check className="w-3.5 h-3.5" aria-hidden />Yes</span>
          ) : (
            <span className="text-xs text-bf-muted">Deciding…</span>
          )}
        </li>
      ))}
      {vote.bot_count > 0 && (
        <li className="flex items-center justify-between gap-3 text-bf-muted">
          <span>{vote.bot_count === 1 ? 'The bot' : `${vote.bot_count} bots`}</span>
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check className="w-3.5 h-3.5" aria-hidden />Always yes</span>
        </li>
      )}
    </ul>
  );
}

const RESULT_LINE: Record<'declined' | 'expired' | 'failed', string> = {
  declined: 'Not everyone wants to keep playing, so the game ends here.',
  expired: 'Not everyone answered in time, so the game ends here.',
  failed: 'The game couldn’t be continued. The result stands.',
};

/**
 * Play on after a win (`play_on_enabled`), on the Victory and Defeat screens
 * of a game that can be played on (server `game:over` `play_on`).
 *
 * The winner can ask, once, while the offer lasts; everyone else still in is
 * asked to say yes or no within a minute, and sees who has answered. Bots
 * always say yes, so against bots alone the game goes straight on. When the
 * table agrees, `onContinue` takes everyone still in to the new game; a player
 * already out of it can watch.
 */
export default function PlayOnPanel({
  gameId,
  offer,
  viewerId,
  onContinue,
  className,
}: {
  gameId: string;
  offer: PlayOnOffer;
  viewerId?: string;
  onContinue: (newGameId: string) => void;
  className?: string;
}) {
  const store = usePlayOnStore();
  // Only this game's vote: the store may still hold one from a game before it.
  const ours = store.gameId === gameId;
  const vote = ours ? store.vote : null;
  const result = ours ? store.result : null;
  const { sending, setSending } = store;
  const stillIn = !!viewerId && offer.human_ids.includes(viewerId);
  const canAsk = !!viewerId && offer.proposer_ids.includes(viewerId);
  const offerSeconds = useSecondsLeft(offer.expires_at, canAsk && !vote && !result);
  const voteSeconds = useSecondsLeft(vote?.expires_at, !!vote && !result);

  // A yes carries everyone still in straight into the game.
  useEffect(() => {
    if (result?.outcome === 'accepted' && result.new_game_id && stillIn) onContinue(result.new_game_id);
  }, [result, stillIn, onContinue]);

  const ask = () => {
    setSending(true);
    getSocket().emit('game:play_on_propose', { gameId });
  };
  const answer = (yes: boolean) => {
    setSending(true);
    getSocket().emit('game:play_on_vote', { gameId, yes });
  };

  const box = (children: React.ReactNode, testId: string) => (
    <div
      className={clsx('rounded-xl border border-bf-gold/40 bg-bf-gold/[0.06] p-4 text-left space-y-3', className)}
      data-testid={testId}
      role="region"
      aria-label="Play on"
    >
      {children}
    </div>
  );

  if (result) {
    if (result.outcome === 'accepted') {
      return box(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-bf-text">
            {stillIn ? 'Everyone said yes. Taking you back in…' : 'The table kept playing for total domination.'}
          </p>
          {result.new_game_id && (
            <button
              type="button"
              onClick={() => onContinue(result.new_game_id!)}
              className="tap-target rounded-lg border border-bf-gold/40 bg-bf-gold/20 px-3 py-2 text-sm font-medium text-bf-gold hover:bg-bf-gold/30"
            >
              {stillIn ? 'Go to the game' : 'Watch'}
            </button>
          )}
        </div>,
        'play-on-accepted',
      );
    }
    return box(<p className="text-sm text-bf-muted">{RESULT_LINE[result.outcome]}</p>, 'play-on-ended');
  }

  if (vote) {
    const mine = viewerId ? vote.voters.find((v) => v.player_id === viewerId) : undefined;
    const asked = vote.proposer_id === viewerId;
    return box(
      <>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-bf-text">
            {asked
              ? 'You asked to keep playing for total domination.'
              : `${vote.proposer_name} wants to keep playing for total domination.`}
          </p>
          <Countdown seconds={voteSeconds} />
        </div>
        {mine && mine.vote === null ? (
          <>
            <p className="text-xs text-bf-muted">{UNRANKED_LINE} Everyone still in has to agree.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => answer(true)}
                disabled={sending}
                className="tap-target flex-1 rounded-lg border border-bf-gold/40 bg-bf-gold/20 px-3 py-2 text-sm font-semibold text-bf-gold hover:bg-bf-gold/30 disabled:opacity-60"
              >
                Keep playing
              </button>
              <button
                type="button"
                onClick={() => answer(false)}
                disabled={sending}
                className="tap-target flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1"><X className="w-3.5 h-3.5" aria-hidden />No thanks</span>
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-bf-muted">{mine || asked ? 'Waiting for everyone to answer…' : 'The players still in are deciding.'}</p>
        )}
        <VoterList vote={vote} viewerId={viewerId} />
      </>,
      'play-on-vote',
    );
  }

  if (!canAsk || offerSeconds <= 0) return null;
  const botsOnly = offer.human_ids.length <= 1;
  return box(
    <>
      <div className="flex items-start gap-3">
        <Swords className="mt-0.5 w-5 h-5 shrink-0 text-bf-gold" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-bf-text">Keep playing for total domination?</p>
          <p className="text-xs text-bf-muted">
            {botsOnly
              ? 'Take the rest of the board. The bots always agree, so you go straight back in.'
              : 'Ask everyone still in to play on for the whole board. They all have to agree.'}{' '}
            {UNRANKED_LINE}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={ask}
        disabled={sending}
        className="tap-target w-full rounded-lg border border-bf-gold/40 bg-bf-gold/20 px-3 py-2 text-sm font-semibold text-bf-gold hover:bg-bf-gold/30 disabled:opacity-60"
      >
        {sending ? 'Asking…' : botsOnly ? 'Keep playing' : 'Ask to keep playing'}
      </button>
    </>,
    'play-on-offer',
  );
}
