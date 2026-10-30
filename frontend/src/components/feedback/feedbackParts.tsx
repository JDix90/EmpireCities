import React from 'react';

/** The longest comment the server takes (backend modules/feedback). */
export const FEEDBACK_COMMENT_MAX = 1000;

/** The screen the feedback was sent from, so a layout report can be matched to it. */
export function screenSize(): string {
  return `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`;
}

/** What to tell a player whose note did not go through. */
export function feedbackErrorMessage(e: unknown): string {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 429) return 'That’s a lot of feedback at once. Try again in a few minutes.';
  return 'Couldn’t send that. Please try again.';
}

/** A note box capped at what the server takes, with a running count. */
export function CommentBox({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id: string; placeholder: string }) {
  return (
    <div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={FEEDBACK_COMMENT_MAX}
        rows={4}
        placeholder={placeholder}
        className="input resize-y text-sm"
      />
      <p className="mt-1 text-right text-[11px] text-bf-muted" aria-live="polite">
        {value.length}/{FEEDBACK_COMMENT_MAX}
      </p>
    </div>
  );
}
