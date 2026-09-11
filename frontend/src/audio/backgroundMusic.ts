/**
 * Background music — generated in the browser, no audio files.
 *
 * The architecture is borrowed from Pyxis (JDix90/pyxis, tools/gen_sfx.py and
 * scripts/music.gd), whose bed is what this should feel like:
 *
 *  - ONE eight-bar phrase, four chords, two bars each, looping forever. Each
 *    chord is re-struck with a slow overlapping envelope (0.9 s in, 1.3 s out,
 *    running 0.9 s under the next chord), so the pad breathes instead of
 *    sliding — a pad that glides between chords reads as seasick.
 *  - Chord voices are two detuned saws each, weighted so the root is loudest
 *    (0.30 / (voice + 1)), with a sine SUB on the chord root an octave down.
 *    The sub follows the chord: a drone parked on the key note fights every
 *    chord that is not the tonic.
 *  - Everything voiced around the third octave (roughly D3–C4) through a soft
 *    low-pass near 800 Hz. Dark, and low enough to sit under the sound effects.
 *  - Two struck bells per loop, and only two: a third starts to sound like a
 *    melody, and a melody you cannot turn off becomes the thing you hear
 *    instead of the game.
 *  - Combat is not a different piece. It is the SAME phrase with the top half
 *    switched on — a 16th-note arpeggio, a kick on 1 and 3, hats on the 8ths —
 *    crossfaded in over 1.6 s and out over 3.4 s. Fights end raggedly; the
 *    music should not snap.
 *
 * What Borderfall adds is the era axis: the same machine, re-voiced per era
 * (key, mode, progression, pad and bell timbre, which drums exist). Era maps
 * get their own palette each; the curated regional maps share one bed and
 * player-made maps share another (`musicBedFor`), so a new map never needs a
 * new score. Everything here is display-side and disposable, and every method
 * is a no-op until `start()` has run inside a user gesture.
 */
import { prefersReducedMotion } from '../utils/device';
import { getMusicMasterGain, isLiteMode } from '../utils/userPreferences';

// ── Era profiles ─────────────────────────────────────────────────────────────

export interface EraMusicProfile {
  /** Register root in Hz: chords are voiced in the octave above this. */
  root: number;
  /** Four chords as semitone offsets from `root`; negative offsets voice below it. */
  progression: number[][];
  bpm: number;
  padWave: OscillatorType;
  /** Detune between a voice's two oscillators, as a fraction (0.0035 ≈ 6 cents). */
  padDetune: number;
  /** Soft low-pass over the bed, in Hz. The combat layer bypasses it. */
  filterHz: number;
  /** Two bells per eight-bar loop: which bar, and semitones above `root`. */
  bells: Array<{ bar: number; semis: number }>;
  /** Bell timbre as [partial ratio, gain]. Slightly inharmonic ratios shimmer. */
  bellPartials: Array<[number, number]>;
  /** Bell decay time constant in seconds. */
  bellDecay: number;
  arpWave: OscillatorType;
  /** Which drums the combat layer has. */
  kick: boolean;
  /** Kick pitch sweep, Hz. */
  kickSweep: [number, number];
  hats: boolean;
}

const D3 = 146.83;
const E3 = 164.81;
const F3 = 174.61;
const C3 = 130.81;
const CS3 = 138.59;
const EF3 = 155.56;

const BRONZE_BELL: Array<[number, number]> = [[1, 1], [2.76, 0.3], [5.4, 0.1]];
const CHAPEL_BELL: Array<[number, number]> = [[1, 1], [2.01, 0.42], [3.02, 0.16]];
const GLASS_BELL: Array<[number, number]> = [[1, 1], [3.0, 0.22], [5.0, 0.06]];
const ROUND_BELL: Array<[number, number]> = [[1, 1], [2.0, 0.5], [3.0, 0.28], [4.0, 0.12]];

/**
 * The palette per era. Progressions are written as offsets from the register
 * root so each chord lands in the same octave (Dm = D3 F3 A3, Bb = Bb2 D3 F3,
 * and so on) instead of climbing away with the scale degree.
 */
