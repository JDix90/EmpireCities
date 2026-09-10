/**
 * Background music — generated in the browser, no audio files.
 *
 * The game's sound effects are already synthesized with WebAudio oscillators
 * (`utils/gameSounds.ts`); this is the same idea stretched into a bed. One
 * generator, parameterized per era: a slow chord progression on a detuned pad
 * through a low-pass filter, a drone an octave or two beneath it, and a sparse
 * pulse layer that only comes forward under tension. Ambient by design — a
 * strategy session runs an hour or more, so no hooks, no melody to tire of,
 * and a dynamic range narrow enough to sit under the sound effects.
 *
 * Everything here is display-side and disposable: the engine never touches
 * game state, and every method is a no-op until `start()` has run inside a
 * user gesture (browsers refuse to open an AudioContext otherwise).
 */
import { prefersReducedMotion } from '../utils/device';
import { getMusicMasterGain, isLiteMode } from '../utils/userPreferences';

// ── Era profiles ─────────────────────────────────────────────────────────────

export interface EraMusicProfile {
  /** Scale root in Hz. */
  root: number;
  /** Semitone offsets of the scale within one octave. */
  scale: number[];
  /** Chords as scale-degree indices; a degree past the scale length is an octave up. */
  progression: number[][];
  /** How many bars (of 4 beats) each chord holds. */
  barsPerChord: number;
  bpm: number;
  padWave: OscillatorType;
  droneWave: OscillatorType;
  pulseWave: OscillatorType;
  /** Spread between a pad voice's two oscillators, in cents. */
  padDetuneCents: number;
  /** Low-pass cutoff at rest and fully open under tension, in Hz. */
  filterRest: number;
  filterTense: number;
  /** 16-step pulse pattern: 0 = rest, otherwise a scale degree (1-based) to sound. */
  pulsePattern: number[];
  /** Pulse note length in seconds. */
  pulseLength: number;
  /** Drone octaves below the root. */
  droneOctavesDown: 1 | 2;
}

