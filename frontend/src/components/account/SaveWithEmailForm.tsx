import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { normalizeEmail, normalizeIdentifier } from '../../utils/emailNormalize';

interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

/**
 * Save your account with just an email (email_account_save_enabled).
 *
 * The guest's own name is filled in and kept unless they change it, and the
 * password is optional: an account saved without one signs in from any device
 * with a one-time link emailed to this address. The guest's row is upgraded in
 * place, so everything they have earned stays theirs.
 */
export default function SaveWithEmailForm({ onDone }: { onDone: () => void }) {
  const { user, upgradeAccount, isLoading } = useAuthStore();
  const currentName = user?.username ?? '';
  const [username, setUsername] = useState(currentName);
  const [email, setEmail] = useState('');
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const clearError = (field: keyof FieldErrors) =>
    setFieldErrors((f) => (f[field] ? { ...f, [field]: undefined } : f));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: FieldErrors = {};
    const trimmedName = username.trim();
    if (!trimmedName) errors.username = 'Choose a commander name.';
    else if (trimmedName.length < 3 || trimmedName.length > 32) errors.username = 'Username must be 3–32 characters.';
    else if (!/^[a-zA-Z0-9_]+$/.test(trimmedName)) errors.username = 'Letters, numbers, and underscores only.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    const wantsPassword = password !== '' || confirm !== '';
    if (wantsPassword) {
      if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
      if (password !== confirm) errors.confirm = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    const cleanedEmail = normalizeEmail(email);
    const cleanedName = normalizeIdentifier(username);
    try {
      // The name is sent only when changed; left alone, the guest keeps theirs.
      await upgradeAccount(
        cleanedName === currentName ? undefined : cleanedName,
        cleanedEmail,
        wantsPassword ? password : undefined,
        emailOptIn,
      );
      // Said in a toast: the account is no longer a guest's, so /upgrade's route
      // guard leaves this page at once, and onDone takes the player on.
      toast.success(
        `Account saved to ${cleanedEmail}. To play on another device, choose “Email me a sign-in link” when you sign in${wantsPassword ? ', or use your password' : ''}.`,
        { duration: 8000 },
      );
      onDone();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const msg = err.response?.data?.error as string | undefined;
        if (status === 409) {
          const emailCollision = !!msg && /email/i.test(msg);
          setFieldErrors(emailCollision ? { email: msg } : { username: msg ?? 'That username is taken.' });
        } else if (status === 400 && msg?.toLowerCase().includes('password')) {
          setFieldErrors({ password: msg });
        } else if (status === 400 && msg?.toLowerCase().includes('email')) {
          setFieldErrors({ email: msg });
        } else if (msg) {
          toast.error(msg);
        } else if (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK') {
          toast.error('Cannot reach the server. Check your connection and try again.');
        } else {
          toast.error('Saving failed. Please try again.');
        }
      } else {
        toast.error('An unexpected error occurred');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label className="label" htmlFor="save-email">Email address</label>
        <input
          id="save-email"
          type="email"
          className="input"
          placeholder="commander@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
          aria-invalid={!!fieldErrors.email}
          autoComplete="email"
        />
        {fieldErrors.email && <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.email}</p>}
        <p className="text-xs text-bf-muted mt-1">We email you a sign-in link when you play on another device.</p>
      </div>
      <div>
        <label className="label" htmlFor="save-username">Commander name</label>
        <input
          id="save-username"
          type="text"
          className="input"
          value={username}
          onChange={(e) => { setUsername(e.target.value); clearError('username'); }}
          maxLength={32}
          aria-invalid={!!fieldErrors.username}
          autoComplete="username"
        />
        {fieldErrors.username && <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.username}</p>}
        <p className="text-xs text-bf-muted mt-1">Keep it, or change it now (letters, numbers, and underscores).</p>
      </div>

      <div>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-bf-gold hover:underline"
          aria-expanded={showPasswordFields}
          onClick={() => setShowPasswordFields((v) => !v)}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showPasswordFields ? 'rotate-180' : ''}`} aria-hidden />
          Add a password (optional)
        </button>
        {showPasswordFields && (
          <div className="mt-3 space-y-4">
            <div>
              <label className="label" htmlFor="save-password">Password</label>
              <div className="relative">
                <input
                  id="save-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-11"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError('password'); }}
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
              {fieldErrors.password && <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.password}</p>}
            </div>
            <div>
              <label className="label" htmlFor="save-confirm">Confirm password</label>
              <input
                id="save-confirm"
                type={showPassword ? 'text' : 'password'}
                className="input"
                placeholder="Repeat your password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); clearError('confirm'); }}
                aria-invalid={!!fieldErrors.confirm}
                autoComplete="new-password"
              />
              {fieldErrors.confirm && <p role="alert" className="mt-1.5 text-sm text-red-400">{fieldErrors.confirm}</p>}
            </div>
            <p className="text-xs text-bf-muted">You can always sign in with an emailed link instead.</p>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-0.5 accent-bf-gold"
          checked={emailOptIn}
          onChange={(e) => setEmailOptIn(e.target.checked)}
        />
        <span className="text-sm text-bf-muted leading-snug">
          Email me streak reminders and comeback bonuses. Unsubscribe anytime.
        </span>
      </label>
      <button type="submit" className="btn-primary w-full" disabled={isLoading}>
        {isLoading ? 'Saving your account...' : 'Save my account'}
      </button>
      <p className="text-xs text-bf-muted text-center mt-3 leading-relaxed">
        By saving your account, you agree to our{' '}
        <Link to="/terms" className="text-bf-gold hover:underline">Terms of Service</Link>
        {' '}and{' '}
        <Link to="/privacy" className="text-bf-gold hover:underline">Privacy Policy</Link>.
      </p>
    </form>
  );
}
