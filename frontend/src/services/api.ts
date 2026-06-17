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

/**
 * User-facing message for a "server busy" response. The backend's 429
 * (rate-limit / pool-admission shed) and 503 bodies use a `message` field; many
 * UI call sites read `error.response.data.error`, so without normalizing this a
 * burst rejection shows a generic "Failed to …" instead of a retryable hint.
 */
export function busyMessageFor(status: number, message?: string): string {
  if (message) return message;
  return status === 429
    ? 'Too many requests — please slow down and try again in a moment.'
    : 'The server is busy right now. Please try again in a moment.';
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
      // Guests go through the same refresh path as registered users — their
      // 4h access token can expire mid-session, and the refresh cookie
      // recovers it without destroying the (unrecoverable) guest identity.
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
        const success = (await useAuthStore.getState().refreshToken({ silent: false })) === 'ok';
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

    // 429 (rate-limited / pool-admission shed) & 503 (overloaded): smooth a
    // transient launch-burst hiccup and surface a friendly, retryable message.
    const busyStatus = error.response?.status;
    if (busyStatus === 429 || busyStatus === 503) {
      const busyRequest = originalRequest as
        | (InternalAxiosRequestConfig & { _retriedBusy?: boolean })
        | undefined;
      const method = (busyRequest?.method ?? 'get').toLowerCase();
      // Auto-retry idempotent GETs once (a POST could double-submit). Respect
      // Retry-After if present, capped; otherwise a short fixed backoff.
      if (busyRequest && method === 'get' && !busyRequest._retriedBusy) {
        busyRequest._retriedBusy = true;
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 800;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return api(busyRequest);
      }
      // Normalize the body so existing `data.error` reads show the real message.
      const data = error.response?.data as { error?: string; message?: string } | undefined;
      if (data && typeof data === 'object' && !data.error) {
        data.error = busyMessageFor(busyStatus, data.message);
      }
    }

    return Promise.reject(error);
  }
);
