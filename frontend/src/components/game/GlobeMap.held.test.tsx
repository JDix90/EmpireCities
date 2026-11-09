/**
 * A full-screen modal over the globe holds its render loop: the frames behind
 * the dim are not drawn, and the loop resumes with a catch-up draw when the
 * modal lifts. react-globe.gl is a stand-in that records pause and resume;
 * its renderer counts no frames, so wakes here are time only.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  controls: {
    autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, enabled: true,
    addEventListener: () => {}, removeEventListener: () => {},
  },
}));

vi.mock('react-globe.gl', async () => {
  const ReactLib = await import('react');
  const Globe = ReactLib.forwardRef((props: Record<string, unknown>, ref) => {
    ReactLib.useImperativeHandle(ref, () => ({
      pauseAnimation: globe.pause,
      resumeAnimation: globe.resume,
      controls: () => globe.controls,
      pointOfView: () => ({ lat: 0, lng: 0, altitude: 1.8 }),
      renderer: () => ({ setPixelRatio: () => {}, setSize: () => {}, domElement: document.createElement('canvas') }),
      toGlobeCoords: () => null,
      scene: () => null,
      camera: () => ({ aspect: 1, updateProjectionMatrix() {} }),
    }));
    ReactLib.useEffect(() => { (props.onGlobeReady as (() => void) | undefined)?.(); }, []);
    return ReactLib.createElement('div', { 'data-testid': 'globe-stub' });
  });
  return { default: Globe };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import { GlobeMapCore } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

const britain = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/community_britain_925.json'), 'utf8'));

function gameState() {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  (britain.territories as Array<{ territory_id: string }>).forEach((t, i) => {
    territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 };
  });
  return {
    game_id: 'g1', era: 'medieval', map_id: britain.map_id, phase: 'attack', turn_number: 1, current_player_index: 0,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Bot', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

const globeAt = (held: boolean) => (
  <GlobeMapCore mapData={britain} onTerritoryClick={() => {}} width={390} height={740}
    selfPlayerId="me" reducedEffects autoSpin={false} events={[]} held={held} />
);

describe('GlobeMap under a modal', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    act(() => { useGameStore.setState({ gameState: gameState() as never }); });
  });
  afterEach(() => {
    act(() => {
      useGameStore.setState({ gameState: null });
      useUiStore.getState().reset();
    });
  });

  it('pauses the loop while a modal covers the globe, and resumes with a draw when it lifts', () => {
    const { rerender } = render(globeAt(false));
    globe.pause.mockClear();
    globe.resume.mockClear();

    rerender(globeAt(true));
    expect(globe.pause).toHaveBeenCalled();
    const resumedWhileHeld = globe.resume.mock.calls.length;

    rerender(globeAt(false));
    expect(globe.resume.mock.calls.length).toBeGreaterThan(resumedWhileHeld);
  });
});
