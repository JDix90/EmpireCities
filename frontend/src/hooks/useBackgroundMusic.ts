import { useEffect, useRef } from 'react';
import { backgroundMusic, type MusicCadence } from '../audio/backgroundMusic';
import { getMusicMasterGain, subscribeUserPreferences } from '../utils/userPreferences';
import { usePageVisibilityEffect } from '../utils/usePageVisible';

interface Options {
  /** Feature flag AND page-level opt-in (a spectator page may pass false). */
  enabled: boolean;
  /** Which bed to play (`musicBedFor`): an era id on era maps, or the shared regional / community bed. */
  bed: string | null | undefined;
  /** 0..1, from `musicTensionFor`. */
  tension: number;
  /** Set once when the game ends; plays the cadence and lets the bed fade out. */
  outcome: MusicCadence | null;
}

/**
 * Drives the background music engine from game state.
 *
 * Browsers refuse to open an AudioContext outside a user gesture, so the bed
 * cannot simply start on mount: it starts on the first pointer or key event
 * after the page is enabled, which in practice is the player's first click on
 * the map. Everything after that — era palette, tension, volume, tab
 * visibility, the game-over cadence — follows state.
 */
export function useBackgroundMusic({ enabled, bed, tension, outcome }: Options): void {
  const eraRef = useRef(bed);
  eraRef.current = bed;
  const tensionRef = useRef(tension);
  tensionRef.current = tension;

  // Start on the first gesture; stop when disabled or on unmount.
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const tryStart = () => {
      if (backgroundMusic.isRunning) return;
      if (backgroundMusic.start(eraRef.current)) {
        backgroundMusic.setTension(tensionRef.current);
      }
    };
    // A preference flip (unmute, volume up from zero) should also be able to
    // start it — that flip is itself a gesture, so the context opens fine.
    const unsubscribe = subscribeUserPreferences(() => {
      if (getMusicMasterGain() <= 0) {
        backgroundMusic.stop(0.6);
        return;
      }
      if (backgroundMusic.isRunning) backgroundMusic.setVolume(getMusicMasterGain());
      else tryStart();
    });
    document.addEventListener('pointerdown', tryStart, { passive: true });
    document.addEventListener('keydown', tryStart);
    return () => {
      document.removeEventListener('pointerdown', tryStart);
      document.removeEventListener('keydown', tryStart);
      unsubscribe();
      backgroundMusic.stop(0.8);
    };
  }, [enabled]);

  useEffect(() => {
    backgroundMusic.setEra(bed);
  }, [bed]);

  useEffect(() => {
    backgroundMusic.setTension(tension);
  }, [tension]);

  useEffect(() => {
    if (outcome) backgroundMusic.playCadence(outcome);
  }, [outcome]);

  usePageVisibilityEffect((visible) => backgroundMusic.setVisible(visible));
}
