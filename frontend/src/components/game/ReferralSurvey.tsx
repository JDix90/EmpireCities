import { useState } from 'react';
import { api } from '../../services/api';
import {
  REFERRAL_SURVEY_OPTIONS,
  markReferralSurveyAnswered,
  type ReferralSurveyAnswer,
} from '../../utils/referralSurvey';

/**
 * One question, five taps, once per browser: where did you hear about us?
 *
 * It sits at the END of the game-over screen, below the come-back panel and the
 * guest-conversion block, because neither of those may lose a reader to it —
 * this is measurement, and the other two are the funnel. It is dismissible, and
 * dismissing is recorded the same way an answer is, so nobody is asked twice.
 *
 * Fail-silent by design: if the beacon POST fails, the player still sees the
 * thank-you and is never asked again. A lost measurement is cheaper than a
 * retry loop on a game-over screen.
 */
export default function ReferralSurvey({ className }: { className?: string }) {
  const [answered, setAnswered] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  function choose(answer: ReferralSurveyAnswer) {
    setAnswered(true);
    markReferralSurveyAnswered(window.localStorage, answer);
    api
      .post('/analytics/ui-event', {
        event: 'referral_survey_answered',
        properties: { answer },
      })
      .catch(() => {});
  }

  function dismiss() {
    setDismissed(true);
    markReferralSurveyAnswered(window.localStorage, 'dismissed');
  }

  if (dismissed) return null;

  if (answered) {
    return (
      <div className={`p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left ${className ?? ''}`}>
        <p className="text-sm text-bf-muted">Thanks — that genuinely helps.</p>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl bg-white/[0.03] border border-white/10 text-left space-y-3 ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-bf-text">How did you hear about Borderfall?</p>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-white/35 hover:text-white/60 shrink-0"
          aria-label="Dismiss survey"
        >
          Skip
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {REFERRAL_SURVEY_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => choose(option.id)}
            className="px-3 py-1.5 rounded-lg text-xs text-bf-muted bg-white/[0.04] border border-white/10 hover:bg-white/10 hover:text-bf-text transition-colors"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
