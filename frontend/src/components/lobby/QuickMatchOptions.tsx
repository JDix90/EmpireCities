import { Bot } from 'lucide-react';
import {
  QUICK_MATCH_AI_DIFFICULTIES,
  QUICK_MATCH_DIFFICULTY_HINTS,
  QUICK_MATCH_DIFFICULTY_LABELS,
  QUICK_MATCH_MAX_AI,
  QUICK_MATCH_MIN_AI,
  type QuickMatchPrefs,
} from '../../utils/quickMatchPrefs';

interface QuickMatchOptionsProps {
  prefs: QuickMatchPrefs;
  onChange: (prefs: QuickMatchPrefs) => void;
  onStart: () => void;
  starting: boolean;
}

const AI_COUNT_CHOICES = Array.from(
  { length: QUICK_MATCH_MAX_AI - QUICK_MATCH_MIN_AI + 1 },
  (_, i) => QUICK_MATCH_MIN_AI + i,
);

/**
 * Compact Quick Match setup panel (opponent count + AI difficulty). Rendered
 * as a popover from the lobby's Quick Match split button; the parent owns
 * open/close. Choices persist (see quickMatchPrefs) so the main button stays
 * a one-click start with the player's last setup.
 */
export default function QuickMatchOptions({ prefs, onChange, onStart, starting }: QuickMatchOptionsProps) {
  return (
    <div className="w-full rounded-xl border border-bf-border bg-bf-surface p-4 shadow-xl space-y-4 text-left">
      <div>
        <p className="text-xs uppercase tracking-widest text-bf-gold mb-2">Opponents</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Number of AI opponents">
          {AI_COUNT_CHOICES.map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={prefs.aiCount === count}
              onClick={() => onChange({ ...prefs, aiCount: count })}
              className={`w-8 h-8 rounded-lg border text-sm font-medium transition-colors ${
                prefs.aiCount === count
                  ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                  : 'border-bf-border text-bf-muted hover:text-bf-text'
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-bf-gold mb-2">AI difficulty</p>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="AI difficulty">
          {QUICK_MATCH_AI_DIFFICULTIES.map((difficulty) => (
            <button
              key={difficulty}
              type="button"
              aria-pressed={prefs.aiDifficulty === difficulty}
              onClick={() => onChange({ ...prefs, aiDifficulty: difficulty })}
              className={`px-2 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                prefs.aiDifficulty === difficulty
                  ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                  : 'border-bf-border text-bf-muted hover:text-bf-text'
              }`}
            >
              {QUICK_MATCH_DIFFICULTY_LABELS[difficulty]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-bf-muted mt-2 min-h-[2em]">
          {QUICK_MATCH_DIFFICULTY_HINTS[prefs.aiDifficulty]}
        </p>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="btn-primary w-full text-sm py-2"
      >
        <Bot className="w-4 h-4 mr-2" aria-hidden />
        {starting ? 'Starting…' : `Start vs ${prefs.aiCount} ${QUICK_MATCH_DIFFICULTY_LABELS[prefs.aiDifficulty]}`}
      </button>
      <p className="text-[11px] text-bf-muted -mt-2">Random era map · your setup is remembered.</p>
    </div>
  );
}
