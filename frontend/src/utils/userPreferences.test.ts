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
});
