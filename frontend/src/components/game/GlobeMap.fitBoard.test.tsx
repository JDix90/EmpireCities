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
import { ACW_TERRITORY_STATES } from '../../data/acwStateMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), `../database/maps/${id}.json`), 'utf8'));
const britain = load('community_britain_925');
const australia = load('community_australia_1337');
const civilWar = load('era_acw');

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

describe('fitting a small board to the screen', () => {
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

const RAD = Math.PI / 180;
type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec): Vec => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
/** A lat/lng in globe radii, as three-globe places it (polar2Cartesian). */
const toScene = (lat: number, lng: number, r = 1): Vec => {
  const phi = (90 - lat) * RAD;
  const theta = (90 - lng) * RAD;
  return [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
};

/**
 * Where a lat/lng lands on a canvas this size, seen from this point of view:
 * three.js's 50° vertical field of view, looking at the globe's centre with
 * north up, as globe.gl points its camera. Null when the globe hides it.
 */
function onCanvas(pov: { lat: number; lng: number; altitude: number }, lat: number, lng: number, width: number, height: number) {
  const cam = toScene(pov.lat, pov.lng, 1 + pov.altitude);
  const p = toScene(lat, lng);
  if (dot(p, unit(cam)) <= 1 / (1 + pov.altitude)) return null;
  const forward = unit([-cam[0], -cam[1], -cam[2]]);
  const right = unit([-forward[2], 0, forward[0]]);
  const up: Vec = [-right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1]];
  const rel: Vec = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const depth = dot(rel, forward);
  const halfTan = Math.tan(25 * RAD);
  return {
    x: ((dot(rel, right) / depth / (halfTan * (width / height)) + 1) / 2) * width,
    y: ((1 - dot(rel, up) / depth / halfTan) / 2) * height,
  };
}

/** Every vertex of the Civil War board: its territories' states, from the file the game draws them from. */
function civilWarOutline(): Array<[number, number]> {
  const states = JSON.parse(readFileSync(resolve(process.cwd(), 'public/geo/ne_110m_admin_1_states_provinces.json'), 'utf8')) as GeoJSON.FeatureCollection;
  const onBoard = new Set(Object.values(ACW_TERRITORY_STATES).flat());
  const points: Array<[number, number]> = [];
  const found = new Set<string>();
  for (const f of states.features) {
    const postal = f.properties?.postal as string | undefined;
    if (f.properties?.adm0_a3 !== 'USA' || !postal || !onBoard.has(postal)) continue;
    found.add(postal);
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const ring of polygons.flat()) for (const [lng, lat] of ring) points.push([lat, lng]);
  }
  expect(found.size).toBe(onBoard.size);
  return points;
}

/**
 * The Civil War board on a portrait phone. It opened on the Pacific with the
 * US against the right edge, its camera exactly on the authored view all the
 * while: three-globe's build-in spin turns the globe itself, not the camera,
 * and the render loop stopped before the spin did (the intro modal holds it;
 * the phone budget wakes it for 100 ms), freezing the globe part-way round.
 * The board has no `projection_bounds`, so the fitted camera leaves it alone.
 */
describe('the Civil War board on a portrait phone', () => {
  // A 390×664 phone's map pane, between the game's header and footer.
  const phone = { width: 390, height: 559 };

  it.each([false, true])('opens on its authored view of the continental US (fit_board_camera_enabled %s)', (fit) => {
    mount(civilWar, fit, phone);
    expect(civilWar.globe_view).toMatchObject({ center_lat: 39, center_lng: -97, altitude: 1.2 });
    expect(globe.pov).toEqual({ lat: 39, lng: -97, altitude: 1.2 });
  });

  it('turns off the build-in spin, so the globe sits where the camera expects it', () => {
    mount(civilWar, false, phone);
    expect(globe.props!.animateIn).toBe(false);
  });

  it('has every state on the board on screen at that view, the board centred', () => {
    mount(civilWar, false, phone);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [lat, lng] of civilWarOutline()) {
      const at = onCanvas(globe.pov, lat, lng, phone.width, phone.height);
      expect(at, `${lat},${lng} is behind the globe`).not.toBeNull();
      xs.push(at!.x);
      ys.push(at!.y);
    }
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(phone.width);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(phone.height);
    expect(Math.abs((left + right) / 2 - phone.width / 2)).toBeLessThan(phone.width * 0.05);
    expect(Math.abs((top + bottom) / 2 - phone.height / 2)).toBeLessThan(phone.height * 0.05);
  });
});
