/**
 * Production / Capacitor builds must set VITE_API_URL and VITE_SOCKET_URL at build time.
 * Local dev: leave unset to use Vite proxy (same-origin /api and socket.io).
 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** REST API base path, e.g. "/api" or "https://api.example.com/api" */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (raw && raw.trim()) {
    return `${trimTrailingSlash(raw.trim())}/api`;
  }
  return '/api';
}

/**
 * Socket.IO server origin (no path). Undefined = same as current page (Vite dev proxy).
 */
export function getSocketUrl(): string | undefined {
  const raw = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (raw && raw.trim()) {
    return trimTrailingSlash(raw.trim());
  }
  return undefined;
}
