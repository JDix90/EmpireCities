import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

/**
 * Retention-notification click attribution. Push/email deep links carry
 * `?rn=<trigger>` (e.g. /lobby?rn=streak_at_risk); on landing we report the
 * click once and strip the param so refreshes don't double-count.
 */
export function useRnParamTracker(): void {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const rn = searchParams.get('rn');
    if (!rn) return;
    api
      .post('/analytics/ui-event', {
        event: 'retention_notification_clicked',
        properties: { trigger: rn },
      })
      .catch(() => {});
    const next = new URLSearchParams(searchParams);
    next.delete('rn');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
}
