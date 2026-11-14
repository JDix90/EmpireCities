import { Smartphone } from 'lucide-react';
import { SettingsRow } from '../settings/SettingsPrimitives';
import { useHomeScreenInstallEnabled } from '../../store/featureFlagsStore';
import { useInstallPath } from '../../services/homeScreenInstall';
import { useTrackShown } from '../../utils/funnelEvents';
import { InstallButton } from './InstallOffer';

/**
 * Settings → Notifications: put Borderfall on the home screen
 * (home_screen_install_enabled). The one place the offer is always available,
 * a "Not now" elsewhere notwithstanding, and the one place it appears in a
 * browser that can only do it from its own menu. It sits with the
 * notification settings because on an iPhone it is what they wait on.
 */
export default function HomeScreenSettingsRow() {
  const enabled = useHomeScreenInstallEnabled();
  const path = useInstallPath();
  const offered = enabled && path !== 'none' && path !== 'installed';
  useTrackShown({ event: 'install_offer_shown', surface: 'settings' }, offered, { path });
  if (!enabled || path === 'none') return null;
  if (path === 'installed') {
    return (
      <SettingsRow icon={Smartphone} label="Borderfall on your home screen" description="You are using the installed app.">
        <span className="text-xs text-bf-muted">Installed</span>
      </SettingsRow>
    );
  }
  return (
    <SettingsRow
      icon={Smartphone}
      label="Borderfall on your home screen"
      description={
        path === 'ios_share' || path === 'ios_in_app'
          ? 'Opens full screen like an app. On an iPhone or iPad it is also what lets Borderfall send you notifications.'
          : 'Opens full screen like an app, straight to your games. No app store, nothing to download.'
      }
    >
      <InstallButton surface="settings" />
    </SettingsRow>
  );
}
