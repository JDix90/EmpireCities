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
const MOBILE_MENU_HINT_SEEN_KEY = 'cc-mobile-menu-hint-seen';
const TUTORIAL_PROGRESS_KEY = 'cc-tutorial-progress';

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

// ── Mobile menu discovery hint ────────────────────────────────────────────────
// One-time attention pulse on the mobile menu button so new players discover the
// HUD (Status / Players / Log) without needing to be told to rotate or hunt.

export function hasSeenMobileMenuHint(): boolean {
  return readBool(MOBILE_MENU_HINT_SEEN_KEY, false);
}

export function markMobileMenuHintSeen(): void {
  writeBool(MOBILE_MENU_HINT_SEEN_KEY, true);
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

// ── Tutorial progress ────────────────────────────────────────────────────────

export interface TutorialProgress {
  /** Which game this progress belongs to; progress from another game is meaningless. */
  gameId: string;
  /** Index into the lesson's step list. */
  step: number;
  /** Reached the wrap-up via "Skip to the end" rather than by playing. */
  skipped: boolean;
}

/** Guard against a step index large enough to look like corruption. */
const MAX_TUTORIAL_STEP = 100;

/**
 * The coached step lives in React state, so a reload used to restart an
 * ~8-minute tutorial at "Welcome, Commander!" on a board already several turns
 * in — game state is Redis-authoritative and survives, the coaching did not.
 * Persisted per game id: progress from a different tutorial is discarded rather
 * than dropping the player into the middle of a lesson they never started.
 */
export function readTutorialProgress(gameId: string | undefined): TutorialProgress | null {
  if (typeof window === 'undefined' || !gameId) return null;
  try {
    const raw = localStorage.getItem(TUTORIAL_PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { gameId: storedId, step, skipped } = parsed as Record<string, unknown>;
    if (storedId !== gameId) return null;
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > MAX_TUTORIAL_STEP) {
      return null;
    }
    return { gameId, step, skipped: skipped === true };
  } catch {
    return null;
  }
}

export function writeTutorialProgress(gameId: string, step: number, skipped: boolean): void {
  try {
    localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ gameId, step, skipped }));
  } catch {
    /* ignore */
  }
}

/** Drop stored progress — the tutorial was abandoned, so nothing is worth resuming. */
export function clearTutorialProgress(): void {
  try {
    localStorage.removeItem(TUTORIAL_PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

// ── Backward-compatible aliases (device.ts consumers) ─────────────────────────

export const persistGlobeSpinPreference = setGlobeSpinPreference;
export const persistCameraFollowPreference = setCameraFollowPreference;
export const persistLiteMode = setLiteMode;
export const persistMapView = setMapViewPreference;
export const persistConnectionHintPreference = setConnectionHintPreference;
