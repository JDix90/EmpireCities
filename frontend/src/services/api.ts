import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import { getApiBaseUrl } from '../config/env';

/** Wrong-password responses must not trigger refresh-token rotation (side effects + confusing retries). */
function isAuthCredentialPost(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? '';
  const method = (config.method ?? 'get').toLowerCase();
  if (method !== 'post') return false;
  return url.includes('/auth/login') || url.includes('/auth/register');
}

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// ── Request interceptor: attach access token ─────────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: auto-refresh on 401 ────────────────────────────────
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function drainQueue(token: string | null, error?: unknown) {
  refreshQueue.forEach((entry) => {
    if (token) entry.resolve(token);
    else entry.reject(error ?? new Error('Token refresh failed'));
  });
  refreshQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      isAuthCredentialPost(originalRequest)
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (useAuthStore.getState().user?.is_guest) {
        useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false });
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: (token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const success = await useAuthStore.getState().refreshToken({ silent: false });
        if (success) {
          const newToken = useAuthStore.getState().accessToken!;
          drainQueue(newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
        drainQueue(null, error);
      } catch (refreshError) {
        drainQueue(null, refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
