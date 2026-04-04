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
  /** Set for JWTs from POST /api/auth/guest */
  is_guest?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,
      isAuthenticated: false,

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/login', { email, password });
          const { accessToken, user } = res.data;
          set({ user, accessToken, isAuthenticated: true, isLoading: false });
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
          set({ user, accessToken, isAuthenticated: true, isLoading: false });
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
          set({ user, accessToken, isAuthenticated: true, isLoading: false });
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
          set({ user: null, accessToken: null, isAuthenticated: false });
        }
      },

      refreshToken: async () => {
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
          return false;
        }
      },

      setUser: (user) => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
    }),
    {
      name: 'cc-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated }),
    }
  )
);
