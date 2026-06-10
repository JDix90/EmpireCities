import {
  CONNECTION_HINT_LABELS,
  type ConnectionHintPreference,
} from '../../utils/connectionHints';

interface ConnectionHintsSettingProps {
  value: ConnectionHintPreference;
  onChange: (value: ConnectionHintPreference) => void;
  denseMap?: boolean;
  compact?: boolean;
}

const OPTIONS: ConnectionHintPreference[] = ['auto', 'full', 'borders', 'off'];

export default function ConnectionHintsSetting({
  value,
  onChange,
  denseMap = false,
  compact = false,
}: ConnectionHintsSettingProps) {
  const explainer = denseMap
    ? 'This map is dense — Auto uses border highlights instead of animated lines.'
    : 'Control animated lines between territories during attack and fortify.';

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'} title={compact ? explainer : undefined}>
      <div>
        <p className="text-sm text-bf-muted">Connection hints</p>
        {!compact && (
          <p className="text-[11px] text-bf-muted/80 mt-0.5 leading-snug">
            {explainer}
          </p>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ConnectionHintPreference)}
        className="w-full rounded-lg border border-bf-border bg-bf-dark px-2.5 py-2 text-xs text-bf-text"
        aria-label="Connection hints"
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {CONNECTION_HINT_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
