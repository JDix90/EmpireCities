import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings,
  Coins,
  Bell,
  Zap,
  User as UserIcon,
  KeyRound,
  ChevronRight,
  Monitor,
  Volume2,
  Eye,
  Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import SubpageShell from '../components/ui/SubpageShell';
import NotificationPreferences from '../components/settings/NotificationPreferences';
import {
  SettingsSection,
  SettingsRow,
  SettingsToggle,
  SettingsSelect,
  SettingsSlider,
  SettingsGuestNotice,
} from '../components/settings/SettingsPrimitives';
import {
  getFastCombatPreference,
  setFastCombatPreference,
  getInitialMapView,
  setMapViewPreference,
  getGlobeSpinPreference,
  setGlobeSpinPreference,
  getCameraFollowPreference,
  setCameraFollowPreference,
  isLiteMode,
  setLiteMode,
  getConnectionHintPreference,
  setConnectionHintPreference,
  CONNECTION_HINT_LABELS,
  getSfxVolume,
  setSfxVolume,
  isSfxMuted,
  setSfxMuted,
  isColorblindMode,
  setColorblindMode,
  isHighContrastMode,
  setHighContrastMode,
  subscribeUserPreferences,
  type ConnectionHintPreference,
  type MapViewPreference,
  type FriendRequestsPolicy,
} from '../utils/userPreferences';

