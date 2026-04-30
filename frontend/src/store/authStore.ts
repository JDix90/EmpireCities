import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';
import { api } from '../services/api';
import { resyncSocketAuth } from '../services/socket';
import { getApiBaseUrl } from '../config/env';

const rawHttp = axios.create({ baseURL: getApiBaseUrl(), withCredentials: true });

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
  equipped_marker?: string | null;
  gold?: number;
  /** Set for JWTs from POST /api/auth/guest */
  is_guest?: boolean;
  /** True when the user can access /admin routes. */
  is_admin?: boolean;
  /** True once the basic tutorial has been completed. */
  has_completed_tutorial?: boolean;
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
  register: (username: string, email: string, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: (options?: { silent?: boolean }) => Promise<boolean>;
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  setBootstrapped: (bootstrapped: boolean) => void;
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
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      register: async (username, email, password) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/register', { username, email, password });
          const { accessToken, user } = res.data;
          try {
            sessionStorage.removeItem('cc-auth-notice');
          } catch { /* ignore */ }
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      loginAsGuest: async () => {
        set({ isLoading: true });
        try {
          const res = await rawHttp.post('/auth/guest');
          const { accessToken, user } = res.data;
          set({ user, accessToken, isAuthenticated: true, isLoading: false, bootstrapped: true });
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        const isGuest = get().user?.is_guest;
        try {
          if (!isGuest) {
            await api.post('/auth/logout');
          }
        } finally {
          try {
            sessionStorage.removeItem('cc-auth-notice');
          } catch { /* ignore */ }
          // Logout completes the bootstrap flow as well — no pending refresh in flight.
          set({ user: null, accessToken: null, isAuthenticated: false, bootstrapped: true });
        }
      },

      refreshToken: async (options) => {
        const silent = options?.silent ?? false;
        if (get().user?.is_guest) {
          return false;
        }
        try {
          const res = await rawHttp.post('/auth/refresh');
          const { accessToken } = res.data;
          set({ accessToken, isAuthenticated: true });
          resyncSocketAuth();
          return true;
        } catch {
          set({ user: null, accessToken: null, isAuthenticated: false });
          if (!silent && typeof window !== 'undefined') {
            try {
              sessionStorage.setItem('cc-auth-notice', 'session_expired');
            } catch { /* ignore */ }
          }
          return false;
        }
      },

      setUser: (user) => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
      setBootstrapped: (bootstrapped) => set({ bootstrapped }),
    }),
    {
      name: 'cc-auth',
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
