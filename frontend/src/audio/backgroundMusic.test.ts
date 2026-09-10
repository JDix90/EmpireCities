import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackgroundMusicEngine,
  ERA_MUSIC_PROFILES,
  combatBlendFor,
  musicTensionFor,
  profileForEra,
  semisToHz,
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
      // Four chords, two bars each: one eight-bar phrase.
      expect(p.progression, era).toHaveLength(4);
      for (const chord of p.progression) expect(chord.length, era).toBeGreaterThanOrEqual(3);
      // Voiced around the third octave — below that the pad turns to mud
      // through the low-pass, above it the bed stops sitting under the SFX.
      expect(p.root, era).toBeGreaterThanOrEqual(125);
      expect(p.root, era).toBeLessThanOrEqual(180);
      for (const chord of p.progression) for (const s of chord) expect(Math.abs(s), era).toBeLessThanOrEqual(16);
      // Two bells and only two: a third starts to sound like a melody.
      expect(p.bells, era).toHaveLength(2);
      expect(p.filterHz, era).toBeGreaterThanOrEqual(400);
      expect(p.filterHz, era).toBeLessThanOrEqual(1400);
      expect(p.bellPartials[0], era).toEqual([1, 1]);
    }
  });
});

describe('semisToHz', () => {
  it('voices chords from the register root', () => {
    const p = ERA_MUSIC_PROFILES.medieval; // D3
    expect(semisToHz(p, 0)).toBeCloseTo(146.83, 2);
    expect(semisToHz(p, 12)).toBeCloseTo(293.66, 2);
    expect(semisToHz(p, -4)).toBeCloseTo(116.54, 1); // Bb2 under the D3 root
  });
});

describe('combatBlendFor', () => {
  it('keeps the combat layer silent on quiet turns and full under attack', () => {
    expect(combatBlendFor(0.1)).toBe(0);
    expect(combatBlendFor(0.25)).toBe(0);
    expect(combatBlendFor(0.6)).toBeCloseTo(0.5);
    expect(combatBlendFor(0.85)).toBe(1);
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
const SCHEDULER_TICK = 100;
interface StubParam { value: number; setValueAtTime: Fn; setTargetAtTime: Fn; linearRampToValueAtTime: Fn; exponentialRampToValueAtTime: Fn; cancelScheduledValues: Fn }
function param(value = 0): StubParam {
  return {
    value,
    setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
  };
}
const created = { oscillators: 0, started: 0 };
function stubNode(extra: Record<string, unknown> = {}) {
  return { connect: vi.fn(), disconnect: vi.fn(), ...extra };
}
class StubAudioContext {
  // Follows the fake timers (vitest fakes Date), so the look-ahead scheduler
  // keeps finding new steps to queue as the test advances time.
  private t0 = Date.now();
  get currentTime() { return (Date.now() - this.t0) / 1000; }
  state = 'running';
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  createGain() { return stubNode({ gain: param(1) }); }
  createBiquadFilter() { return stubNode({ type: 'lowpass', frequency: param(0), Q: param(1) }); }
  createWaveShaper() { return stubNode({ curve: null }); }
  createBuffer(_ch: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  createBufferSource() { return stubNode({ buffer: null, start: vi.fn(), stop: vi.fn() }); }
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
    // Nothing sounds until the scheduler's first tick; then the first chord
    // (two saws per voice + a sub) and the bar-0 bell are queued.
    expect(created.started).toBe(0);
    vi.advanceTimersByTime(SCHEDULER_TICK);
    const voices = ERA_MUSIC_PROFILES.medieval.progression[0].length;
    const bell = ERA_MUSIC_PROFILES.medieval.bellPartials.length;
    expect(created.started).toBe(voices * 2 + 1 + bell);

    // At rest the combat layer is not scheduled at all; under tension the
    // arpeggio and drums are queued every 16th.
    const quiet = created.oscillators;
    vi.advanceTimersByTime(300);
    const afterQuiet = created.oscillators - quiet;
    engine.setTension(0.85);
    const before = created.oscillators;
    vi.advanceTimersByTime(300);
    expect(created.oscillators - before).toBeGreaterThan(afterQuiet);

    engine.setEra('coldwar');
    vi.advanceTimersByTime(2000); // crossfade lands, new palette starts
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
