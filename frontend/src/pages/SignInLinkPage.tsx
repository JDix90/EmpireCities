import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useEmailAccountSaveEnabled, useFeatureFlagsStore } from '../store/featureFlagsStore';
import { normalizeEmail } from '../utils/emailNormalize';
import BrandWordmark from '../components/ui/BrandWordmark';

/**
 * Sign in with an emailed link (email_account_save_enabled): the way back for
 * an account saved with just an email, and a shortcut for any account.
 *
 * Without a token it asks for an email and sends the link. With one (the link
 * itself) it redeems it: the token is POSTed, so a mail scanner that opens the
 * link does not use it up, and redeemed once, since a link signs in once.
 */
export default function SignInLinkPage() {
  const flagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const enabled = useEmailAccountSaveEnabled();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const signInWithLink = useAuthStore((s) => s.signInWithLink);

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const redeemed = useRef(false);

  useEffect(() => {
    if (!token || !enabled || redeemed.current) return;
    redeemed.current = true;
    signInWithLink(token)
      .then(() => {
        toast.success('Welcome back, Commander!');
        navigate('/lobby', { replace: true });
      })
      .catch((err: unknown) => {
        const msg = axios.isAxiosError(err) ? (err.response?.data?.error as string | undefined) : undefined;
        setLinkError(msg ?? 'This sign-in link did not work. Request a new one below.');
        // Drop the spent token from the address bar.
        navigate('/sign-in-link', { replace: true });
      });
  }, [token, enabled, signInWithLink, navigate]);

  if (!flagsLoaded) {
    return <div className="min-h-screen-safe bg-bf-dark" aria-busy="true" />;
  }
  if (!enabled) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await api.post('/auth/sign-in-link', { email: normalizeEmail(email) });
      setSent(true);
    } catch (err: unknown) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.error || 'Something went wrong' : 'An unexpected error occurred');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen-safe bg-bf-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <BrandWordmark className="text-3xl block text-center" />
          <p className="text-bf-muted mt-2">Sign in with an email link</p>
        </div>

        <div className="card">
          {token && !linkError ? (
            <p className="text-center text-bf-muted" role="status">Signing you in…</p>
          ) : sent ? (
            <div className="space-y-4 text-center" data-testid="sign-in-link-sent">
              <p className="text-bf-text">
                If an account exists for that email, we sent a sign-in link. Check your inbox (and spam):
                the link works once and expires in 30 minutes.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {linkError && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {linkError}
                </p>
              )}
              <p className="text-bf-muted text-sm">
                Enter the email your account is saved with. We will send a link that signs you in, no password needed.
              </p>
              <div>
                <label className="label" htmlFor="sign-in-link-email">Email</label>
                <input
                  id="sign-in-link-email"
                  type="email"
                  className="input"
                  placeholder="commander@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={sending}>
                {sending ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          )}

          <p className="text-center text-bf-muted text-sm mt-6">
            <Link to="/login" className="tap-min inline-flex items-center text-bf-gold hover:underline">Sign in with a password instead</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
