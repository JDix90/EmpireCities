import { useState } from 'react';
import { POLICIES, type PolicyName, type SoloSetup } from '../../warfront/soloMatch';

/**
 * Choosing who to play against, before the match opens.
 *
 * Decision 32 put the lab's bots in as the live solo opponent so that one person can play
 * a full match, and this is the whole of that choice: how many seats, and which policy
 * takes each of the others. Every opponent says what it does, because a policy name a
 * player cannot read is a coin flip rather than a decision.
 */

export interface WarfrontMatchSetupProps {
  onStart: (setup: SoloSetup) => void;
}

export default function WarfrontMatchSetup({ onStart }: WarfrontMatchSetupProps) {
  const [seats, setSeats] = useState(2);
  const [opponents, setOpponents] = useState<PolicyName[]>(['colonist', 'colonist', 'colonist']);

  const setOpponent = (index: number, name: PolicyName) => {
    setOpponents((prev) => prev.map((p, i) => (i === index ? name : p)));
  };

  return (
    <div className="flex h-full w-full items-center justify-center px-6">
      <div
        data-testid="warfront-setup"
        className="w-full max-w-xl rounded-xl border border-bf-border bg-cc-panel/50 p-5 text-[12px]"
      >
        <h2 className="text-sm font-semibold text-bf-text">Start a match</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-bf-muted">
          You take the first seat. The rest are played by the same policies the headless lab measures — no netcode
          needed, and no second person.
        </p>

        <div className="mt-4">
          <div className="mb-1 text-bf-muted">Seats</div>
          <div className="flex gap-1">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSeats(n)}
                className={[
                  'rounded border px-3 py-1',
                  seats === n
                    ? 'border-bf-gold bg-bf-gold/20 text-bf-gold'
                    : 'border-bf-border text-bf-text hover:border-bf-gold',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
            <span className="ml-2 self-center text-[11px] text-bf-muted">
              {seats === 2 ? 'Rome against Gaul · 20 minutes' : `${seats} seats · 25 minutes`}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-bf-muted">Opponents</div>
          {Array.from({ length: seats - 1 }, (_, i) => (
            <div key={i}>
              <div className="mb-1 flex flex-wrap gap-1">
                {POLICIES.map((policy) => (
                  <button
                    key={policy.name}
                    type="button"
                    aria-label={`Seat ${i + 2}: ${policy.label}`}
                    onClick={() => setOpponent(i, policy.name)}
                    className={[
                      'rounded border px-2 py-1',
                      opponents[i] === policy.name
                        ? 'border-bf-gold bg-bf-gold/20 text-bf-gold'
                        : 'border-bf-border text-bf-text hover:border-bf-gold',
                    ].join(' ')}
                  >
                    {policy.label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-bf-muted">
                {POLICIES.find((p) => p.name === opponents[i])?.blurb}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onStart({ seats, playerSeat: 1, opponents: opponents.slice(0, seats - 1) })}
          className="mt-5 w-full rounded border border-bf-gold/60 bg-bf-gold/10 px-3 py-2 text-bf-gold hover:bg-bf-gold/20"
        >
          Take the field
        </button>
      </div>
    </div>
  );
}
