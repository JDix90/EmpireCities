import React from 'react';
import { X } from 'lucide-react';

interface ShortcutRow {
  key: string;
  label: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { key: 'Enter / Space', label: 'Advance phase / End turn' },
  { key: '?', label: 'Show this shortcuts panel' },
  { key: 'Esc', label: 'Deselect territory / Close panel' },
  { key: 'C', label: 'Open chat' },
  { key: 'T', label: 'Open tech tree' },
  { key: 'B', label: 'Show continent bonuses' },
];

interface Props {
  onClose: () => void;
}

export default function GameShortcutsModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 pt-safe pb-safe"
      onClick={onClose}
    >
      <div
        className="bg-bf-surface border border-bf-border rounded-xl p-5 sm:p-6 w-full max-w-sm max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-display text-lg text-bf-gold tracking-wide">Keyboard Shortcuts</p>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-bf-text transition-colors -mr-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map(({ key, label }) => (
              <tr key={key} className="border-b border-bf-border last:border-0">
                <td className="py-2 pr-4">
                  <kbd className="inline-block bg-bf-dark border border-bf-border rounded px-2 py-0.5 font-mono text-xs text-bf-gold">
                    {key}
                  </kbd>
                </td>
                <td className="py-2 text-bf-muted">{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
