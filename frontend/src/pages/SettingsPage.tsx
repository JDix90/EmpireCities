import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Settings, Coins, Bell, Mail, Zap, User as UserIcon, KeyRound, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import SubpageShell from '../components/ui/SubpageShell';

const FAST_COMBAT_KEY = 'cc-fast-combat';

function readFastCombat(): boolean {
  try {
    const v = localStorage.getItem(FAST_COMBAT_KEY);
    if (v !== null) return v === 'true';
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gold = useAuthStore((s) => s.user?.gold ?? 0);
  const logout = useAuthStore((s) => s.logout);
  const isGuest = Boolean(user?.is_guest);

  // Notification preferences (server-backed)
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(true);

  // Gameplay (local only)
  const [fastCombat, setFastCombat] = useState(readFastCombat);

  // Change password (inline form). The endpoint revokes every session on
  // success, so a successful change logs the user out and bounces to /login.
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => {
    api
      .get('/users/me/preferences')
      .then((res) => {
        setPushEnabled(res.data.push_enabled);
        setEmailEnabled(res.data.email_notifications);
      })
      .catch(() => {})
      .finally(() => setPrefsLoading(false));
  }, []);

  const updatePref = (field: 'push_enabled' | 'email_notifications', value: boolean) => {
    api.put('/users/me/preferences', { [field]: value }).catch(() => {
      toast.error('Failed to save preference');
    });
  };

  const updateFastCombat = (value: boolean) => {
    setFastCombat(value);
    try {
      localStorage.setItem(FAST_COMBAT_KEY, String(value));
    } catch {
      /* noop */
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwSubmitting) return;
    if (newPw !== confirmPw) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setPwSubmitting(true);
    try {
      await api.post('/auth/change-password', { current_password: currentPw, new_password: newPw });
      toast.success('Password updated — please log in again');
      await logout();
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Could not update password';
      toast.error(message);
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <SubpageShell
      title="SETTINGS"
      icon={Settings}
      maxWidth="2xl"
      headerRight={(
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bf-gold/10 border border-bf-gold/30 text-bf-gold text-sm font-medium">
          <Coins className="w-4 h-4" aria-hidden />
          <span className="tabular-nums">{gold.toLocaleString()}</span>
        </div>
      )}
    >
      <div className="space-y-6">
        {/* ── Account ── */}
        <section className="card">
          <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
            <UserIcon className="w-5 h-5" /> Account
          </h3>
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-bf-text">Username</span>
                <p className="text-xs text-bf-muted">Your commander name across Borderfall</p>
              </div>
              <span className="text-sm text-bf-text font-medium">{user?.username ?? '—'}</span>
            </div>
            <Link
              to="/profile"
              className="flex items-center justify-between py-2 group"
            >
              <div className="flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-bf-muted" />
                <span className="text-sm text-bf-text group-hover:text-bf-gold transition-colors">View profile &amp; stats</span>
              </div>
              <ChevronRight className="w-4 h-4 text-bf-muted group-hover:text-bf-gold transition-colors" />
            </Link>
            {!isGuest && (
              <>
                <button
                  type="button"
                  onClick={() => setShowPwForm((v) => !v)}
                  className="w-full flex items-center justify-between py-2 group"
                  aria-expanded={showPwForm}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-bf-muted" />
                    <span className="text-sm text-bf-text group-hover:text-bf-gold transition-colors">Change password</span>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 text-bf-muted group-hover:text-bf-gold transition-transform ${showPwForm ? 'rotate-90' : ''}`}
                  />
                </button>
                {showPwForm && (
                  <form onSubmit={handleChangePassword} className="space-y-3 pt-2 pb-1">
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder="Current password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      required
                      className="input w-full"
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="New password (min 8 characters)"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      className="input w-full"
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                      className="input w-full"
                    />
                    <p className="text-xs text-bf-muted">Changing your password signs out all devices.</p>
                    <button
                      type="submit"
                      disabled={pwSubmitting}
                      className="btn-primary text-sm px-4 py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {pwSubmitting ? 'Updating…' : 'Update password'}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── Notifications ── */}
        <section className="card">
          <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
            <Bell className="w-5 h-5" /> Notifications
          </h3>
          {prefsLoading ? (
            <p className="text-bf-muted text-sm py-2">Loading…</p>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-bf-muted" />
                  <div>
                    <span className="text-sm text-bf-text">Push Notifications</span>
                    <p className="text-xs text-bf-muted">Get notified when it&apos;s your turn in async games</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={(e) => {
                    setPushEnabled(e.target.checked);
                    updatePref('push_enabled', e.target.checked);
                  }}
                  className="w-5 h-5 accent-bf-gold"
                />
              </label>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-bf-muted" />
                  <div>
                    <span className="text-sm text-bf-text">Email Notifications</span>
                    <p className="text-xs text-bf-muted">Receive an email when it&apos;s your turn in async games</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => {
                    setEmailEnabled(e.target.checked);
                    updatePref('email_notifications', e.target.checked);
                  }}
                  className="w-5 h-5 accent-bf-gold"
                />
              </label>
            </div>
          )}
        </section>

        {/* ── Gameplay ── */}
        <section className="card">
          <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5" /> Gameplay
          </h3>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-bf-muted" />
              <div>
                <span className="text-sm text-bf-text">Fast combat animations</span>
                <p className="text-xs text-bf-muted">Skip drawn-out battle animations for quicker turns</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={fastCombat}
              onChange={(e) => updateFastCombat(e.target.checked)}
              className="w-5 h-5 accent-bf-gold"
            />
          </label>
        </section>
      </div>
    </SubpageShell>
  );
}
