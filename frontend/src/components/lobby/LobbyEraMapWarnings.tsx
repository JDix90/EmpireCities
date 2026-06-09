import { AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import type { CompatibilityWarning } from '../../utils/lobbyEraMapCompatibility';

interface LobbyEraMapWarningsProps {
  hardBlock?: string | null;
  warnings?: CompatibilityWarning[];
  className?: string;
}

export default function LobbyEraMapWarnings({
  hardBlock,
  warnings = [],
  className = '',
}: LobbyEraMapWarningsProps) {
  if (!hardBlock && warnings.length === 0) return null;

  return (
    <div className={clsx('space-y-2', className)}>
      {hardBlock && (
        <div className="flex gap-2 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{hardBlock}</span>
        </div>
      )}
      {warnings.map((w, i) => (
        <div
          key={`${w.tier}-${i}`}
          className={clsx(
            'flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
            w.tier === 'warn'
              ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-200',
          )}
        >
          {w.tier === 'warn' ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}
