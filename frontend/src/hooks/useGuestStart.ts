import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore, waitForAuthBootstrap } from '../store/authStore';

/**
 * Start playing as a guest from a page a signed-out visitor landed on (an
 * invite, a shared replay), then go on to `to`, which may depend on whether a
 * guest was just made. Without `to` it stays put, for a page that moves on by
 * itself once signed in.
 *
 * As on the landing page (pages/LandingPage.tsx `handleGuest`), the silent
 * refresh settles first and a live session is never replaced by a new guest:
 * that would abandon the player's account and any game in progress.
 */
export function useGuestStart(): {
  start: (to?: string | ((isNewGuest: boolean) => string)) => Promise<void>;
  starting: boolean;
} {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const start = useCallback(
    async (to?: string | ((isNewGuest: boolean) => string)) => {
      setStarting(true);
      try {
        await waitForAuthBootstrap();
        const isNewGuest = !useAuthStore.getState().isAuthenticated;
        if (isNewGuest) await useAuthStore.getState().loginAsGuest();
        if (to) navigate(typeof to === 'function' ? to(isNewGuest) : to);
      } catch {
        toast.error('Could not start a guest game. Please try again.');
        setStarting(false);
      }
    },
    [navigate],
  );
  return { start, starting };
}
