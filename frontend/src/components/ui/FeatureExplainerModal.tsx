import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface FeatureExplainerModalProps {
  /** Feature key stored in localStorage once dismissed. */
  featureKey: string;
  title: string;
  description: string;
  icon?: string;
  className?: string;
}

export default function FeatureExplainerModal({
  featureKey,
  title,
  description,
  icon = '💡',
  className,
}: FeatureExplainerModalProps) {
  const storageKey = `explainer_seen_${featureKey}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      setVisible(true);
    }
  }, [storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-modal-backdrop px-3 py-4 pt-safe pb-safe sm:px-4">
      <div className="absolute inset-0 bg-black/60" onClick={dismiss} />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div
          className={clsx(
            'relative max-w-sm w-full rounded-2xl bg-cc-surface border border-cc-border p-4 sm:p-6 shadow-2xl animate-modal-in max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain',
            className,
          )}
        >
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 text-cc-muted hover:text-cc-text transition-colors"
          >
            <X size={18} />
          </button>

          <div className="text-3xl mb-3">{icon}</div>
          <h3 className="text-lg font-display text-cc-gold mb-2 pr-8">{title}</h3>
          <p className="text-sm text-cc-muted leading-relaxed">{description}</p>

          <button
            onClick={dismiss}
            className="mt-4 w-full py-2 rounded-lg bg-cc-gold/20 border border-cc-gold/30 text-cc-gold text-sm font-medium hover:bg-cc-gold/30 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