const PENTATONIC_MINOR = [0, 3, 5, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const WHOLE_TONE = [0, 2, 4, 6, 8, 10];

/**
 * The palette per era. Instrument choices are stand-ins the synth can reach:
 * frame drums are a low triangle thump, a choir is a filtered saw pad, a
 * harpsichord is a short bright pluck, teletype is a square 16th pattern.
 */
export const ERA_MUSIC_PROFILES: Record<string, EraMusicProfile> = {
  ancient: {
    root: 110, scale: PENTATONIC_MINOR,
    progression: [[0, 2, 4], [3, 5, 7], [1, 3, 5], [0, 2, 4]],
    barsPerChord: 2, bpm: 64,
    padWave: 'triangle', droneWave: 'sine', pulseWave: 'triangle',
    padDetuneCents: 6, filterRest: 700, filterTense: 1900,
    pulsePattern: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0], pulseLength: 0.18,
    droneOctavesDown: 1,
  },
  medieval: {
    root: 73.42, scale: DORIAN,
    progression: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    barsPerChord: 2, bpm: 70,
    padWave: 'sawtooth', droneWave: 'triangle', pulseWave: 'triangle',
    padDetuneCents: 9, filterRest: 520, filterTense: 1600,
    pulsePattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], pulseLength: 0.22,
    droneOctavesDown: 1,
  },
  discovery: {
    root: 98, scale: LYDIAN,
    progression: [[0, 2, 4], [3, 5, 7], [1, 3, 5], [4, 6, 8]],
    barsPerChord: 2, bpm: 76,
    padWave: 'triangle', droneWave: 'sine', pulseWave: 'square',
    padDetuneCents: 5, filterRest: 900, filterTense: 2600,
    pulsePattern: [1, 0, 3, 0, 5, 0, 3, 0, 1, 0, 3, 0, 5, 0, 8, 0], pulseLength: 0.09,
    droneOctavesDown: 2,
  },
  acw: {
    root: 87.31, scale: MIXOLYDIAN,
    progression: [[0, 2, 4], [3, 5, 7], [0, 2, 4], [4, 6, 8]],
    barsPerChord: 2, bpm: 84,
    padWave: 'sawtooth', droneWave: 'triangle', pulseWave: 'square',
    padDetuneCents: 7, filterRest: 650, filterTense: 2100,
    pulsePattern: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1], pulseLength: 0.07,
    droneOctavesDown: 1,
  },
  risorgimento: {
    root: 87.31, scale: MIXOLYDIAN,
    progression: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    barsPerChord: 2, bpm: 84,
    padWave: 'sawtooth', droneWave: 'triangle', pulseWave: 'square',
    padDetuneCents: 7, filterRest: 650, filterTense: 2100,
    pulsePattern: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1], pulseLength: 0.07,
    droneOctavesDown: 1,
  },
  ww2: {
    root: 65.41, scale: AEOLIAN,
    progression: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    barsPerChord: 2, bpm: 80,
    padWave: 'sawtooth', droneWave: 'sawtooth', pulseWave: 'square',
    padDetuneCents: 10, filterRest: 480, filterTense: 1700,
    pulsePattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], pulseLength: 0.12,
    droneOctavesDown: 1,
  },
  coldwar: {
    root: 82.41, scale: PHRYGIAN,
    progression: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [5, 7, 9]],
    barsPerChord: 2, bpm: 92,
    padWave: 'square', droneWave: 'sine', pulseWave: 'square',
    padDetuneCents: 4, filterRest: 500, filterTense: 2300,
    pulsePattern: [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1], pulseLength: 0.05,
    droneOctavesDown: 2,
  },
  modern: {
    root: 110, scale: AEOLIAN,
    progression: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [3, 5, 7]],
    barsPerChord: 2, bpm: 88,
    padWave: 'sawtooth', droneWave: 'sine', pulseWave: 'triangle',
    padDetuneCents: 12, filterRest: 800, filterTense: 2800,
    pulsePattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], pulseLength: 0.1,
    droneOctavesDown: 2,
  },
  space_age: {
    root: 130.81, scale: LYDIAN,
    progression: [[0, 2, 4, 6], [3, 5, 7, 9], [1, 3, 5, 7], [4, 6, 8, 10]],
    barsPerChord: 2, bpm: 96,
    padWave: 'sawtooth', droneWave: 'sine', pulseWave: 'triangle',
    padDetuneCents: 14, filterRest: 1000, filterTense: 3400,
    pulsePattern: [1, 0, 3, 0, 5, 0, 8, 0, 5, 0, 3, 0, 1, 0, 5, 0], pulseLength: 0.08,
    droneOctavesDown: 2,
  },
  galaxy_age: {
    root: 73.42, scale: WHOLE_TONE,
    progression: [[0, 2, 4], [1, 3, 5], [2, 4, 6], [0, 2, 4]],
    barsPerChord: 4, bpm: 56,
    padWave: 'triangle', droneWave: 'sine', pulseWave: 'sine',
    padDetuneCents: 8, filterRest: 600, filterTense: 2000,
    pulsePattern: [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0], pulseLength: 0.3,
    droneOctavesDown: 2,
  },
};

export function profileForEra(eraId: string | null | undefined): EraMusicProfile {
  return (eraId && ERA_MUSIC_PROFILES[eraId]) || ERA_MUSIC_PROFILES.ancient;
}

/** Frequency of a scale degree (0-based; past the scale length climbs an octave). */
export function degreeToHz(profile: EraMusicProfile, degree: number, octaveShift = 0): number {
  const len = profile.scale.length;
  const octave = Math.floor(degree / len) + octaveShift;
  const semis = profile.scale[((degree % len) + len) % len] + 12 * octave;
  return profile.root * Math.pow(2, semis / 12);
}

// ── Tension ──────────────────────────────────────────────────────────────────

export interface MusicTensionInput {
  phase: string | null | undefined;
  isMyTurn: boolean;
  /** An attack against the viewer is resolving on screen. */
  underAttack: boolean;
  gameOver: boolean;
}

