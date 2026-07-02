import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import BrandWordmark from '../components/ui/BrandWordmark';

/**
 * One-click email opt-out landing page. The token arrives in the URL from an
 * email footer link; the actual opt-out is a POST behind this confirm button
 * so mail-scanner link prefetches can't silently unsubscribe people.
 */
export default function UnsubscribePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>(token ? 'idle' : 'error');

  const handleUnsubscribe = async () => {
    setState('working');
    try {
      await api.post('/users/unsubscribe', { token });
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="min-h-screen-safe bg-bf-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <BrandWordmark className="text-3xl block text-center mb-8" />
        <div className="card">
          {state === 'done' ? (
            <>
              <p className="font-display text-xl text-bf-gold tracking-wide mb-3">You're unsubscribed</p>
              <p className="text-bf-muted text-sm mb-6">
                You'll no longer receive gameplay emails. You can re-enable them
                anytime in your notification settings.
              </p>
              <Link to="/" className="btn-secondary">Back to home</Link>
            </>
          ) : state === 'error' ? (
            <>
              <p className="font-display text-xl text-bf-gold tracking-wide mb-3">Something went wrong</p>
              <p className="text-bf-muted text-sm mb-6">
                This unsubscribe link doesn't look valid. You can also turn off
                emails from Settings → Notifications while signed in.
              </p>
              <Link to="/" className="btn-secondary">Back to home</Link>
            </>
          ) : (
            <>
              <p className="font-display text-xl text-bf-gold tracking-wide mb-3">Unsubscribe from emails?</p>
              <p className="text-bf-muted text-sm mb-6">
                You'll stop receiving streak reminders, turn notifications, and
                comeback bonuses by email. Push notifications are unaffected.
              </p>
              <button className="btn-primary w-full" onClick={handleUnsubscribe} disabled={state === 'working'}>
                {state === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
