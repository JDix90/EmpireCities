import {
  QUICK_MATCH_VICTORY_HINTS,
  QUICK_MATCH_VICTORY_LABELS,
  QUICK_MATCH_VICTORY_MODES,
  type QuickMatchPrefs,
} from '../../utils/quickMatchPrefs';

interface VictoryCriteriaPickerProps {
  prefs: QuickMatchPrefs;
  onChange: (prefs: QuickMatchPrefs) => void;
}

/**
 * "How this match ends" chip group for Quick Match.
 *
 * Quick Match has always stopped at 65% of the board; with nothing on screen
 * saying so, a match ending while a third of the map was still contested read
 * as a bug. Naming the criterion — and letting the player pick a shorter or
 * longer one — is the whole point, so the hint line under the chips always
 * spells out the live choice rather than only appearing on hover.
 */
export default function VictoryCriteriaPicker({ prefs, onChange }: VictoryCriteriaPickerProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-bf-gold mb-2">Win condition</p>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Win condition">
        {QUICK_MATCH_VICTORY_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={prefs.victory === mode}
            onClick={() => onChange({ ...prefs, victory: mode })}
            className={`px-2 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              prefs.victory === mode
                ? 'bg-bf-gold/20 border-bf-gold/40 text-bf-gold'
                : 'border-bf-border text-bf-muted hover:text-bf-text'
            }`}
          >
            {QUICK_MATCH_VICTORY_LABELS[mode]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-bf-muted mt-2 min-h-[2em]">
        {QUICK_MATCH_VICTORY_HINTS[prefs.victory]}
      </p>
    </div>
  );
}
