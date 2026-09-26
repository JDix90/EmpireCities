import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import axios from 'axios';
import { api } from '../services/api';
import { resyncSocketAuth, disconnectSocket } from '../services/socket';
import { getApiBaseUrl, REQUEST_TIMEOUT_MS } from '../config/env';
import { embedderHeaders } from '../utils/embedContext';
import { getSignupAttribution } from '../utils/attribution';
import { safeLocalStorage } from '../utils/safeStorage';

// `rawHttp` bypasses the api interceptors, and it is the instance that calls
// /auth/guest and /auth/refresh — the two endpoints that WRITE the refresh
// cookie. It therefore needs the embedder header just as much as `api` does:
// without it the server cannot tell a framed request from a direct one, and
// the cookie it writes is never sent back inside the frame.
const rawHttp = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: { ...embedderHeaders() },
  // Without this, a stalled connection hangs /auth/refresh indefinitely and
  // `bootstrapped` never flips — which parks every caller of
  // `waitForAuthBootstrap`, the landing CTA included. A timeout is safe here
  // by design: `classifyRefreshFailure` maps a response-less error to
  // 'unreachable', which KEEPS the session and lets App.tsx retry with
  // backoff, rather than logging the player out.
  timeout: REQUEST_TIMEOUT_MS,
});

/**
 * Outcome of a refresh-token attempt:
 * - 'ok': new access token issued.
 * - 'invalid': the server processed the request and rejected the cookie —
 *   the session is genuinely over; clear it and surface the login screen.
 * - 'unreachable': we never got an answer (network error, timeout, 5xx) —
 *   e.g. a reload racing a backend restart/deploy. The cookie may be
 *   perfectly valid, so the session must NOT be cleared; callers retry.
 */
export type RefreshOutcome = 'ok' | 'invalid' | 'unreachable';

/** Exported for tests. Only an explicit auth rejection invalidates the session. */
export function classifyRefreshFailure(err: unknown): Exclude<RefreshOutcome, 'ok'> {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return 'invalid';
  }
  return 'unreachable';
}

export interface RatingInfo {
  mu: number;
  phi: number;
  display: number;
  provisional: boolean;
}

export interface AuthUser {
  user_id: string;
  username: string;
  level: number;
  xp: number;
  mmr: number;
  avatar_url?: string;
  ratings?: { solo?: RatingInfo; ranked?: RatingInfo };
  equipped_frame?: string | null;
  /** Its own slot with store_v2_enabled on; off, a banner is worn in `equipped_frame`. */
  equipped_banner?: string | null;
  equipped_marker?: string | null;
  equipped_dice?: string | null;
  gold?: number;
  /** Set for JWTs from POST /api/auth/guest */
  is_guest?: boolean;
  /** True when the user can access /admin routes. */
  is_admin?: boolean;
  /** True once the basic tutorial has been completed. */
  has_completed_tutorial?: boolean;
  /** Module IDs completed server-side (populated from /api/users/me). */
  tutorial_modules_completed?: string[];
  /** Onboarding quest stage (0–5, null = completed) */
  onboarding_stage?: number | null;
  /** Current win streak */
  win_streak?: number;
  /** Current daily streak */
  daily_streak?: number;
  /** Prestige level (reset count) */
  prestige?: number;
}

