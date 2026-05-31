import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import { sanitizePostAuthRedirect } from '../utils/navRedirect';
import { normalizeEmail, normalizeIdentifier } from '../utils/emailNormalize';
import BrandWordmark from '../components/ui/BrandWordmark';

export default function LoginPage() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    // Trim whitespace and lowercase if the user pasted an email — copy/paste
    // from email clients routinely adds a trailing space or "Name <email>"
    // wrappers; we can't fix the latter but the former silently produced a
    // bcrypt mismatch with no useful error message.
    const candidate = normalizeIdentifier(emailOrUsername);
    const normalized = candidate.includes('@') ? normalizeEmail(candidate) : candidate;
    try {
      await login(normalized, password);
      toast.success('Welcome back, Commander!');
      navigate(redirectTo);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error;
        if (msg) {
          toast.error(msg);
        } else if (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
          toast.error('Cannot reach the server. Check your connection and try again.');
        } else {
          toast.error('Login failed');
        }
      } else {
        toast.error('An unexpected error occurred');
      }
    }
  };

  return (
    <div className="min-h-screen-safe bg-cc-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <BrandWordmark className="text-3xl block text-center" />
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
              <label className="label">Email or username</label>
              <input
                type="text"
                className="input"
                placeholder="commander@example.com or username"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1.5">
                <label htmlFor="login-password" className="text-sm font-medium text-cc-muted">
                  Password
                </label>
                <Link
                  to={redirectTo !== '/lobby' ? `/forgot-password?redirect=${encodeURIComponent(redirectTo)}` : '/forgot-password'}
                  className="text-sm text-cc-muted hover:text-cc-gold hover:underline shrink-0 ml-auto"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-0 inset-y-0 flex items-center justify-center w-11 text-cc-muted hover:text-cc-text transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
