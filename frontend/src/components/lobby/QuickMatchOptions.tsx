import { Bot } from 'lucide-react';
import AiOpponentPicker from './AiOpponentPicker';
import {
  QUICK_MATCH_DIFFICULTY_LABELS,
  type QuickMatchPrefs,
} from '../../utils/quickMatchPrefs';

interface QuickMatchOptionsProps {
  prefs: QuickMatchPrefs;
  onChange: (prefs: QuickMatchPrefs) => void;
  onStart: () => void;
  starting: boolean;
}

/**
 * Compact Quick Match setup panel (opponent count + AI difficulty). Rendered
 * as a popover from the lobby's Quick Match split button; the parent owns
 * open/close. Choices persist (see quickMatchPrefs) so the main button stays
 * a one-click start with the player's last setup.
 */
export default function QuickMatchOptions({ prefs, onChange, onStart, starting }: QuickMatchOptionsProps) {
  return (
    <div className="w-full rounded-xl border border-bf-border bg-bf-surface p-4 shadow-xl space-y-4 text-left">
      <AiOpponentPicker prefs={prefs} onChange={onChange} />

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
