import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { SettingsRow, SettingsToggle } from './SettingsPrimitives';

interface NotificationPreferencesProps {
  /** When true, omit outer card wrapper (Settings page uses SettingsSection). */
  embedded?: boolean;
}

export default function NotificationPreferences({ embedded = false }: NotificationPreferencesProps) {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/users/me/preferences')
      .then((res) => {
        setPushEnabled(res.data.push_enabled);
        setEmailEnabled(res.data.email_notifications);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (field: 'push_enabled' | 'email_notifications', value: boolean) => {
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
        description="Get notified when it's your turn in async games"
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
        label="Email Notifications"
        description="Receive an email when it's your turn in async games"
      >
        <SettingsToggle
          label="Email Notifications"
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