export const ERA_MUSIC_PROFILES: Record<string, EraMusicProfile> = {
  // Frame drums and a bronze bell. Minor pentatonic movement: Dm – C – Am – Dm.
  ancient: {
    root: D3, progression: [[0, 3, 7], [-2, 2, 5], [-5, 0, 3], [0, 3, 7]], bpm: 72,
    padWave: 'triangle', padDetune: 0.004, filterHz: 720,
    bells: [{ bar: 0, semis: 12 }, { bar: 4, semis: 17 }], bellPartials: BRONZE_BELL, bellDecay: 0.5,
    arpWave: 'triangle', kick: true, kickSweep: [150, 58], hats: false,
  },
  // A filtered saw choir, i – iv – VI – VII: Dm – Gm – Bb – C.
  medieval: {
    root: D3, progression: [[0, 3, 7], [5, 10, 14], [-4, 0, 3], [-2, 2, 5]], bpm: 78,
    padWave: 'sawtooth', padDetune: 0.0035, filterHz: 820,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 27 }], bellPartials: CHAPEL_BELL, bellDecay: 0.41,
    arpWave: 'square', kick: true, kickSweep: [128, 44], hats: true,
  },
  // Lydian and open, glassy bells like a harpsichord's ring: F – G – Am – C.
  discovery: {
    root: F3, progression: [[0, 4, 7], [2, 6, 9], [4, 7, 11], [-5, -1, 2]], bpm: 84,
    padWave: 'triangle', padDetune: 0.003, filterHz: 1100,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 28 }], bellPartials: GLASS_BELL, bellDecay: 0.6,
    arpWave: 'square', kick: true, kickSweep: [120, 50], hats: true,
  },
  // Mixolydian march, I – bVII – IV – I: F – Eb – Bb – F. Snare-forward hats.
  acw: {
    root: F3, progression: [[0, 4, 7], [-2, 2, 5], [5, 9, 12], [0, 4, 7]], bpm: 88,
    padWave: 'sawtooth', padDetune: 0.0035, filterHz: 820,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 31 }], bellPartials: ROUND_BELL, bellDecay: 0.35,
    arpWave: 'square', kick: true, kickSweep: [128, 44], hats: true,
  },
  // Same march palette, I – IV – vi – bVII: F – Bb – Dm – Eb.
  risorgimento: {
    root: F3, progression: [[0, 4, 7], [5, 9, 12], [-3, 0, 4], [-2, 2, 5]], bpm: 88,
    padWave: 'sawtooth', padDetune: 0.0035, filterHz: 820,
    bells: [{ bar: 0, semis: 28 }, { bar: 4, semis: 24 }], bellPartials: ROUND_BELL, bellDecay: 0.35,
    arpWave: 'square', kick: true, kickSweep: [128, 44], hats: true,
  },
  // Darker and wider, i – VI – III – VII in C: Cm – Ab – Eb – Bb. Heavy kick.
  ww2: {
    root: C3, progression: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], bpm: 80,
    padWave: 'sawtooth', padDetune: 0.005, filterHz: 620,
    bells: [{ bar: 0, semis: 12 }, { bar: 4, semis: 15 }], bellPartials: ROUND_BELL, bellDecay: 0.45,
    arpWave: 'square', kick: true, kickSweep: [110, 40], hats: true,
  },
  // Phrygian, thin square pad, teletype 16ths: Em – F – Em – Dm.
  coldwar: {
    root: E3, progression: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 5]], bpm: 92,
    padWave: 'square', padDetune: 0.002, filterHz: 560,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 25 }], bellPartials: CHAPEL_BELL, bellDecay: 0.3,
    arpWave: 'square', kick: true, kickSweep: [140, 48], hats: true,
  },
  // Wide detuned saws, brighter: Em – C – G – D.
  modern: {
    root: E3, progression: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], bpm: 84,
    padWave: 'sawtooth', padDetune: 0.006, filterHz: 900,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 31 }], bellPartials: GLASS_BELL, bellDecay: 0.55,
    arpWave: 'triangle', kick: true, kickSweep: [120, 42], hats: true,
  },
  // Lydian sevenths, the widest pad: Cmaj7 – D7/C – Em7 – G6.
  space_age: {
    root: C3, progression: [[0, 4, 7, 11], [2, 6, 9, 14], [4, 7, 11, 16], [-5, -1, 2, 7]], bpm: 90,
    padWave: 'sawtooth', padDetune: 0.008, filterHz: 1200,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 30 }], bellPartials: GLASS_BELL, bellDecay: 0.7,
    arpWave: 'triangle', kick: true, kickSweep: [100, 40], hats: true,
  },
  // Whole tone, slowest and deepest. No hats; the kick is a distant sub.
  galaxy_age: {
    root: D3, progression: [[0, 4, 8], [2, 6, 10], [0, 4, 8], [-2, 2, 6]], bpm: 56,
    padWave: 'triangle', padDetune: 0.004, filterHz: 520,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 28 }], bellPartials: GLASS_BELL, bellDecay: 1.1,
    arpWave: 'sine', kick: true, kickSweep: [80, 36], hats: false,
  },
  // ONE bed for every curated regional theater (Rome 117, Charlemagne, Sengoku,
  // the balkanized moderns…): a campaign-map mood that belongs to no century.
  // Eb minor, i – VII – VI – VII: Ebm – Db – Cb – Db. Round bells, full kit.
  regional: {
    root: EF3, progression: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]], bpm: 82,
    padWave: 'sawtooth', padDetune: 0.004, filterHz: 760,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 22 }], bellPartials: ROUND_BELL, bellDecay: 0.45,
    arpWave: 'square', kick: true, kickSweep: [124, 46], hats: true,
  },
  // ONE bed for every player-made map. Anything might be drawn there, so this
  // is the neutral, slightly hopeful one: C# major, I – V – vi – IV, a soft
  // triangle pad, glass bells.
  community: {
    root: CS3, progression: [[0, 4, 7], [7, 11, 14], [-3, 0, 4], [5, 9, 12]], bpm: 84,
    padWave: 'triangle', padDetune: 0.0035, filterHz: 950,
    bells: [{ bar: 0, semis: 24 }, { bar: 4, semis: 31 }], bellPartials: GLASS_BELL, bellDecay: 0.6,
    arpWave: 'triangle', kick: true, kickSweep: [118, 46], hats: true,
  },
};

