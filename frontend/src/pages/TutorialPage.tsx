import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import toast from 'react-hot-toast';

const STEPS = [
  {
    title: 'Welcome to Eras of Empire',
    body:
      'You command an empire across history. Each turn has three phases: Draft, Attack, and Fortify.',
  },
  {
    title: 'Step 1 — Draft',
    body:
      'At the start of your turn, place reinforcement units on any territory you own. Select a territory, then place units.',
  },
  {
    title: 'Step 2 — Attack',
    body:
      'Choose one of your territories with 2+ units, then an adjacent enemy territory to attack. Dice are rolled on the server.',
  },
  {
    title: 'Step 3 — Fortify',
    body:
      'Move units between adjacent territories you own to strengthen your borders before ending your turn.',
  },
  {
    title: 'Territory Cards',
    body:
      'Capture at least one territory per turn to earn a card. Redeem sets of three for bonus reinforcements.',
  },
];

export default function TutorialPage() {
  const [step, setStep] = useState(0);
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  async function startTutorial() {
    setStarting(true);
    try {
      const res = await api.post<{ game_id: string }>('/games/tutorial/start', {});
      navigate(`/game/${res.data.game_id}`);
    } catch {
      toast.error('Could not start the tutorial. Try again.');
    } finally {
      setStarting(false);
    }
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="min-h-screen-safe bg-cc-dark flex flex-col">
      <nav className="border-b border-cc-border px-6 py-4 flex justify-between items-center">
        <Link to="/" className="font-display text-cc-gold tracking-widest hover:text-white text-sm">
          ERAS OF EMPIRE
        </Link>
        <Link to="/lobby" className="text-cc-muted text-sm hover:text-cc-gold">
          Skip to lobby
        </Link>
      </nav>

      <div className="flex-1 flex items-end justify-center px-4 pb-10 pt-8">
        <div className="w-full max-w-lg card border-cc-border p-6 md:p-8">
          <p className="text-cc-muted text-xs mb-2">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 className="font-display text-xl text-cc-gold mb-3">{current.title}</h1>
          <p className="text-cc-text/90 text-sm leading-relaxed mb-8">{current.body}</p>

          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-cc-gold' : 'bg-cc-border'}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <button type="button" className="btn-secondary text-sm" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              )}
              {!isLast && (
                <button type="button" className="btn-primary text-sm" onClick={() => setStep((s) => s + 1)}>
                  Next
                </button>
              )}
              {isLast && (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={starting}
                  onClick={() => void startTutorial()}
                >
                  {starting ? 'Starting…' : 'Start tutorial match'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
