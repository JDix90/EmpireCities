import { useEffect, useState } from 'react';
import { Bell, Gift, Mail, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import {
  enableWebPush,
  getWebPushStatus,
  needsHomeScreenInstall,
  type WebPushStatus,
} from '../../services/pushNotifications';
import { SettingsRow, SettingsToggle } from './SettingsPrimitives';

/**
 * The FCM web SDK shows a system notification only while the tab is hidden;
 * in front, the page gets a toast instead. A test that fires instantly would
 * therefore never show the lock-screen card the player is trying to see, so
 * the server is asked to wait this long and the player is told to switch away.
 */
export const TEST_PUSH_DELAY_MS = 5_000;

interface NotificationPreferencesProps {
  /** When true, omit outer card wrapper (Settings page uses SettingsSection). */
  embedded?: boolean;
}

export default function NotificationPreferences({ embedded = false }: NotificationPreferencesProps) {
  const [pushEnabled, setPushEnabled] = useState(true);
  // Transactional ("it's your turn") and marketing ("streak reminders and
  // comeback bonuses") are separate switches — see migration 041. They used
  // to share one column, so declining marketing at signup silently declined
  // turn alerts too.
  const [turnEmailsEnabled, setTurnEmailsEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  // Whether THIS browser can receive push. The account-level toggle above is
  // the server's switch for every device; this row is the browser's own
  // permission, which only a click can ask for.
  const [browserStatus, setBrowserStatus] = useState<WebPushStatus>(() => getWebPushStatus());
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .get('/users/me/preferences')
      .then((res) => {
        setPushEnabled(res.data.push_enabled);
        setTurnEmailsEnabled(res.data.turn_emails_enabled ?? true);
        setEmailEnabled(res.data.email_notifications);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (field: 'push_enabled' | 'email_notifications' | 'turn_emails_enabled', value: boolean) => {
    api.put('/users/me/preferences', { [field]: value }).catch(() => {
      toast.error('Failed to save preference');
    });
  };

  const enableThisBrowser = async () => {
    setEnabling(true);
    try {
      // enableWebPush prompts synchronously inside this click — see its doc.
      const result = await enableWebPush();
      if (result === 'granted') {
        setBrowserStatus('granted');
        toast.success('Notifications are on for this browser');
        // The account-level switch gates every device, so a browser turned on
        // while it is off would be a silent no-op. Opting in here is the
        // clearest possible "yes" to the account switch as well.
        if (!pushEnabled) {
          setPushEnabled(true);
          update('push_enabled', true);
        }
      } else if (result === 'denied') {
        setBrowserStatus('denied');
        toast.error('Notifications are blocked for this site in your browser settings');
      } else if (result === 'error') {
        toast.error("Couldn't register this browser — try again in a moment");
      } else {
        // Dismissed without a choice, or the environment changed under us.
        setBrowserStatus(getWebPushStatus());
      }
    } finally {
      setEnabling(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await api.post('/users/me/push-tokens/test', { delay_ms: TEST_PUSH_DELAY_MS });
      if (!res.data.registered) {
        toast.error('No device is registered yet — turn notifications on first');
      } else {
        toast(
          `Test on its way in ${TEST_PUSH_DELAY_MS / 1000} seconds — switch to another app or tab to see it as a system notification.`,
          { duration: 10_000, icon: '🔔' },
        );
      }
    } catch {
      toast.error("Couldn't send a test notification");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="text-bf-muted text-sm py-2">Loading…</p>;
  }

  const browserRow = (() => {
    if (browserStatus === 'unconfigured') return null;
    if (browserStatus === 'unsupported') {
      // Only worth a row when there is something the player can do about it.
      if (!needsHomeScreenInstall()) return null;
      return (
        <SettingsRow
          icon={Smartphone}
          label="This iPhone or iPad"
          description="Add Borderfall to your Home Screen (Share → Add to Home Screen), then turn notifications on from there."
        >
          <span className="text-xs text-bf-muted">Home Screen only</span>
        </SettingsRow>
      );
    }
    if (browserStatus === 'denied') {
      return (
        <SettingsRow
          icon={Smartphone}
          label="This browser"
          description="Blocked. Allow notifications for this site in your browser settings, then reload."
        >
          <span className="text-xs text-red-400">Blocked</span>
        </SettingsRow>
      );
    }
    if (browserStatus === 'granted') {
      return (
        <SettingsRow
          icon={Smartphone}
          label="This browser"
          description="Turn alerts arrive here as system notifications, even with the tab closed."
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400">On</span>
            <button
              type="button"
              className="btn-secondary text-xs py-1 px-3"
              onClick={sendTest}
              disabled={testing}
            >
              {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </SettingsRow>
      );
    }
    return (
      <SettingsRow
        icon={Smartphone}
        label="This browser"
        description="Get a system notification when it's your turn, even with the tab closed."
      >
        <button
          type="button"
          className="btn-primary text-xs py-1 px-3"
          onClick={enableThisBrowser}
          disabled={enabling}
        >
          {enabling ? 'Turning on…' : 'Turn on'}
        </button>
      </SettingsRow>
    );
  })();

  const content = (
    <div className="space-y-3">
      <SettingsRow
        icon={Bell}
        label="Push Notifications"
        description="Get notified when it's your turn in async games or a ranked match is found"
      >
        <SettingsToggle
          label="Push Notifications"
          checked={pushEnabled}
          onChange={(checked) => {
            setPushEnabled(checked);
            update('push_enabled', checked);
          }}
        />
      </SettingsRow>
      {browserRow}
      <SettingsRow
        icon={Mail}
        label="Turn reminders"
        description="Email me when it's my turn in an async game"
      >
        <SettingsToggle
          label="Turn reminders"
          checked={turnEmailsEnabled}
          onChange={(checked) => {
            setTurnEmailsEnabled(checked);
            update('turn_emails_enabled', checked);
          }}
        />
      </SettingsRow>
      <SettingsRow
        icon={Gift}
        label="Streak reminders & comeback bonuses"
        description="Occasional emails about your streak and comeback bonuses — the box from signup. Unsubscribe anytime."
      >
        <SettingsToggle
          label="Streak reminders & comeback bonuses"
          checked={emailEnabled}
          onChange={(checked) => {
            setEmailEnabled(checked);
            update('email_notifications', checked);
          }}
        />
      </SettingsRow>
    </div>
  );

  if (embedded) return content;

  return (
    <div className="card">
      <h3 className="font-display text-lg text-bf-gold flex items-center gap-2 mb-3">
        <Bell className="w-5 h-5" /> Notification Settings
      </h3>
      {content}
    </div>
  );
}
