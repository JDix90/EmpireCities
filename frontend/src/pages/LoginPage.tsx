import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import axios from 'axios';
import { sanitizePostAuthRedirect } from '../utils/navRedirect';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = sanitizePostAuthRedirect(searchParams.get('redirect'));

  useEffect(() => {
    try {
      if (sessionStorage.getItem('cc-auth-notice') === 'session_expired') {
        setSessionExpiredBanner(true);
        sessionStorage.removeItem('cc-auth-notice');
      }
    } catch { /* ignore */ }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Welcome back, Commander!');
      navigate(redirectTo);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Login failed');
      } else {
        toast.error('An unexpected error occurred');
      }
    }
  };

  return (
    <div className="min-h-screen-safe bg-cc-dark flex items-center justify-center px-4 pt-safe pb-safe">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="font-display text-3xl text-cc-gold tracking-widest">ERAS OF EMPIRE</Link>
          <p className="text-cc-muted mt-2">Sign in to your account</p>
        </div>

        <div className="card">
          {sessionExpiredBanner && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2.5 text-sm text-amber-100"
            >
              Your session ended. Sign in again to continue — you will return to the page you were on after login.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">Email Address</label>
              <input
                type="email"
                className="input"
                placeholder="commander@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-cc-muted text-sm mt-6">
            No account?{' '}
            <Link
              to={redirectTo !== '/lobby' ? `/register?redirect=${encodeURIComponent(redirectTo)}` : '/register'}
              className="text-cc-gold hover:underline"
            >
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
