import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The effects' AudioContext stays running only around a sound. A running
 * context renders silence for as long as it runs, which keeps the device's
 * audio path awake; it used to run from the first sound to the end of the
 * session.
 */
const ctxs: StubAudioContext[] = [];
class StubAudioContext {
  constructor() { ctxs.push(this); }
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  createGain() { return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }; }
  createOscillator() {
    return {
      connect: vi.fn(), start: vi.fn(), stop: vi.fn(), type: 'sine',
      frequency: { setValueAtTime: vi.fn() }, detune: { setValueAtTime: vi.fn() },
    };
  }
}

beforeEach(() => {
  ctxs.length = 0;
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  (window as unknown as { AudioContext: unknown }).AudioContext = StubAudioContext;
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('sound effects and the audio device', () => {
  it('suspends the context once the effects have been quiet for a while', async () => {
    const { playAbilityConfirmSound, SFX_IDLE_SUSPEND_MS } = await import('./gameSounds');
    playAbilityConfirmSound();
    expect(ctxs).toHaveLength(1);
    const ctx = ctxs[0];
    // Its second note plays 60 ms in and restarts the countdown.
    vi.advanceTimersByTime(SFX_IDLE_SUSPEND_MS);
    expect(ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
  });

  it('wakes the same context for the next sound', async () => {
    const { playAbilityConfirmSound, SFX_IDLE_SUSPEND_MS } = await import('./gameSounds');
    playAbilityConfirmSound();
    vi.advanceTimersByTime(SFX_IDLE_SUSPEND_MS + 200);
    await Promise.resolve();
    const ctx = ctxs[0];
    expect(ctx.state).toBe('suspended');
    playAbilityConfirmSound();
    expect(ctxs).toHaveLength(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('skips the sound, quietly, when the browser cannot start the audio device', async () => {
    // Chrome rejects resume() with "Failed to start the audio device" when no
    // output is available. Uncaught, each one reached Sentry as an error.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { playAbilityConfirmSound, SFX_IDLE_SUSPEND_MS } = await import('./gameSounds');
      playAbilityConfirmSound();
      vi.advanceTimersByTime(SFX_IDLE_SUSPEND_MS + 200);
      await Promise.resolve();
      // A plain function, not vi.fn: a mock watches the promise it returns,
      // which counts as handling the rejection and would hide the bug.
      let refused = 0;
      (ctxs[0] as unknown as { resume: () => Promise<void> }).resume = () => {
        refused += 1;
        return Promise.reject(new DOMException('Failed to start the audio device', 'InvalidStateError'));
      };
      expect(() => playAbilityConfirmSound()).not.toThrow();
      expect(refused).toBe(1);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('keeps a context that is busy with sounds running', async () => {
    const { playAbilityConfirmSound, SFX_IDLE_SUSPEND_MS } = await import('./gameSounds');
    for (let i = 0; i < 5; i++) {
      playAbilityConfirmSound();
      vi.advanceTimersByTime(SFX_IDLE_SUSPEND_MS / 2);
    }
    expect(ctxs[0].suspend).not.toHaveBeenCalled();
  });
});
