import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  footer?: ReactNode;
}

export function SettingsSection({ title, icon: Icon, children, footer }: SettingsSectionProps) {
  return (
    <section className="card">
      <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5" /> {title}
      </h3>
      {children}
      {footer}
    </section>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
}

export function SettingsRow({ label, description, icon: Icon, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-start gap-2 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-bf-muted mt-0.5 shrink-0" />}
        <div className="min-w-0">
          <span className="text-sm text-bf-text">{label}</span>
          {description && <p className="text-xs text-bf-muted">{description}</p>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  'aria-label'?: string;
}

export function SettingsToggle({ checked, onChange, label, 'aria-label': ariaLabel }: SettingsToggleProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-5 h-5 accent-bf-gold"
      aria-label={ariaLabel ?? label}
    />
  );
}

interface SettingsSelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  'aria-label': string;
}

export function SettingsSelect<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: SettingsSelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border border-bf-border bg-bf-dark px-2.5 py-2 text-xs text-bf-text min-w-[9rem]"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface SettingsSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  disabled?: boolean;
}

export function SettingsSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  label,
  disabled = false,
}: SettingsSliderProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-bf-gold disabled:opacity-50"
        aria-label={label}
      />
      <span className="text-xs text-bf-muted tabular-nums w-8 text-right">{value}%</span>
    </div>
  );
}

export function SettingsGuestNotice({ message }: { message: string }) {
  return (
    <p className="text-sm text-bf-muted py-2">{message}</p>
  );
}
