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
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-modal-backdrop p-4 pt-safe pb-safe px-safe">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={clsx(
          'relative z-10 w-full max-w-lg mx-auto rounded-2xl bg-cc-surface border border-cc-border p-6 shadow-2xl animate-modal-in',
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
        {title && <h3 id="modal-title" className="text-xl font-display text-cc-gold mb-4">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
