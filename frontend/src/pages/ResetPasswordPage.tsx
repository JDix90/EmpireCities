import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';
import { sanitizePostAuthRedirect } from '../utils/navRedirect';
import BrandWordmark from '../components/ui/BrandWordmark';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);
  // Preserve the deep-link the user originally arrived at (e.g. /game/<id>)
  // so completing a password reset still drops them at the page they wanted,
  // not at the generic /lobby. The email link itself is responsible for
  // carrying ?token=...&redirect=... through to this page.
  const redirectTo = sanitizePostAuthRedirect(searchParams.get('redirect'));
  const loginHref =
    redirectTo !== '/lobby' ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login';
  const forgotHref =
    redirectTo !== '/lobby'
      ? `/forgot-password?redirect=${encodeURIComponent(redirectTo)}`
      : '/forgot-password';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Invalid or missing reset link.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, new_password: password });
      toast.success('Password updated. Sign in with your new password.');
      navigate(loginHref);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error;
        toast.error(typeof msg === 'string' ? msg : 'Could not reset password');
      } else {
        toast.error('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen-safe bg-bf-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <BrandWordmark className="text-3xl block text-center" />
          <p className="text-bf-muted mt-2">Choose a new password</p>
        </div>

        <div className="card">
          {!token ? (
            <div className="space-y-4 text-center">
              <p className="text-bf-muted text-sm">
                This page needs a valid reset link from your email. Links expire after one hour.
              </p>
              <Link to={forgotHref} className="btn-primary inline-block w-full text-center">
                Request a new link
              </Link>
              <Link to={loginHref} className="block text-bf-gold hover:underline text-sm">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label">New password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input pr-11"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-0 inset-y-0 flex items-center justify-center w-11 text-bf-muted hover:text-bf-text transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          <p className="text-center text-bf-muted text-sm mt-6">
            <Link to={loginHref} className="text-bf-gold hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
