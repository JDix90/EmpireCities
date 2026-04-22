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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-cc-surface border border-cc-border rounded-xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-display text-lg text-cc-gold tracking-wide">Keyboard Shortcuts</p>
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-cc-text transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map(({ key, label }) => (
              <tr key={key} className="border-b border-cc-border last:border-0">
                <td className="py-2 pr-4">
                  <kbd className="inline-block bg-cc-dark border border-cc-border rounded px-2 py-0.5 font-mono text-xs text-cc-gold">
                    {key}
                  </kbd>
                </td>
                <td className="py-2 text-cc-muted">{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
