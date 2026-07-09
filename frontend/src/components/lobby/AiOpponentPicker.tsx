import {
  QUICK_MATCH_AI_DIFFICULTIES,
  QUICK_MATCH_DIFFICULTY_HINTS,
  QUICK_MATCH_DIFFICULTY_LABELS,
  QUICK_MATCH_MAX_AI,
  QUICK_MATCH_MIN_AI,
  type QuickMatchPrefs,
} from '../../utils/quickMatchPrefs';

interface AiOpponentPickerProps {
  prefs: QuickMatchPrefs;
  onChange: (prefs: QuickMatchPrefs) => void;
}

const AI_COUNT_CHOICES = Array.from(
  { length: QUICK_MATCH_MAX_AI - QUICK_MATCH_MIN_AI + 1 },
  (_, i) => QUICK_MATCH_MIN_AI + i,
);

/**
 * Opponent-count + AI-difficulty chip groups. Shared by the Quick Match
 * popover and the Full Game modal so the two setup surfaces stay identical;
 * the parent owns persistence (each surface remembers its own prefs).
 */
export default function AiOpponentPicker({ prefs, onChange }: AiOpponentPickerProps) {
  return (
    <div className="space-y-4">
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
    </div>
  );
}