interface AuthState {
  user: AuthUser | null;
  /**
   * Access token lives in MEMORY ONLY. Persisting it to localStorage would
   * make any successful XSS into a session-takeover vulnerability — the
   * refresh cookie is HttpOnly, but localStorage is wide open to scripts.
   * On reload, we recover the token via the silent-refresh round-trip (see
   * `bootstrapAuth` in App.tsx).
   */
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * True once the on-load silent-refresh attempt has finished (success or
   * failure). PrivateRoute waits on this before redirecting unauthenticated
   * users so a reload does not flash them to /login while the refresh is
   * still in flight.
   */
  bootstrapped: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, emailOptIn?: boolean) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  /** Convert the current guest session into a full account in place (keeps user_id and all progression). */
  upgradeAccount: (username: string, email: string, password: string, emailOptIn?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: (options?: { silent?: boolean }) => Promise<RefreshOutcome>;
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  setBootstrapped: (bootstrapped: boolean) => void;
  /** Re-fetch the current user's profile from the server and update the cache. */
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,
      isAuthenticated: false,
      bootstrapped: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/login', { email, password });
          const { accessToken, user } = res.data;
          try {
            sessionStorage.removeItem('cc-auth-notice');
          } catch { /* ignore */ }
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
          // The socket is a singleton; an already-connected socket keeps the
          // previous identity's token (e.g. a guest session), which makes
          // game:join fail with "Not a participant" for this user's games.
          // Reconnect with the fresh token so the socket identity matches HTTP.
          resyncSocketAuth();
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      register: async (username, email, password, emailOptIn) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/register', {
            username, email, password,
            email_opt_in: Boolean(emailOptIn),
            attribution: getSignupAttribution(),
          });
          const { accessToken, user } = res.data;
          try {
            sessionStorage.removeItem('cc-auth-notice');
          } catch { /* ignore */ }
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
          resyncSocketAuth();
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      loginAsGuest: async () => {
        set({ isLoading: true });
        try {
          const res = await rawHttp.post('/auth/guest', { attribution: getSignupAttribution() });
          const { accessToken, user } = res.data;
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
          resyncSocketAuth();
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      upgradeAccount: async (username, email, password, emailOptIn) => {
        set({ isLoading: true });
        try {
          // Converts the guest's users row IN PLACE — same user_id, so XP,
          // level, streaks, and (now-visible) ratings all carry over.
          const res = await api.post('/auth/upgrade', {
            username, email, password,
            email_opt_in: Boolean(emailOptIn),
            attribution: getSignupAttribution(),
          });
          const { accessToken, user } = res.data;
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
          // The singleton socket still authenticates with the guest JWT;
          // reconnect so the server sees the full-account identity.
          resyncSocketAuth();
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        try {
          // Guests included: they hold a refresh cookie now, and logout is
          // what revokes it server-side and clears it from the browser.
          await api.post('/auth/logout');
        } catch {
          // Best-effort — local state is cleared regardless.
        } finally {
          try {
            sessionStorage.removeItem('cc-auth-notice');
          } catch { /* ignore */ }
          // Logout completes the bootstrap flow as well — no pending refresh in flight.
          set({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
          // Drop the singleton socket so it can't keep operating under the
          // logged-out identity's token after a subsequent login.
          disconnectSocket();
        }
      },

      refreshToken: async (options) => {
        const silent = options?.silent ?? false;
        // Guests refresh like everyone else: POST /api/auth/guest issues the
        // same HttpOnly refresh cookie, and rotation preserves the guest claim.
        try {
          const res = await rawHttp.post('/auth/refresh');
          const { accessToken } = res.data;
          set({ accessToken, isAuthenticated: true });
          resyncSocketAuth();
          return 'ok';
        } catch (err) {
          const outcome = classifyRefreshFailure(err);
          if (outcome === 'invalid') {
            set({ user: null, accessToken: null, isAuthenticated: false });
            if (!silent && typeof window !== 'undefined') {
              try {
                sessionStorage.setItem('cc-auth-notice', 'session_expired');
              } catch { /* ignore */ }
            }
          }
          // 'unreachable' keeps the session: the cookie may still be valid
          // and a backend restart must not log every player out.
          return outcome;
        }
      },

      setUser: (user) => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
      setBootstrapped: (bootstrapped) => set({ bootstrapped }),

      refreshUser: async () => {
        // Only meaningful when logged in; skip silently otherwise.
        if (!get().isAuthenticated) return;
        try {
          const res = await api.get('/users/me');
          const fresh = res.data?.user ?? res.data;
          if (fresh) {
            // Merge so we never drop fields the /me payload might omit.
            set({ user: { ...(get().user ?? {}), ...fresh } as AuthUser });
          }
        } catch {
          // Non-critical: keep showing the cached profile if the refresh fails.
        }
      },
    }),
    {
      name: 'cc-auth',
      // A cross-site iframe whose browser blocks third-party storage has no
      // Web Storage at all — access throws — and zustand then drops its
      // `store.persist` API entirely, which used to blank the whole embed at
      // first paint. safeLocalStorage degrades to per-tab memory instead.
      // The stored shape is unchanged, and provably so: zustand's own default
      // is `createJSONStorage(() => localStorage)`, so this swaps only which
      // object that same helper wraps. Slices already in players' browsers
      // rehydrate exactly as before — the deploy logs nobody out.
      storage: createJSONStorage(() => safeLocalStorage()),
      // accessToken is intentionally OMITTED — see the field's docstring.
      // We persist `user` so the first paint after reload can render the
      // user's name/avatar without waiting for the silent refresh to land,
      // and `isAuthenticated` so PrivateRoute knows to attempt a refresh
      // rather than bouncing to /login.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * How long `waitForAuthBootstrap` will wait before giving up. The silent
 * refresh normally lands in ~200-500 ms; this only has to be generous enough
 * not to fire on a slow-but-working network.
 */
const BOOTSTRAP_WAIT_MS = 3000;

/**
 * Resolve once the initial silent refresh has settled.
 *
 * On reload `isAuthenticated` and `user` come back from localStorage, but
 * `accessToken` is memory-only — so until App.tsx's silent refresh lands, the
 * persisted flags are a GUESS: the refresh cookie may be gone and the session
 * already dead. Anything branching on "is this player already someone?" has to
 * wait for that, or it either fires authenticated requests with no token (401)
 * or mistakes a dead session for a live one.
 */
export function waitForAuthBootstrap(timeoutMs = BOOTSTRAP_WAIT_MS): Promise<void> {
  if (useAuthStore.getState().bootstrapped) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    // `finish` reads `timer` and `unsub` only when called, which is always
    // after both are assigned: a timer cannot fire synchronously, and zustand
    // does not invoke a fresh subscriber on subscribe.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve();
    };
    // `bootstrapped` always flips eventually — App.tsx sets it in a `finally`
    // — but the request behind it, POST /auth/refresh on `rawHttp`, carries no
    // timeout of its own, so a stalled connection could park a caller
    // indefinitely. Give up at the cap instead and let the caller fall back to
    // the persisted auth flags, which is what it would have used anyway.
    const timer = setTimeout(finish, timeoutMs);
    const unsub = useAuthStore.subscribe((state) => {
      if (state.bootstrapped) finish();
    });
    // Re-check synchronously in case it flipped between getState() and subscribe().
    if (useAuthStore.getState().bootstrapped) finish();
  });
}

/**
 * Decode the `admin` claim from the (memory-only) access token. We never trust
 * the persisted `user.is_admin` field for gating admin UI: localStorage is
 * client-controlled and an attacker can flip the bit there without forging a
 * JWT. The backend always re-checks via `requireAdmin`, but routing the UI off
 * the JWT keeps a tampered localStorage from briefly rendering admin scaffolds.
 *
 * Returns `false` for missing/invalid/expired tokens.
 */
export function selectIsAdminFromToken(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payloadJson = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as { admin?: unknown; exp?: unknown };
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return false;
    }
    return payload.admin === true;
  } catch {
    return false;
  }
}
