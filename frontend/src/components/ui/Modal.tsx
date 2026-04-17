import React from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  className,
  showCloseButton = true,
}: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto animate-modal-backdrop px-3 py-4 pt-safe pb-safe sm:px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div
          className={clsx(
            'relative w-full max-w-lg mx-auto rounded-2xl bg-cc-surface border border-cc-border p-4 sm:p-6 shadow-2xl animate-modal-in max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain',
            className,
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? 'modal-title' : undefined}
        >
          {showCloseButton && (
            <button
              onClick={onClose}
              className="absolute top-3 right-3 text-cc-muted hover:text-cc-text transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          )}
          {title && <h3 id="modal-title" className="text-lg sm:text-xl font-display text-cc-gold mb-4 pr-8">{title}</h3>}
          {children}
        </div>
      </div>
    </div>
  );
}