const FRIEND_REQUEST_POLICY_LABELS: Record<FriendRequestsPolicy, string> = {
  everyone: 'Everyone',
  friends_of_friends: 'Friends of friends',
  nobody: 'Nobody',
};

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gold = useAuthStore((s) => s.user?.gold ?? 0);
  const logout = useAuthStore((s) => s.logout);
  const isGuest = Boolean(user?.is_guest);

  const [fastCombat, setFastCombat] = useState(getFastCombatPreference);
  const [mapView, setMapView] = useState<MapViewPreference>(getInitialMapView);
  const [globeSpin, setGlobeSpin] = useState(getGlobeSpinPreference);
  const [cameraFollow, setCameraFollow] = useState(getCameraFollowPreference);
  const [liteMode, setLiteModeState] = useState(isLiteMode);
  const [connectionHints, setConnectionHints] = useState<ConnectionHintPreference>(getConnectionHintPreference);
  const [sfxVolume, setSfxVolumeState] = useState(getSfxVolume);
  const [sfxMuted, setSfxMutedState] = useState(isSfxMuted);
  const [colorblindMode, setColorblindModeState] = useState(isColorblindMode);
  const [highContrast, setHighContrastState] = useState(isHighContrastMode);

  const [friendRequestsPolicy, setFriendRequestsPolicy] = useState<FriendRequestsPolicy>('everyone');
  const [privacyLoading, setPrivacyLoading] = useState(true);

  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => subscribeUserPreferences(() => {
    setFastCombat(getFastCombatPreference());
    setMapView(getInitialMapView());
    setGlobeSpin(getGlobeSpinPreference());
    setCameraFollow(getCameraFollowPreference());
    setLiteModeState(isLiteMode());
    setConnectionHints(getConnectionHintPreference());
    setSfxVolumeState(getSfxVolume());
    setSfxMutedState(isSfxMuted());
    setColorblindModeState(isColorblindMode());
    setHighContrastState(isHighContrastMode());
  }), []);

  useEffect(() => {
    if (isGuest) {
      setPrivacyLoading(false);
      return;
    }
    api
      .get('/users/me/preferences')
      .then((res) => {
        const policy = res.data.friend_requests_policy as FriendRequestsPolicy | undefined;
        if (policy === 'everyone' || policy === 'friends_of_friends' || policy === 'nobody') {
          setFriendRequestsPolicy(policy);
        }
      })
      .catch(() => {})
      .finally(() => setPrivacyLoading(false));
  }, [isGuest]);

  const updateFriendRequestsPolicy = (policy: FriendRequestsPolicy) => {
    setFriendRequestsPolicy(policy);
    api.put('/users/me/preferences', { friend_requests_policy: policy }).catch(() => {
      toast.error('Failed to save privacy setting');
    });
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

  const connectionHintOptions = (['auto', 'full', 'borders', 'off'] as const).map((value) => ({
    value,
    label: CONNECTION_HINT_LABELS[value],
  }));

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
        <SettingsSection title="Account" icon={UserIcon}>
          <div className="space-y-1">
            <SettingsRow label="Username" description="Your commander name across Borderfall">
              <span className="text-sm text-bf-text font-medium">{user?.username ?? '—'}</span>
            </SettingsRow>
            <Link to="/profile" className="flex items-center justify-between py-2 group">
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
        </SettingsSection>

        <SettingsSection title="Notifications" icon={Bell}>
          {isGuest ? (
            <SettingsGuestNotice message="Sign in with a full account to manage notification preferences." />
          ) : (
            <NotificationPreferences embedded />
          )}
        </SettingsSection>

        <SettingsSection title="Display &amp; map" icon={Monitor}>
          <div className="space-y-3">
            <SettingsRow
              label="Default map view"
              description="Which view to open when entering a game"
            >
              <SettingsSelect<MapViewPreference>
                aria-label="Default map view"
                value={mapView}
                onChange={(value) => {
                  setMapView(value);
                  setMapViewPreference(value);
                }}
                options={[
                  { value: 'globe', label: '3D Globe' },
                  { value: '2d', label: '2D Map' },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label="Globe auto-spin"
              description="Slowly rotate the globe when idle (disabled on mobile by default)"
            >
              <SettingsToggle
                label="Globe auto-spin"
                checked={globeSpin}
                onChange={(checked) => {
                  setGlobeSpin(checked);
                  setGlobeSpinPreference(checked);
                }}
              />
            </SettingsRow>
            <SettingsRow
              label="Follow the action"
              description="Recenter the globe on battles and reinforcements (always pauses while you're dragging)"
            >
              <SettingsToggle
                label="Follow the action"
                checked={cameraFollow}
                onChange={(checked) => {
                  setCameraFollow(checked);
                  setCameraFollowPreference(checked);
                }}
              />
            </SettingsRow>
            <SettingsRow
              label="Connection hints"
              description="How territory connections are shown during attack and fortify"
            >
              <SettingsSelect<ConnectionHintPreference>
                aria-label="Connection hints"
                value={connectionHints}
                onChange={(value) => {
                  setConnectionHints(value);
                  setConnectionHintPreference(value);
                }}
                options={connectionHintOptions}
              />
            </SettingsRow>
            <SettingsRow
              label="Reduced animations"
              description="Lighter visuals for low-end devices; also respects OS reduce-motion"
            >
              <SettingsToggle
                label="Reduced animations"
                checked={liteMode}
                onChange={(checked) => {
                  setLiteModeState(checked);
                  setLiteMode(checked);
                }}
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        <SettingsSection title="Audio" icon={Volume2}>
          <div className="space-y-3">
            <SettingsRow
              label="Sound effects"
              description="Combat and ability sounds (music not yet available)"
            >
              <SettingsSlider
                label="Sound effects volume"
                value={sfxVolume}
                disabled={sfxMuted}
                onChange={(value) => {
                  setSfxVolumeState(value);
                  setSfxVolume(value);
                }}
              />
            </SettingsRow>
            <SettingsRow label="Mute sound effects">
              <SettingsToggle
                label="Mute sound effects"
                checked={sfxMuted}
                onChange={(checked) => {
                  setSfxMutedState(checked);
                  setSfxMuted(checked);
                }}
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        <SettingsSection title="Accessibility" icon={Eye}>
          <div className="space-y-3">
            <SettingsRow
              label="Colorblind-friendly colors"
              description="Use distinct player and region colors on the map"
            >
              <SettingsToggle
                label="Colorblind-friendly colors"
                checked={colorblindMode}
                onChange={(checked) => {
                  setColorblindModeState(checked);
                  setColorblindMode(checked);
                }}
              />
            </SettingsRow>
            <SettingsRow
              label="High contrast UI"
              description="Stronger borders and text contrast in menus and panels"
            >
              <SettingsToggle
                label="High contrast UI"
                checked={highContrast}
                onChange={(checked) => {
                  setHighContrastState(checked);
                  setHighContrastMode(checked);
                }}
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        <SettingsSection title="Gameplay" icon={Zap}>
          <SettingsRow
            icon={Zap}
            label="Fast combat animations"
            description="Skip drawn-out battle animations for quicker turns"
          >
            <SettingsToggle
              label="Fast combat animations"
              checked={fastCombat}
              onChange={(checked) => {
                setFastCombat(checked);
                setFastCombatPreference(checked);
              }}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Privacy" icon={Shield}>
          {isGuest ? (
            <SettingsGuestNotice message="Sign in to manage who can send you friend requests." />
          ) : privacyLoading ? (
            <p className="text-bf-muted text-sm py-2">Loading…</p>
          ) : (
            <SettingsRow
              label="Friend requests"
              description="Control who can send you a friend request"
            >
              <SettingsSelect<FriendRequestsPolicy>
                aria-label="Friend request policy"
                value={friendRequestsPolicy}
                onChange={updateFriendRequestsPolicy}
                options={(
                  ['everyone', 'friends_of_friends', 'nobody'] as const
                ).map((value) => ({
                  value,
                  label: FRIEND_REQUEST_POLICY_LABELS[value],
                }))}
              />
            </SettingsRow>
          )}
        </SettingsSection>
      </div>
    </SubpageShell>
  );
}
