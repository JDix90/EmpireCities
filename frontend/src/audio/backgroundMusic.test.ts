import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundMusicEngine,
  ERA_MUSIC_PROFILES,
  degreeToHz,
  musicTensionFor,
  profileForEra,
} from './backgroundMusic';
import { setLiteMode, setMusicMuted, setMusicVolume } from '../utils/userPreferences';

// ── Pure parts ───────────────────────────────────────────────────────────────

describe('profileForEra', () => {
  it('has a palette for every playable era and falls back to Ancient', () => {
    for (const era of ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'space_age', 'galaxy_age']) {
      expect(ERA_MUSIC_PROFILES[era]).toBeDefined();
    }
    expect(profileForEra('custom')).toBe(ERA_MUSIC_PROFILES.ancient);
    expect(profileForEra(null)).toBe(ERA_MUSIC_PROFILES.ancient);
  });

  it('keeps every palette inside a calm, playable range', () => {
    for (const [era, p] of Object.entries(ERA_MUSIC_PROFILES)) {
      expect(p.bpm, era).toBeGreaterThanOrEqual(50);
      expect(p.bpm, era).toBeLessThanOrEqual(100);
      expect(p.pulsePattern, era).toHaveLength(16);
      expect(p.filterTense, era).toBeGreaterThan(p.filterRest);
      for (const chord of p.progression) expect(chord.length, era).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('degreeToHz', () => {
  it('walks the scale and climbs an octave past its end', () => {
    const p = ERA_MUSIC_PROFILES.ancient; // A2 pentatonic minor
    expect(degreeToHz(p, 0)).toBeCloseTo(110, 3);
    expect(degreeToHz(p, 5)).toBeCloseTo(220, 3);   // wraps: degree 5 of a 5-note scale = root up an octave
    expect(degreeToHz(p, 0, 1)).toBeCloseTo(220, 3);
    expect(degreeToHz(p, 1)).toBeCloseTo(110 * Math.pow(2, 3 / 12), 3);
  });
});

describe('musicTensionFor', () => {
  const base = { phase: 'draft', isMyTurn: false, underAttack: false, gameOver: false };
  it('leans in for combat and settles between turns', () => {
    expect(musicTensionFor({ ...base })).toBe(0.1);
    expect(musicTensionFor({ ...base, isMyTurn: true })).toBe(0.25);
    expect(musicTensionFor({ ...base, isMyTurn: true, phase: 'attack' })).toBe(0.6);
    expect(musicTensionFor({ ...base, underAttack: true })).toBe(0.85);
  });
  it('drops to nothing at game over regardless of the rest', () => {
    expect(musicTensionFor({ ...base, underAttack: true, gameOver: true })).toBe(0);
  });
});

// ── Engine against a stub AudioContext ───────────────────────────────────────

type Fn = ReturnType<typeof vi.fn>;
interface StubParam { value: number; setValueAtTime: Fn; setTargetAtTime: Fn; exponentialRampToValueAtTime: Fn; cancelScheduledValues: Fn }
function param(value = 0): StubParam {
  return {
    value,
    setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
  };
}
const created = { oscillators: 0, started: 0 };
function stubNode(extra: Record<string, unknown> = {}) {
  return { connect: vi.fn(), disconnect: vi.fn(), ...extra };
}
class StubAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  createGain() { return stubNode({ gain: param(1) }); }
  createBiquadFilter() { return stubNode({ type: 'lowpass', frequency: param(0), Q: param(1) }); }
  createOscillator() {
    created.oscillators += 1;
    return stubNode({
      type: 'sine', frequency: param(440), detune: param(0),
      start: vi.fn(() => { created.started += 1; }), stop: vi.fn(),
    });
  }
}

describe('BackgroundMusicEngine', () => {
  beforeEach(() => {
    localStorage.clear();
    created.oscillators = 0;
    created.started = 0;
    vi.useFakeTimers();
    (window as unknown as { AudioContext: unknown }).AudioContext = StubAudioContext;
    // jsdom has no matchMedia; the reduce-motion gate reads it.
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('opens the graph, runs the scheduler, and tears down cleanly', () => {
    const engine = new BackgroundMusicEngine();
    expect(engine.start('medieval')).toBe(true);
    expect(engine.isRunning).toBe(true);
    // Pad voices (2 oscillators each) + 2 drones + the filter LFO.
    const voices = Math.max(...ERA_MUSIC_PROFILES.medieval.progression.map((c) => c.length));
    expect(created.started).toBe(voices * 2 + 2 + 1);

    // Under tension the scheduler queues pulses; below it, nothing extra.
    engine.setTension(0.8);
    const before = created.oscillators;
    vi.advanceTimersByTime(400);
    expect(created.oscillators).toBeGreaterThan(before);

    engine.setEra('coldwar');
    engine.playEraSwell();
    engine.stop(0.5);
    expect(engine.isRunning).toBe(false);
    vi.advanceTimersByTime(3000); // teardown timers must not throw
  });

  it('is idempotent and safe when idle', () => {
    const engine = new BackgroundMusicEngine();
    engine.setEra('ww2');
    engine.setTension(0.5);
    engine.setVolume(0.3);
    engine.setVisible(false);
    engine.playEraSwell();
    engine.playCadence('victory');
    engine.stop();
    expect(engine.isRunning).toBe(false);
    expect(engine.start('ww2')).toBe(true);
    expect(engine.start('ww2')).toBe(true);
  });

  it('refuses to start when muted, at zero volume, or in lite mode', () => {
    const engine = new BackgroundMusicEngine();
    setMusicMuted(true);
    expect(engine.start('ancient')).toBe(false);
    setMusicMuted(false);
    setMusicVolume(0);
    expect(engine.start('ancient')).toBe(false);
    setMusicVolume(40);
    setLiteMode(true);
    expect(engine.start('ancient')).toBe(false);
    setLiteMode(false);
    expect(engine.start('ancient')).toBe(true);
    engine.stop();
  });

  it('plays a cadence and then fades itself out', () => {
    const engine = new BackgroundMusicEngine();
    engine.start('modern');
    engine.playCadence('defeat');
    expect(engine.isRunning).toBe(true);
    vi.advanceTimersByTime(2700);
    expect(engine.isRunning).toBe(false);
  });

  it('suspends the clock while the tab is hidden and resumes on return', () => {
    const engine = new BackgroundMusicEngine();
    engine.start('space_age');
    engine.setVisible(false);
    engine.setVisible(true);
    expect(engine.isRunning).toBe(true);
    engine.stop();
  });
});
