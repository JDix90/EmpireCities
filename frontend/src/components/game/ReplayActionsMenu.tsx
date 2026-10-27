import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

export interface ReplayMenuAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The replay header's less-used actions (clip, share, make private) behind one
 * button, for a phone: laid out in a row like the desktop header, they ran off
 * the right edge of the screen.
 */
export default function ReplayActionsMenu({ actions }: { actions: ReplayMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEscapeClose(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More replay actions"
        title="More"
        className="tap-target flex items-center justify-center h-8 w-8 rounded-lg border bg-white/5 border-bf-border text-bf-muted hover:text-bf-text transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-bf-border bg-bf-surface shadow-xl py-1.5"
        >
          {actions.map(({ label, icon: Icon, onSelect, disabled }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => { setOpen(false); onSelect(); }}
              className="tap-min w-full flex items-center gap-2.5 px-3 py-2 text-sm text-bf-text hover:bg-white/5 hover:text-bf-gold text-left disabled:opacity-50"
            >
              <Icon className="w-4 h-4 text-bf-muted" aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