/** Bed ids that are not eras. */
export const REGIONAL_BED = 'regional';
export const COMMUNITY_BED = 'community';

/**
 * Which bed a game plays. Era maps (`era_*`) follow the viewing player's era,
 * so advancing changes the music. The curated regional theaters (`community_*`
 * in the map catalog) share one bed and player-published editor maps (uuid
 * ids) share another — a new map never needs a new score.
 */
export function musicBedFor(mapId: string | null | undefined, eraId: string | null | undefined): string {
  if (!mapId) return eraId ?? 'ancient';
  if (mapId.startsWith('era_')) return eraId ?? 'ancient';
  if (mapId.startsWith('community_')) return REGIONAL_BED;
  return COMMUNITY_BED;
}

export function profileForEra(eraId: string | null | undefined): EraMusicProfile {
  return (eraId && ERA_MUSIC_PROFILES[eraId]) || ERA_MUSIC_PROFILES.ancient;
}

/** Frequency of a semitone offset from the profile's register root. */
export function semisToHz(profile: EraMusicProfile, semis: number): number {
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
 * How much the music leans in, 0..1. Two things read it: PRESENCE (below 0.2
 * the bed is ducked and darkened — someone else's turn, the world a little
 * further away) and the COMBAT layer, which comes in from 0.35 and is fully
 * up at 0.85. Tempo never changes; that reads as a glitch.
 */
export function musicTensionFor(input: MusicTensionInput): number {
  if (input.gameOver) return 0;
  if (input.underAttack) return 0.85;
  if (input.phase === 'attack' && input.isMyTurn) return 0.6;
  if (input.isMyTurn) return 0.25;
  return 0.1;
}

/** Combat-layer level for a tension value. */
export function combatBlendFor(tension: number): number {
  return Math.min(1, Math.max(0, (tension - 0.35) / 0.5));
}

// ── Engine ───────────────────────────────────────────────────────────────────

export type MusicCadence = 'victory' | 'defeat';

/** Overall level of the bed before the user's volume. Deliberately low. */
const BED_LEVEL = 0.4;
const SUB_GAIN = 0.55;
const BELL_GAIN = 0.2;
const ARP_GAIN = 0.085;
const KICK_GAIN = 0.42;
const HAT_GAIN = 0.16;
const PRESENCE_DUCK = 0.6;
const COMBAT_FADE_IN_SEC = 1.6;
const COMBAT_FADE_OUT_SEC = 3.4;
const SCHEDULE_AHEAD_SEC = 0.4;
const SCHEDULER_INTERVAL_MS = 100;
const CROSSFADE_SEC = 1.6;
const BARS = 8;
const CHORD_BARS = 2;

function canPlayMusic(): boolean {
  if (typeof window === 'undefined') return false;
  if (getMusicMasterGain() <= 0) return false;
  // Same gate as the sound effects: lite mode is a battery/perf request and
  // reduce-motion users have asked for a calmer session.
  return !prefersReducedMotion() && !isLiteMode();
}

function tanhCurve(samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.5);
  }
  return curve;
}

