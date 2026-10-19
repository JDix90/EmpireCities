import { useAuthStore } from '../../store/authStore';
import { useOnboardingTutorialFirstEnabled, usePlayerLinksPlayEnabled } from '../../store/featureFlagsStore';
import { useGuestStart } from '../../hooks/useGuestStart';
import { trackVisitEvent } from '../../utils/visitAnalytics';

/**
 * A replay's offer of a game to a signed-out viewer, most often one who came
 * from a shared link (`player_links_play_enabled`). Play free is the landing
 * page's guest start: the guided tutorial first for a new guest when
 * `onboarding_tutorial_first_enabled` is on, else the lobby.
 */
export default function ReplayPlayBanner() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = usePlayerLinksPlayEnabled();
  const tutorialFirst = useOnboardingTutorialFirstEnabled();
  const { start, starting } = useGuestStart();
  if (isAuthenticated || !enabled) return null;
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-bf-border bg-bf-gold/10">
      <p className="text-sm text-bf-text">Borderfall is a free strategy game on a 3D globe. Play in your browser.</p>
      <button
        type="button"
        className="btn-primary shrink-0 text-sm px-4 py-1.5"
        disabled={starting}
        onClick={() => {
          trackVisitEvent('hero_play_clicked', { placement: 'replay' });
          void start((isNewGuest) => (isNewGuest && tutorialFirst ? '/tutorial?start=1' : '/lobby'));
        }}
      >
        {starting ? 'Starting…' : 'Play free'}
      </button>
    </div>
  );
}
