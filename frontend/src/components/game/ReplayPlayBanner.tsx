import { useAuthStore } from '../../store/authStore';
import { useOnboardingTutorialFirstEnabled, usePlayerLinksPlayEnabled } from '../../store/featureFlagsStore';
import { useGuestStart } from '../../hooks/useGuestStart';
import { trackVisitEvent } from '../../utils/visitAnalytics';

/** Whether a replay offers this viewer a game: signed out, with `player_links_play_enabled` on. */
export function useReplayOffersPlay(): boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = usePlayerLinksPlayEnabled();
  return enabled && !isAuthenticated;
}

/**
 * Play free, as the landing page starts a guest: the guided tutorial first for
 * a new guest when `onboarding_tutorial_first_enabled` is on, else the lobby.
 * Nothing for a signed-in viewer or with `player_links_play_enabled` off.
 */
export function ReplayPlayFreeButton({ className = 'btn-primary shrink-0 text-sm px-4 py-1.5' }: { className?: string }) {
  const offersPlay = useReplayOffersPlay();
  const tutorialFirst = useOnboardingTutorialFirstEnabled();
  const { start, starting } = useGuestStart();
  if (!offersPlay) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={starting}
      onClick={() => {
        trackVisitEvent('hero_play_clicked', { placement: 'replay' });
        void start((isNewGuest) => (isNewGuest && tutorialFirst ? '/tutorial?start=1' : '/lobby'));
      }}
    >
      {starting ? 'Starting…' : 'Play free'}
    </button>
  );
}

/**
 * A replay's offer of a game to a signed-out viewer, most often one who came
 * from a shared link (`player_links_play_enabled`).
 */
export default function ReplayPlayBanner() {
  const offersPlay = useReplayOffersPlay();
  if (!offersPlay) return null;
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-bf-border bg-bf-gold/10">
      <p className="text-sm text-bf-text">Borderfall is a free strategy game on a 3D globe. Play in your browser.</p>
      <ReplayPlayFreeButton />
    </div>
  );
}
