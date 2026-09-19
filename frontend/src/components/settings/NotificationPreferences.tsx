import { useEffect, useState } from 'react';
import { Bell, Gift, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { SettingsRow, SettingsToggle } from './SettingsPrimitives';

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

  if (loading) {
    return <p className="text-bf-muted text-sm py-2">Loading…</p>;
  }

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
