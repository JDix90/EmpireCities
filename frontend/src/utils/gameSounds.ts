import { isLiteMode, prefersReducedMotion } from './device';
import { isMapStrikeAbility, type MapStrikeAbilityId } from './mapStrikeEffects';

let audioCtx: AudioContext | null = null;

function canPlaySounds(): boolean {
  if (typeof window === 'undefined') return false;
  return !prefersReducedMotion() && !isLiteMode();
}

function getAudioContext(): AudioContext | null {
  if (!canPlaySounds()) return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  durationSec: number,
  options?: {
    type?: OscillatorType;
    gain?: number;
    attack?: number;
    decay?: number;
    detune?: number;
  },
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const attack = options?.attack ?? 0.012;
  const decay = options?.decay ?? durationSec * 0.85;
  const peak = options?.gain ?? 0.08;

  osc.type = options?.type ?? 'sine';
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  if (options?.detune) osc.detune.setValueAtTime(options.detune, ctx.currentTime);

  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + attack + decay);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationSec);
}

function playNoiseBurst(durationSec: number, gain = 0.06): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const bufferSize = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, ctx.currentTime);

  source.buffer = buffer;
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);
  source.start();
}

/** Soft two-note chime when a self-buff ability is armed. */
export function playAbilityArmSound(): void {
  playTone(523, 0.14, { type: 'triangle', gain: 0.05 });
  window.setTimeout(() => playTone(784, 0.18, { type: 'triangle', gain: 0.055 }), 90);
}

/** Doctrine abilities (Blitz, March to the Sea) — slightly bolder arming cue. */
export function playDoctrineArmSound(): void {
  playTone(392, 0.12, { type: 'square', gain: 0.035 });
  window.setTimeout(() => playTone(587, 0.16, { type: 'square', gain: 0.04 }), 70);
  window.setTimeout(() => playTone(880, 0.2, { type: 'triangle', gain: 0.045 }), 150);
}

/** Positive blip for draft/placement abilities. */
export function playAbilityConfirmSound(): void {
  playTone(660, 0.1, { type: 'sine', gain: 0.045 });
  window.setTimeout(() => playTone(990, 0.12, { type: 'sine', gain: 0.04 }), 60);
}

/** Recon sweep — airy rising tone. */
export function playReconSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(920, ctx.currentTime + 0.35);
  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.05);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

type StrikeSoundProfile = 'nuclear' | 'orbital' | 'cyber' | 'aerial' | 'medieval' | 'naval';

function strikeProfile(abilityId: MapStrikeAbilityId): StrikeSoundProfile {
  switch (abilityId) {
    case 'atom_bomb':
    case 'nuclear_strike':
    case 'dyson_beam':
      return 'nuclear';
    case 'orbital_strike':
    case 'hypersonic_strike':
    case 'swarm_strike':
      return 'orbital';
    case 'cyber_attack':
    case 'data_breach':
      return 'cyber';
    case 'longbowmen':
    case 'chevauchee':
      return 'medieval';
    case 'privateer':
    case 'river_blockade':
      return 'naval';
    case 'precision_airstrike':
    case 'air_strike':
      return 'aerial';
    default:
      return 'aerial';
  }
}

/** Impact cue when a strike ability hits a territory. */
export function playStrikeImpactSound(abilityId: string): void {
  if (!isMapStrikeAbility(abilityId)) {
    playNoiseBurst(0.18, 0.05);
    playTone(220, 0.2, { type: 'triangle', gain: 0.05 });
    return;
  }

  const profile = strikeProfile(abilityId);
  switch (profile) {
    case 'nuclear':
      playNoiseBurst(0.45, 0.1);
      playTone(72, 0.55, { type: 'sine', gain: 0.09 });
      playTone(110, 0.4, { type: 'triangle', gain: 0.05 });
      break;
    case 'orbital':
      playTone(1200, 0.08, { type: 'sawtooth', gain: 0.025 });
      window.setTimeout(() => {
        playNoiseBurst(0.22, 0.07);
        playTone(180, 0.25, { type: 'square', gain: 0.045 });
      }, 120);
      break;
    case 'cyber':
      playTone(880, 0.06, { type: 'square', gain: 0.03 });
      window.setTimeout(() => playTone(1320, 0.05, { type: 'square', gain: 0.028, detune: 40 }), 40);
      window.setTimeout(() => playTone(440, 0.14, { type: 'triangle', gain: 0.04 }), 90);
      break;
    case 'medieval':
      playTone(520, 0.05, { type: 'triangle', gain: 0.04 });
      window.setTimeout(() => {
        playNoiseBurst(0.12, 0.045);
        playTone(196, 0.18, { type: 'triangle', gain: 0.05 });
      }, 55);
      break;
    case 'naval':
      playNoiseBurst(0.2, 0.055);
      playTone(160, 0.22, { type: 'sine', gain: 0.055 });
      break;
    case 'aerial':
    default:
      playTone(300, 0.07, { type: 'sawtooth', gain: 0.025 });
      window.setTimeout(() => {
        playNoiseBurst(0.16, 0.05);
        playTone(240, 0.2, { type: 'triangle', gain: 0.048 });
      }, 80);
      break;
  }
}
