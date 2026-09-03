import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFastCombatPreference,
  getSfxVolume,
  isColorblindMode,
  setColorblindMode,
  setFastCombatPreference,
  setSfxMuted,
  setSfxVolume,
  getSfxMasterGain,
  getCameraFollowPreference,
  setCameraFollowPreference,
  persistCameraFollowPreference,
  readTutorialProgress,
  writeTutorialProgress,
  clearTutorialProgress,
} from './userPreferences';

describe('userPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists fast combat preference', () => {
    setFastCombatPreference(true);
    expect(getFastCombatPreference()).toBe(true);
    setFastCombatPreference(false);
    expect(getFastCombatPreference()).toBe(false);
  });

  it('clamps and persists sfx volume', () => {
    setSfxVolume(150);
    expect(getSfxVolume()).toBe(100);
    setSfxVolume(-5);
    expect(getSfxVolume()).toBe(0);
  });

  it('applies mute to master gain', () => {
    setSfxVolume(80);
    setSfxMuted(false);
    expect(getSfxMasterGain()).toBeCloseTo(0.8);
    setSfxMuted(true);
    expect(getSfxMasterGain()).toBe(0);
  });

  it('persists colorblind mode', () => {
    expect(isColorblindMode()).toBe(false);
    setColorblindMode(true);
    expect(isColorblindMode()).toBe(true);
  });

  it('defaults camera follow to ON and round-trips it', () => {
    expect(getCameraFollowPreference()).toBe(true);
    setCameraFollowPreference(false);
    expect(getCameraFollowPreference()).toBe(false);
    setCameraFollowPreference(true);
    expect(getCameraFollowPreference()).toBe(true);
  });

  it('exposes a persist alias for camera follow matching the setter', () => {
    expect(persistCameraFollowPreference).toBe(setCameraFollowPreference);
  });

  describe('tutorial progress', () => {
    it('round-trips step and skipped for the same game', () => {
      writeTutorialProgress('game-1', 7, true);
      expect(readTutorialProgress('game-1')).toEqual({ gameId: 'game-1', step: 7, skipped: true });
    });

    it('ignores progress belonging to a different game', () => {
      writeTutorialProgress('game-1', 7, false);
      expect(readTutorialProgress('game-2')).toBeNull();
    });

    it('returns null with no stored progress or no game id', () => {
      expect(readTutorialProgress('game-1')).toBeNull();
      writeTutorialProgress('game-1', 3, false);
      expect(readTutorialProgress(undefined)).toBeNull();
    });

    it('rejects corrupt or out-of-range stored values', () => {
      for (const raw of [
        'not json',
        '"a string"',
        JSON.stringify({ gameId: 'game-1', step: -1 }),
        JSON.stringify({ gameId: 'game-1', step: 1.5 }),
        JSON.stringify({ gameId: 'game-1', step: 10_000 }),
        JSON.stringify({ gameId: 'game-1', step: 'three' }),
      ]) {
        localStorage.setItem('cc-tutorial-progress', raw);
        expect(readTutorialProgress('game-1')).toBeNull();
      }
    });

    it('treats a missing skipped flag as not skipped', () => {
      localStorage.setItem('cc-tutorial-progress', JSON.stringify({ gameId: 'game-1', step: 2 }));
      expect(readTutorialProgress('game-1')).toEqual({ gameId: 'game-1', step: 2, skipped: false });
    });

    it('clears stored progress', () => {
      writeTutorialProgress('game-1', 4, false);
      clearTutorialProgress();
      expect(readTutorialProgress('game-1')).toBeNull();
    });
  });
});
