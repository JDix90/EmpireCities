import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import { sanitizePostAuthRedirect } from '../utils/navRedirect';
import { normalizeEmail, normalizeIdentifier } from '../utils/emailNormalize';

const AGE_GATE_KEY = 'cc-age-verified';
const MIN_AGE = 13;

function AgeGateModal({ onConfirm, onDeny }: { onConfirm: () => void; onDeny: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div className="bg-cc-surface border border-cc-border rounded-xl p-8 max-w-sm w-full text-center">
        <p className="font-display text-xl text-cc-gold tracking-wide mb-2">Age Verification</p>
        <p className="text-cc-muted text-sm mb-6">
          You must be at least {MIN_AGE} years old to create an account.
          Are you {MIN_AGE} or older?
        </p>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onDeny}>No</button>
          <button className="btn-primary flex-1" onClick={onConfirm}>Yes, I am {MIN_AGE}+</button>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);
  const [ageGateVisible, setAgeGateVisible] = useState(false);
  const [ageDenied, setAgeDenied] = useState(false);
  const { register, isLoading } = useAuthStore();
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

  useEffect(() => {
    try {
      if (!localStorage.getItem(AGE_GATE_KEY)) {
        setAgeGateVisible(true);
      }
    } catch { /* ignore */ }
  }, []);

  function handleAgeConfirm() {
    try { localStorage.setItem(AGE_GATE_KEY, '1'); } catch { /* ignore */ }
    setAgeGateVisible(false);
  }

  function handleAgeDeny() {
    setAgeGateVisible(false);
    setAgeDenied(true);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    const cleanedUsername = normalizeIdentifier(username);
    const cleanedEmail = normalizeEmail(email);
    try {
      await register(cleanedUsername, cleanedEmail, password);
      toast.success('Account created! Welcome, Commander!');
      navigate(redirectTo);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error;
        if (msg) {
          toast.error(msg);
        } else if (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
          // Previously: "Cannot reach server. Is the backend running?
          // (cd backend && pnpm run dev)" — that's a developer-only diagnostic
          // we leaked into production toasts. Real users see a generic, calm
          // message and a clear action (retry).
          toast.error('Cannot reach the server. Check your connection and try again.');
        } else {
          toast.error('Registration failed. Please try again.');
        }
      } else {
        toast.error('An unexpected error occurred');
      }
    }
  };

  if (ageDenied) {
    return (
      <div className="min-h-screen-safe bg-cc-dark flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="font-display text-xl text-cc-gold tracking-wide mb-3">Not eligible</p>
          <p className="text-cc-muted text-sm mb-6">
            You must be at least {MIN_AGE} years old to create an account.
          </p>
          <Link to="/" className="btn-secondary">Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <>
    {ageGateVisible && <AgeGateModal onConfirm={handleAgeConfirm} onDeny={handleAgeDeny} />}
    <div className="min-h-screen-safe bg-cc-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <Link to="/" className="font-display text-3xl text-cc-gold tracking-widest">ERAS OF EMPIRE</Link>
          <p className="text-cc-muted mt-2">Create your free account</p>
        </div>

        <div className="card">
          {sessionExpiredBanner && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2.5 text-sm text-amber-100"
            >
              Your session ended. Create an account or sign in — you can continue from the lobby after registering.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="YourCommanderName"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
                pattern="^[a-zA-Z0-9_]+$"
                title="Letters, numbers, and underscores only"
                autoComplete="username"
              />
              <p className="text-xs text-cc-muted mt-1">Letters, numbers, and underscores only (3–32 characters)</p>
            </div>
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
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
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
            <div>
              <label className="label">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-0 inset-y-0 flex items-center justify-center w-11 text-cc-muted hover:text-cc-text transition-colors"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-cc-muted text-sm mt-6">
            Already have an account?{' '}
            <Link
              to={redirectTo !== '/lobby' ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'}
              className="text-cc-gold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