export class BackgroundMusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private presence: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private padBus: GainNode | null = null;
  private bellBus: GainNode | null = null;
  private combatBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private profile: EraMusicProfile = ERA_MUSIC_PROFILES.ancient;
  private eraId: string | null = null;
  private tension = 0;
  private running = false;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private live: Array<{ stop: (at: number) => void; until: number }> = [];

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

    // master (user volume) ← soft clip ← bed (fixed level) ← presence (duck)
    //   ← { filter ← padBus, bellBus ; combatBus (unfiltered) }
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const shaper = ctx.createWaveShaper();
    shaper.curve = tanhCurve();
    shaper.connect(this.master);

    this.bed = ctx.createGain();
    this.bed.gain.value = BED_LEVEL;
    this.bed.connect(shaper);

    this.presence = ctx.createGain();
    this.presence.gain.value = 1;
    this.presence.connect(this.bed);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.filter.connect(this.presence);

    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padBus.connect(this.filter);
    this.bellBus = ctx.createGain();
    this.bellBus.gain.value = 1;
    this.bellBus.connect(this.filter);
    // Muffling the combat layer would take the bite out of exactly the moment
    // that needs it, so it skips the filter.
    this.combatBus = ctx.createGain();
    this.combatBus.gain.value = 0;
    this.combatBus.connect(this.presence);

    this.profile = profileForEra(eraId);
    this.eraId = eraId ?? null;
    this.step = 0;
    this.running = true;
    this.applyTension(this.tension, true);
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
    const live = this.live;
    const at = ctx.currentTime + fadeSec + 0.2;
    for (const v of live) { try { v.stop(at); } catch { /* already stopped */ } }
    window.setTimeout(() => master.disconnect(), fadeSec * 1000 + 300);
    this.live = [];
    this.master = null;
    this.bed = null;
    this.presence = null;
    this.filter = null;
    this.padBus = null;
    this.bellBus = null;
    this.combatBus = null;
    this.step = 0;
  }

  /** Move to another era's palette with a crossfade. No-op if unchanged. */
  setEra(eraId: string | null | undefined): void {
    const next = eraId ?? null;
    if (next === this.eraId) return;
    this.eraId = next;
    if (!this.running || !this.ctx || !this.padBus || !this.bellBus) {
      this.profile = profileForEra(next);
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.stopScheduler();
    for (const bus of [this.padBus, this.bellBus]) {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0, now, CROSSFADE_SEC / 4);
    }
    const fading = this.live;
    this.live = [];
    window.setTimeout(() => {
      for (const v of fading) { try { v.stop(0); } catch { /* ok */ } }
      if (!this.running || !this.ctx || !this.padBus || !this.bellBus) return;
      this.profile = profileForEra(next);
      this.step = 0;
      this.applyTension(this.tension, true);
      const t = this.ctx.currentTime;
      for (const bus of [this.padBus, this.bellBus]) bus.gain.setTargetAtTime(1, t, CROSSFADE_SEC / 3);
      this.nextStepTime = t + 0.05;
      this.startScheduler();
    }, CROSSFADE_SEC * 1000);
  }

  setTension(tension: number): void {
    const t = Math.min(1, Math.max(0, tension));
    this.tension = t;
    if (this.running) this.applyTension(t, false);
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

  /** The era-advance moment: the filter opens and a rising partial climbs, then it settles. */
  playEraSwell(): void {
    if (!this.running || !this.ctx || !this.filter || !this.bed || !this.bellBus) return;
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
    osc.frequency.setValueAtTime(this.profile.root, now);
    osc.frequency.exponentialRampToValueAtTime(this.profile.root * 4, now + 2.4);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);
    osc.connect(gain);
    gain.connect(this.bellBus);
    osc.start(now);
    osc.stop(now + 3.1);
    // A bell on the new root, the way each loop announces itself.
    this.scheduleBell(semisToHz(this.profile, 24), now + 2.4, BELL_GAIN * 1.4);
  }

  /** Game over: bells — a resolved rise for a win, an unresolved fall for a loss — then out. */
  playCadence(kind: MusicCadence): void {
    if (!this.running || !this.ctx || !this.bellBus) return;
    const now = this.ctx.currentTime;
    this.stopScheduler();
    this.setTension(0);
    const chord = this.profile.progression[0];
    const semis = kind === 'victory'
      ? [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24]
      : [chord[2] + 12, chord[1] + 12, chord[0] + 14, chord[0] + 14];
    const gap = kind === 'victory' ? 0.28 : 0.46;
    semis.forEach((s, i) => this.scheduleBell(semisToHz(this.profile, s), now + i * gap, BELL_GAIN * 1.3));
    window.setTimeout(() => this.stop(2.5), 2600);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private get beatSec(): number {
    return 60 / this.profile.bpm;
  }

  private filterTarget(): number {
    // Someone else's turn: the world is a little further away.
    return this.tension < 0.2 ? this.profile.filterHz * 0.75 : this.profile.filterHz;
  }

  private applyTension(t: number, immediate: boolean): void {
    if (!this.ctx || !this.filter || !this.presence || !this.combatBus) return;
    const now = this.ctx.currentTime;
    const presence = t < 0.2 ? PRESENCE_DUCK : 1;
    this.presence.gain.setTargetAtTime(presence, now, immediate ? 0.01 : 0.8);
    this.filter.frequency.setTargetAtTime(this.filterTarget(), now, immediate ? 0.01 : 1.2);
    // Asymmetric on purpose: combat arrives fast enough to feel like a
    // reaction and leaves slowly enough that the last exchange does not snap
    // the room back to calm.
    const blend = combatBlendFor(t);
    const rising = blend > this.combatBus.gain.value;
    const tau = immediate ? 0.01 : (rising ? COMBAT_FADE_IN_SEC : COMBAT_FADE_OUT_SEC) / 3;
    this.combatBus.gain.setTargetAtTime(blend, now, tau);
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
    const stepSec = this.beatSec / 4;
    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step += 1;
      this.nextStepTime += stepSec;
    }
    // Forget voices whose stop time has passed.
    const now = this.ctx.currentTime;
    this.live = this.live.filter((v) => v.until > now);
  }

  private scheduleStep(step: number, time: number): void {
    const p = this.profile;
    const stepsPerBar = 16;
    const loopSteps = BARS * stepsPerBar;
    const s = step % loopSteps;
    const bar = Math.floor(s / stepsPerBar);
    const inBar = s % stepsPerBar;
    const chord = p.progression[Math.floor(bar / CHORD_BARS) % p.progression.length];

    if (inBar === 0 && bar % CHORD_BARS === 0) this.scheduleChord(chord, time);
    if (inBar === 0) {
      for (const bell of p.bells) {
        if (bell.bar === bar) this.scheduleBell(semisToHz(p, bell.semis), time, BELL_GAIN);
      }
    }

    // Combat layer — always scheduled, its bus decides whether it is heard.
    // Skipping it while quiet would put the arpeggio a beat late when a fight
    // starts, which is the whole thing the crossfade design avoids.
    if (combatBlendFor(this.tension) > 0.001 || this.combatBus!.gain.value > 0.001) {
      this.scheduleArpStep(chord, s, time);
      if (p.kick && (inBar === 0 || inBar === 8)) this.scheduleKick(time);
      if (p.hats && inBar % 2 === 0) this.scheduleHat(time, (inBar / 2) % 2 === 1 ? HAT_GAIN * 0.6 : HAT_GAIN);
    }
  }

  /** One chord: weighted detuned saw pairs plus a sine sub, under a slow ASR that overlaps the next. */
  private scheduleChord(chord: number[], time: number): void {
    if (!this.ctx || !this.padBus) return;
    const ctx = this.ctx;
    const p = this.profile;
    const chordSec = this.beatSec * 4 * CHORD_BARS;
    const dur = chordSec + 0.9;
    const attack = 0.9;
    const release = 1.3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(1, time + attack);
    env.gain.setValueAtTime(1, time + dur - release);
    env.gain.linearRampToValueAtTime(0.0001, time + dur);
    env.connect(this.padBus);

    chord.forEach((semis, j) => {
      const hz = semisToHz(p, semis);
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.3 / (j + 1);
      voiceGain.connect(env);
      for (const det of [-p.padDetune, p.padDetune]) {
        const osc = ctx.createOscillator();
        osc.type = p.padWave;
        osc.frequency.value = hz * (1 + det);
        osc.connect(voiceGain);
        osc.start(time);
        osc.stop(time + dur + 0.05);
        this.track(osc, time + dur + 0.05);
      }
    });
    // Root an octave down, sine: a floor without mud.
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = semisToHz(p, chord[0]) / 2;
    subGain.gain.value = SUB_GAIN;
    sub.connect(subGain);
    subGain.connect(env);
    sub.start(time);
    sub.stop(time + dur + 0.05);
    this.track(sub, time + dur + 0.05);
  }

  /** A struck partial-stack bell. */
  private scheduleBell(hz: number, time: number, level: number): void {
    if (!this.ctx || !this.bellBus) return;
    const ctx = this.ctx;
    const p = this.profile;
    const dur = Math.max(1.2, p.bellDecay * 5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(level, time + 0.004);
    env.gain.setTargetAtTime(0.0001, time + 0.004, p.bellDecay);
    env.connect(this.bellBus);
    for (const [ratio, gain] of p.bellPartials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz * ratio;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(env);
      osc.start(time);
      osc.stop(time + dur);
      this.track(osc, time + dur);
    }
  }

  /** 16th-note arpeggio an octave up, up-down-up so it never turns into a siren. */
  private scheduleArpStep(chord: number[], s: number, time: number): void {
    if (!this.ctx || !this.combatBus) return;
    const ctx = this.ctx;
    const p = this.profile;
    const pattern = [0, 1, 2, 1];
    const idx = pattern[s % pattern.length] % chord.length;
    let hz = semisToHz(p, chord[idx]) * 2;
    if (s % 8 === 7) hz *= 2; // a small lift off the top of each beat pair
    const noteDur = (this.beatSec / 4) * 1.8;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = p.arpWave;
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(ARP_GAIN, time + 0.002);
    g.gain.setTargetAtTime(0.0001, time + 0.002, 0.017);
    osc.connect(g);
    g.connect(this.combatBus);
    osc.start(time);
    osc.stop(time + noteDur);
  }

  private scheduleKick(time: number): void {
    if (!this.ctx || !this.combatBus) return;
    const ctx = this.ctx;
    const [f0, f1] = this.profile.kickSweep;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, time);
    osc.frequency.exponentialRampToValueAtTime(f1, time + 0.12);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(KICK_GAIN, time + 0.001);
    g.gain.setTargetAtTime(0.0001, time + 0.001, 0.05);
    osc.connect(g);
    g.connect(this.combatBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private scheduleHat(time: number, level: number): void {
    if (!this.ctx || !this.combatBus) return;
    const ctx = this.ctx;
    if (!this.noiseBuffer) {
      const n = Math.floor(ctx.sampleRate * 0.1);
      this.noiseBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(level, time + 0.0004);
    g.gain.setTargetAtTime(0.0001, time + 0.0004, 0.01);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.combatBus);
    src.start(time);
    src.stop(time + 0.06);
  }

  private track(node: OscillatorNode, until: number): void {
    this.live.push({ stop: (at: number) => node.stop(at), until });
  }
}

/** The one engine the game page drives. */
export const backgroundMusic = new BackgroundMusicEngine();
