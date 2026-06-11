import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import axios from 'axios';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { normalizeEmail, normalizeIdentifier } from '../utils/emailNormalize';
import BrandWordmark from '../components/ui/BrandWordmark';

const AGE_GATE_KEY = 'cc-age-verified';
const MIN_AGE = 13;

function AgeGateModal({ onConfirm, onDeny }: { onConfirm: () => void; onDeny: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div className="bg-bf-surface border border-bf-border rounded-xl p-8 max-w-sm w-full text-center">
        <p className="font-display text-xl text-bf-gold tracking-wide mb-2">Age Verification</p>
        <p className="text-bf-muted text-sm mb-6">
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

/**
 * Guest → full account conversion. Unlike /register (which mints a NEW
 * account), this upgrades the guest's existing users row in place — the
 * whole pitch is that nothing is lost: same user_id, same XP/level/streaks,
 * and the silently-accrued ratings become visible.
 */
export default function UpgradePage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string; email?: string; password?: string; confirm?: string;
  }>({});
  const [ageGateVisible, setAgeGateVisible] = useState(false);
  const [ageDenied, setAgeDenied] = useState(false);
  const { user, upgradeAccount, refreshUser, isLoading } = useAuthStore();
  const navigate = useNavigate();

  // The carry-over banner is the sales pitch — make sure it shows the
  // just-earned XP/level rather than a stale cached profile (players often
  // arrive here straight from a game-over screen).
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

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
    const errors: typeof fieldErrors = {};
    const trimmedUsername = username.trim();
    if (!trimmedUsername) errors.username = 'Choose a commander name.';
    else if (trimmedUsername.length < 3 || trimmedUsername.length > 32) errors.username = 'Username must be 3–32 characters.';
    else if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) errors.username = 'Letters, numbers, and underscores only.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Choose a password.';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (!confirm) errors.confirm = 'Repeat your password.';
    else if (password && password !== confirm) errors.confirm = 'Passwords do not match.';
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    const cleanedUsername = normalizeIdentifier(username);
    const cleanedEmail = normalizeEmail(email);
    try {
      await upgradeAccount(cleanedUsername, cleanedEmail, password);
      toast.success('Account created — your progress is now permanent!');
      navigate('/lobby');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const msg = err.response?.data?.error as string | undefined;
        if (status === 409) {
          // Server can't tell us which collided without an enumeration risk;
          // flag both identity fields.
          setFieldErrors({
            username: 'This username or email is already in use.',
            email: 'This username or email is already in use.',
          });
        } else if (status === 400 && msg?.toLowerCase().includes('password')) {
          setFieldErrors({ password: msg });
        } else if (status === 400 && msg?.toLowerCase().includes('email')) {
          setFieldErrors({ email: msg });
        } else if (msg) {
          toast.error(msg);
        } else if (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
          toast.error('Cannot reach the server. Check your connection and try again.');
        } else {
          toast.error('Upgrade failed. Please try again.');
        }
      } else {
        toast.error('An unexpected error occurred');
      }
    }
  };

  if (ageDenied) {
    return (
      <div className="min-h-screen-safe bg-bf-dark flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="font-display text-xl text-bf-gold tracking-wide mb-3">Not eligible</p>
          <p className="text-bf-muted text-sm mb-6">
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
    <div className="min-h-screen-safe bg-bf-dark overflow-y-auto px-4 pt-safe pb-safe flex items-start justify-center">
      <div className="w-full max-w-md py-10">
        <div className="text-center mb-8">
          <BrandWordmark className="text-3xl block text-center" />
          <p className="text-bf-muted mt-2">Save your progress with a free account</p>
        </div>

        <div className="card">
          <div className="mb-5 rounded-lg border border-bf-gold/30 bg-bf-gold/10 px-3 py-2.5 text-sm text-bf-text flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-bf-gold shrink-0 mt-0.5" aria-hidden />
            <span>
              Everything carries over — you keep your{' '}
              <span className="text-bf-gold font-medium">Level {user?.level ?? 1}</span>
              {typeof user?.xp === 'number' && user.xp > 0 && (
                <> and <span className="text-bf-gold font-medium">{user.xp} XP</span></>
              )}
              {(user?.win_streak ?? 0) > 0 && (
                <> and your <span className="text-bf-gold font-medium">{user?.win_streak}-win streak</span></>
              )}
              . This just makes them permanent.
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="YourCommanderName"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (fieldErrors.username) setFieldErrors((f) => ({ ...f, username: undefined }));
                }}
                maxLength={32}
                aria-invalid={!!fieldErrors.username}
                autoComplete="username"
              />
              {fieldErrors.username && (
                <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.username}</p>
              )}
              <p className="text-xs text-bf-muted mt-1">Letters, numbers, and underscores only (3–32 characters)</p>
            </div>
            <div>
              <label className="label">Email Address</label>
              <input
                type="email"
                className="input"
                placeholder="commander@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                }}
                aria-invalid={!!fieldErrors.email}
                autoComplete="email"
              />
              {fieldErrors.email && (
                <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.email}</p>
              )}
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.password}
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
              {fieldErrors.password && (
                <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.password}</p>
              )}
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (fieldErrors.confirm) setFieldErrors((f) => ({ ...f, confirm: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.confirm}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-0 inset-y-0 flex items-center justify-center w-11 text-bf-muted hover:text-bf-text transition-colors"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldErrors.confirm && (
                <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.confirm}</p>
              )}
            </div>
            <button type="submit" className="btn-primary w-full" disabled={isLoading}>
              {isLoading ? 'Saving your progress...' : 'Create Free Account'}
            </button>
            <p className="text-xs text-bf-muted text-center mt-3 leading-relaxed">
              By creating an account, you agree to our{' '}
              <Link to="/terms" className="text-bf-gold hover:underline">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" className="text-bf-gold hover:underline">Privacy Policy</Link>.
            </p>
          </form>

          <p className="text-center text-bf-muted text-sm mt-6">
            <Link to="/lobby" className="text-bf-gold hover:underline">Maybe later — back to the lobby</Link>
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
