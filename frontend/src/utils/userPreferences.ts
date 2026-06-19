import { isCoarsePointer, isMobileViewport, prefersReducedMotion } from './device';

export type MapViewPreference = '2d' | 'globe';
export type ConnectionHintPreference = 'auto' | 'full' | 'borders' | 'off';
export type FriendRequestsPolicy = 'everyone' | 'friends_of_friends' | 'nobody';

const FAST_COMBAT_KEY = 'cc-fast-combat';
const GLOBE_SPIN_KEY = 'cc-globe-spin';
const CAMERA_FOLLOW_KEY = 'cc-camera-follow';
const LITE_MODE_KEY = 'cc-lite-mode';
const MAP_VIEW_KEY = 'cc-preferred-map-view';
const CONNECTION_HINTS_KEY = 'cc-connection-hints';
const SFX_VOLUME_KEY = 'cc-sfx-volume';
const SFX_MUTED_KEY = 'cc-sfx-muted';
const COLORBLIND_MODE_KEY = 'cc-colorblind-mode';
const HIGH_CONTRAST_KEY = 'cc-high-contrast';

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeUserPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
    notify();
  } catch {
    /* ignore */
  }
}

function readString<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    notify();
  } catch {
    /* ignore */
  }
}

// ── Fast combat ─────────────────────────────────────────────────────────────

export function getFastCombatPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = localStorage.getItem(FAST_COMBAT_KEY);
    if (value !== null) return value === 'true';
  } catch {
    /* ignore */
  }
  return isCoarsePointer();
}

export function setFastCombatPreference(enabled: boolean): void {
  writeBool(FAST_COMBAT_KEY, enabled);
}

// ── Globe spin ──────────────────────────────────────────────────────────────

export function getGlobeSpinPreference(): boolean {
  if (typeof window === 'undefined') return false;
  if (prefersReducedMotion()) return false;
  if (isMobileViewport() || isCoarsePointer()) {
    return readBool(GLOBE_SPIN_KEY, false);
  }
  return readBool(GLOBE_SPIN_KEY, true);
}

export function setGlobeSpinPreference(enabled: boolean): void {
  writeBool(GLOBE_SPIN_KEY, enabled);
}

// ── Camera follow ─────────────────────────────────────────────────────────────

/**
 * Whether the globe auto-recenters on battles/events. Default ON. The recenter
 * additionally yields to active user interaction (see GlobeMap's shouldAutoFollow),
 * so this is the full opt-out, not the only thing that prevents the camera moving.
 */
export function getCameraFollowPreference(): boolean {
  return readBool(CAMERA_FOLLOW_KEY, true);
}

export function setCameraFollowPreference(enabled: boolean): void {
  writeBool(CAMERA_FOLLOW_KEY, enabled);
}

// ── Lite / reduced effects ──────────────────────────────────────────────────

export function isLiteMode(): boolean {
  return readBool(LITE_MODE_KEY, false);
}

export function setLiteMode(enabled: boolean): void {
  writeBool(LITE_MODE_KEY, enabled);
}

// ── Default map view ────────────────────────────────────────────────────────

export function getInitialMapView(): MapViewPreference {
  if (typeof window === 'undefined') return 'globe';
  if (isLiteMode()) return '2d';
  return readString(MAP_VIEW_KEY, ['2d', 'globe'] as const, 'globe');
}

export function setMapViewPreference(mode: MapViewPreference): void {
  writeString(MAP_VIEW_KEY, mode);
}

// ── Connection hints ────────────────────────────────────────────────────────

export const CONNECTION_HINT_LABELS: Record<ConnectionHintPreference, string> = {
  auto: 'Auto',
  full: 'Full lines',
  borders: 'Borders only',
  off: 'Off',
};

export function getConnectionHintPreference(): ConnectionHintPreference {
  return readString(
    CONNECTION_HINTS_KEY,
    ['auto', 'full', 'borders', 'off'] as const,
    'auto',
  );
}

export function setConnectionHintPreference(preference: ConnectionHintPreference): void {
  writeString(CONNECTION_HINTS_KEY, preference);
}

// ── Audio ───────────────────────────────────────────────────────────────────

const DEFAULT_SFX_VOLUME = 80;

export function getSfxVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_SFX_VOLUME;
  try {
    const raw = localStorage.getItem(SFX_VOLUME_KEY);
    if (raw === null) return DEFAULT_SFX_VOLUME;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_SFX_VOLUME;
    return Math.min(100, Math.max(0, parsed));
  } catch {
    return DEFAULT_SFX_VOLUME;
  }
}

export function setSfxVolume(volume: number): void {
  const clamped = Math.min(100, Math.max(0, Math.round(volume)));
  try {
    localStorage.setItem(SFX_VOLUME_KEY, String(clamped));
    notify();
  } catch {
    /* ignore */
  }
}

export function isSfxMuted(): boolean {
  return readBool(SFX_MUTED_KEY, false);
}

export function setSfxMuted(muted: boolean): void {
  writeBool(SFX_MUTED_KEY, muted);
}

/** Master gain 0–1 after user volume and mute. */
export function getSfxMasterGain(): number {
  if (isSfxMuted()) return 0;
  return getSfxVolume() / 100;
}

// ── Accessibility ───────────────────────────────────────────────────────────

export function isColorblindMode(): boolean {
  return readBool(COLORBLIND_MODE_KEY, false);
}

export function setColorblindMode(enabled: boolean): void {
  writeBool(COLORBLIND_MODE_KEY, enabled);
  applyAccessibilityDomPrefs();
}

export function isHighContrastMode(): boolean {
  return readBool(HIGH_CONTRAST_KEY, false);
}

export function setHighContrastMode(enabled: boolean): void {
  writeBool(HIGH_CONTRAST_KEY, enabled);
  applyAccessibilityDomPrefs();
}

export function applyAccessibilityDomPrefs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isHighContrastMode()) {
    root.dataset.highContrast = 'true';
  } else {
    delete root.dataset.highContrast;
  }
  if (isColorblindMode()) {
    root.dataset.colorblindMode = 'true';
  } else {
    delete root.dataset.colorblindMode;
  }
}

// ── Backward-compatible aliases (device.ts consumers) ─────────────────────────

export const persistGlobeSpinPreference = setGlobeSpinPreference;
export const persistCameraFollowPreference = setCameraFollowPreference;
export const persistLiteMode = setLiteMode;
export const persistMapView = setMapViewPreference;
export const persistConnectionHintPreference = setConnectionHintPreference;
