import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { sanitizePostAuthRedirect } from '../utils/navRedirect';
import { normalizeEmail } from '../utils/emailNormalize';
import BrandWordmark from '../components/ui/BrandWordmark';

export default function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = sanitizePostAuthRedirect(searchParams.get('redirect'));
  const loginHref =
    redirectTo !== '/lobby' ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login';

  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const normalized = normalizeEmail(email);
    try {
      // Don't show the server's "we sent it" toast — we render the same
      // confirmation copy in-page (the `done` view) and the duplicate caused
      // a flash of two near-identical success messages.
      await api.post<{ message: string }>('/auth/forgot-password', { email: normalized });
      setDone(true);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Something went wrong');
      } else {
        toast.error('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen-safe bg-cc-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <BrandWordmark className="text-3xl block text-center" />
          <p className="text-cc-muted mt-2">Reset your password</p>
        </div>

        <div className="card">
          {done ? (
            <div className="space-y-4 text-center">
              <p className="text-cc-text">
                If an account exists for that email, we sent password reset instructions. Check your inbox
                (and spam) for a link that expires in one hour.
              </p>
              <Link to={loginHref} className="btn-primary inline-block w-full text-center">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-cc-muted text-sm">
                Enter the email address for your account. We will send a one-time link if an account exists.
              </p>
              <div>
                <label className="label" htmlFor="forgot-email">Email</label>
                <input
                  id="forgot-email"
                  type="email"
                  className="input"
                  placeholder="commander@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="text-center text-cc-muted text-sm mt-6">
            <Link to={loginHref} className="text-cc-gold hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
