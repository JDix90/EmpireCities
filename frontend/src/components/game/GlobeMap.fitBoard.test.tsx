/**
 * Fit small boards to the screen (fit_board_camera_enabled): a fixed regional
 * board opens zoomed in until it fills the canvas, and the floating labels and
 * markers come down in proportion so they stay on their territories. The
 * first match's Britain opened at its authored altitude on every screen, about
 * 8% of a portrait phone, its territories smaller than a fingertip.
 *
 * react-globe.gl is replaced by a stand-in that records the camera it is
 * pointed at and the accessors it is handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
  pov: { lat: 0, lng: 0, altitude: 1.8 },
  props: null as null | Record<string, unknown>,
  controls: {
    autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, enabled: true,
    addEventListener: () => {}, removeEventListener: () => {},
  },
}));

vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  const Globe = React.forwardRef((props: Record<string, unknown>, ref) => {
    globe.props = props;
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: () => {},
      resumeAnimation: () => {},
      controls: () => globe.controls,
      pointOfView: (pov?: Partial<typeof globe.pov>) => { if (pov) Object.assign(globe.pov, pov); return { ...globe.pov }; },
      renderer: () => ({ setPixelRatio: () => {}, setSize: () => {}, domElement: document.createElement('canvas') }),
      toGlobeCoords: () => null,
      scene: () => null,
      camera: () => ({ aspect: 1, updateProjectionMatrix() {} }),
    }));
    React.useEffect(() => { (props.onGlobeReady as (() => void) | undefined)?.(); }, []);
    return React.createElement('div', { 'data-testid': 'globe-stub' });
  });
  return { default: Globe };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import { GlobeMapCore } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `../database/maps/${id}.json`), 'utf8'));
const britain = load('community_britain_925');
const australia = load('community_australia_1337');

function gameStateFor(map: { map_id: string; territories: Array<{ territory_id: string }> }) {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  map.territories.forEach((t, i) => { territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 }; });
  return {
    game_id: 'g1', era: 'medieval', map_id: map.map_id, phase: 'draft', turn_number: 1, current_player_index: 0,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Bot', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

function mount(map: typeof britain, fit: boolean, size = { width: 390, height: 740 }) {
  act(() => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, fit_board_camera_enabled: fit } }));
    useGameStore.setState({ gameState: gameStateFor(map) as never });
  });
  return render(
    <GlobeMapCore mapData={map} onTerritoryClick={() => {}} width={size.width} height={size.height}
      selfPlayerId="me" frameBudget reducedEffects autoSpin={false} />,
  );
}

const htmlAlt = (alt: number) => (globe.props!.htmlAltitude as (d: object) => number)({ alt });

describe('fitting a small board to the screen', () => {
  beforeEach(() => {
    globe.pov = { lat: 0, lng: 0, altitude: 1.8 };
    globe.props = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    act(() => {
      useGameStore.setState({ gameState: null });
      useUiStore.getState().reset();
      useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, fit_board_camera_enabled: false } }));
    });
  });

  it('opens Britain at its authored view while the switch is off', () => {
    mount(britain, false);
    expect(globe.pov).toMatchObject({ lat: 54, lng: -2, altitude: 0.55 });
    expect(htmlAlt(0.07)).toBeCloseTo(0.07);
  });

  it('zooms Britain in to fill a phone, centred on the board, and lowers the labels in step', () => {
    mount(britain, true);
    expect(globe.pov.altitude).toBeGreaterThan(0.18);
    expect(globe.pov.altitude).toBeLessThan(0.3);
    expect(globe.pov.lat).toBeCloseTo(54.25);
    expect(globe.pov.lng).toBeCloseTo(-3);
    expect(htmlAlt(0.07)).toBeCloseTo(0.07 * (globe.pov.altitude / 0.55));
  });

  it('leaves a board wider than the phone at its authored view', () => {
    mount(australia, true);
    expect(globe.pov.altitude).toBe(australia.globe_view.altitude);
    expect(htmlAlt(0.07)).toBeCloseTo(0.07);
  });
});