/**
 * How much the music leans in, 0..1. Opens the filter and brings the pulse
 * layer forward; it never changes tempo, which would read as a glitch.
 */
export function musicTensionFor(input: MusicTensionInput): number {
  if (input.gameOver) return 0;
  if (input.underAttack) return 0.85;
  if (input.phase === 'attack' && input.isMyTurn) return 0.6;
  if (input.isMyTurn) return 0.25;
  return 0.1;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export type MusicCadence = 'victory' | 'defeat';

interface PadVoice {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  gain: GainNode;
}

/** Overall level of the bed before the user's volume. Deliberately low. */
const BED_LEVEL = 0.45;
const PAD_VOICE_GAIN = 0.05;
const DRONE_GAIN = 0.06;
const PULSE_GAIN = 0.05;
const SCHEDULE_AHEAD_SEC = 0.35;
const SCHEDULER_INTERVAL_MS = 100;
const CROSSFADE_SEC = 1.6;

function canPlayMusic(): boolean {
  if (typeof window === 'undefined') return false;
  if (getMusicMasterGain() <= 0) return false;
  // Same gate as the sound effects: lite mode is a battery/perf request and
  // reduce-motion users have asked for a calmer session.
  return !prefersReducedMotion() && !isLiteMode();
}

export class BackgroundMusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;
  private padBus: GainNode | null = null;
  private droneBus: GainNode | null = null;
  private pulseBus: GainNode | null = null;
  private padVoices: PadVoice[] = [];
  private droneOscs: OscillatorNode[] = [];

  private profile: EraMusicProfile = ERA_MUSIC_PROFILES.ancient;
  private eraId: string | null = null;
  private tension = 0;
  private running = false;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private chordIndex = -1;

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Open the audio graph. Must be called from a user gesture the first time.
   * Returns false when music is disabled by preference, lite mode, or the
   * platform lacks WebAudio.
   */
  start(eraId: string | null | undefined): boolean {
    if (this.running) return true;
    if (!canPlayMusic()) return false;
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;

    try {
      this.ctx = this.ctx ?? new Ctx();
    } catch {
      return false;
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.bed = ctx.createGain();
    this.bed.gain.value = BED_LEVEL;
    this.bed.connect(this.master);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.connect(this.bed);

    // Slow filter wobble so the pad never sits perfectly still.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 0.045;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 120;
    this.lfo.connect(lfoDepth);
    lfoDepth.connect(this.filter.frequency);
    this.lfo.start();

    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padBus.connect(this.filter);
    this.droneBus = ctx.createGain();
    this.droneBus.gain.value = DRONE_GAIN;
    this.droneBus.connect(this.filter);
    this.pulseBus = ctx.createGain();
    this.pulseBus.gain.value = 0;
    this.pulseBus.connect(this.filter);

    this.profile = profileForEra(eraId);
    this.eraId = eraId ?? null;
    this.buildVoices();
    this.applyTension(this.tension, 0.5);

    this.running = true;
    this.master.gain.setTargetAtTime(getMusicMasterGain(), ctx.currentTime, 0.8);
    this.startScheduler();
    return true;
  }

  /** Fade out and tear the graph down. Safe to call when not running. */
  stop(fadeSec = 1): void {
    if (!this.running || !this.ctx || !this.master) return;
    this.running = false;
    this.stopScheduler();
    const ctx = this.ctx;
    const master = this.master;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, fadeSec / 3);
    const voices = this.padVoices;
    const drones = this.droneOscs;
    const lfo = this.lfo;
    const teardown = () => {
      for (const v of voices) { try { v.oscA.stop(); v.oscB.stop(); } catch { /* already stopped */ } }
      for (const d of drones) { try { d.stop(); } catch { /* already stopped */ } }
      try { lfo?.stop(); } catch { /* already stopped */ }
      master.disconnect();
    };
    window.setTimeout(teardown, fadeSec * 1000 + 200);
    this.padVoices = [];
    this.droneOscs = [];
    this.master = null;
    this.bed = null;
    this.filter = null;
    this.lfo = null;
    this.padBus = null;
    this.droneBus = null;
    this.pulseBus = null;
    this.chordIndex = -1;
    this.step = 0;
  }

  /** Move to another era's palette with a crossfade. No-op if unchanged. */
  setEra(eraId: string | null | undefined): void {
    const next = eraId ?? null;
    if (next === this.eraId) return;
    this.eraId = next;
    this.profile = profileForEra(next);
    if (!this.running || !this.ctx || !this.padBus || !this.droneBus) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.padBus.gain.cancelScheduledValues(now);
    this.padBus.gain.setTargetAtTime(0, now, CROSSFADE_SEC / 4);
    this.droneBus.gain.cancelScheduledValues(now);
    this.droneBus.gain.setTargetAtTime(0, now, CROSSFADE_SEC / 4);

    const oldVoices = this.padVoices;
    const oldDrones = this.droneOscs;
    window.setTimeout(() => {
      for (const v of oldVoices) { try { v.oscA.stop(); v.oscB.stop(); } catch { /* ok */ } }
      for (const d of oldDrones) { try { d.stop(); } catch { /* ok */ } }
      if (!this.running || !this.ctx || !this.padBus || !this.droneBus) return;
      this.chordIndex = -1;
      this.step = 0;
      this.buildVoices();
      this.applyTension(this.tension, 0.5);
      const t = this.ctx.currentTime;
      this.padBus.gain.setTargetAtTime(1, t, CROSSFADE_SEC / 3);
      this.droneBus.gain.setTargetAtTime(DRONE_GAIN, t, CROSSFADE_SEC / 3);
      this.nextStepTime = t + 0.05;
    }, CROSSFADE_SEC * 1000);
  }

  setTension(tension: number): void {
    const t = Math.min(1, Math.max(0, tension));
    this.tension = t;
    if (this.running) this.applyTension(t, 2.5);
  }

  /** Re-read the user's music volume (0..1). Live, no restart. */
  setVolume(gain: number): void {
    if (!this.running || !this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(Math.max(0, gain), this.ctx.currentTime, 0.2);
  }

  /** Tab hidden / shown. Suspends the clock so nothing piles up while away. */
  setVisible(visible: boolean): void {
    if (!this.running || !this.ctx) return;
    if (visible) {
      void this.ctx.resume();
      this.nextStepTime = this.ctx.currentTime + 0.05;
      this.startScheduler();
    } else {
      this.stopScheduler();
      void this.ctx.suspend();
    }
  }

  /** The era-advance moment: a rising swell that opens the filter, then settles. */
  playEraSwell(): void {
    if (!this.running || !this.ctx || !this.filter || !this.bed) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setTargetAtTime(4200, now, 0.9);
    this.filter.frequency.setTargetAtTime(this.filterTarget(), now + 2.8, 1.2);
    this.bed.gain.setTargetAtTime(BED_LEVEL * 1.5, now, 0.6);
    this.bed.gain.setTargetAtTime(BED_LEVEL, now + 2.6, 1.0);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.profile.root * 2, now);
    osc.frequency.exponentialRampToValueAtTime(this.profile.root * 8, now + 2.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);
    osc.connect(gain);
    gain.connect(this.bed);
    osc.start(now);
    osc.stop(now + 3.1);
  }

  /** Game over: a resolved rise for a win, an unresolved fall for a loss, then out. */
  playCadence(kind: MusicCadence): void {
    if (!this.running || !this.ctx || !this.bed) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.stopScheduler();
    this.setTension(0);
    const p = this.profile;
    const degrees = kind === 'victory' ? [0, 2, 4, 7] : [4, 2, 1, 1];
    const octave = kind === 'victory' ? 1 : 0;
    degrees.forEach((degree, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'victory' ? 'triangle' : 'sine';
      osc.frequency.value = degreeToHz(p, degree, octave);
      const t = now + i * (kind === 'victory' ? 0.28 : 0.42);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.07, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (i === degrees.length - 1 ? 2.4 : 0.9));
      osc.connect(gain);
      gain.connect(this.bed as GainNode);
      osc.start(t);
      osc.stop(t + 2.6);
    });
    window.setTimeout(() => this.stop(2.5), 2600);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private filterTarget(): number {
    const p = this.profile;
    return p.filterRest + (p.filterTense - p.filterRest) * this.tension;
  }

  private applyTension(t: number, rampSec: number): void {
    if (!this.ctx || !this.filter || !this.pulseBus) return;
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(this.filterTarget(), now, rampSec / 3);
    // The pulse is inaudible at rest and only comes forward as tension rises.
    const pulseLevel = t < 0.2 ? 0 : PULSE_GAIN * ((t - 0.2) / 0.8);
    this.pulseBus.gain.setTargetAtTime(pulseLevel, now, rampSec / 3);
  }

  private buildVoices(): void {
    if (!this.ctx || !this.padBus || !this.droneBus) return;
    const ctx = this.ctx;
    const p = this.profile;
    const voiceCount = Math.max(...p.progression.map((c) => c.length));
    const chord = p.progression[0];
    this.padVoices = [];
    for (let i = 0; i < voiceCount; i++) {
      const hz = degreeToHz(p, chord[i % chord.length]);
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      oscA.type = p.padWave;
      oscB.type = p.padWave;
      oscA.frequency.value = hz;
      oscB.frequency.value = hz;
      oscA.detune.value = -p.padDetuneCents;
      oscB.detune.value = p.padDetuneCents;
      const gain = ctx.createGain();
      gain.gain.value = PAD_VOICE_GAIN;
      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(this.padBus);
      oscA.start();
      oscB.start();
      this.padVoices.push({ oscA, oscB, gain });
    }
    const droneHz = p.root / Math.pow(2, p.droneOctavesDown);
    this.droneOscs = [];
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = p.droneWave;
      osc.frequency.value = droneHz;
      osc.detune.value = detune;
      osc.connect(this.droneBus);
      osc.start();
      this.droneOscs.push(osc);
    }
    this.chordIndex = 0;
  }

  private startScheduler(): void {
    if (this.schedulerId != null || !this.ctx) return;
    this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.05);
    this.schedulerId = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  private stopScheduler(): void {
    if (this.schedulerId != null) clearInterval(this.schedulerId);
    this.schedulerId = null;
  }

  /** Look-ahead scheduler: queue every 16th-note step that falls inside the window. */
  private tick(): void {
    if (!this.ctx || !this.running) return;
    const stepSec = 60 / this.profile.bpm / 4;
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step += 1;
      this.nextStepTime += stepSec;
    }
  }

  private scheduleStep(step: number, time: number): void {
    const p = this.profile;
    const stepsPerChord = p.barsPerChord * 16;
    const chordIdx = Math.floor(step / stepsPerChord) % p.progression.length;
    if (chordIdx !== this.chordIndex) {
      this.chordIndex = chordIdx;
      this.glideToChord(p.progression[chordIdx], time);
    }
    const hit = p.pulsePattern[step % 16];
    if (hit > 0 && this.tension >= 0.2) {
      this.schedulePulse(degreeToHz(p, hit - 1, 1), time);
    }
  }

  /** Portamento pad: retune the standing voices rather than retrigger them. */
  private glideToChord(chord: number[], time: number): void {
    const p = this.profile;
    this.padVoices.forEach((voice, i) => {
      const hz = degreeToHz(p, chord[i % chord.length]);
      for (const osc of [voice.oscA, voice.oscB]) {
        osc.frequency.cancelScheduledValues(time);
        osc.frequency.setTargetAtTime(hz, time, 0.6);
      }
    });
  }

  private schedulePulse(hz: number, time: number): void {
    if (!this.ctx || !this.pulseBus) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = this.profile.pulseWave;
    osc.frequency.value = hz;
    const len = this.profile.pulseLength;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(1, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
    osc.connect(gain);
    gain.connect(this.pulseBus);
    osc.start(time);
    osc.stop(time + len + 0.05);
  }
}

/** The one engine the game page drives. */
export const backgroundMusic = new BackgroundMusicEngine();
