import { describe, it, expect } from 'vitest';
import {
  clipCameraAt,
  clipCameraSettledAt,
  planClipCamera,
  planClipGifFrames,
  capturesByStep,
  type ClipCameraPath,
  type ClipCameraStep,
} from './clipCameraDirector';
import type { ClipFrameState, ClipGlobeData, ClipGlobeTerritory } from './replayClipRenderer';
import { buildClipGlobeData } from './clipGlobeData';
import type { PolygonData } from './globeTerritoryGeometry';

const DEG = Math.PI / 180;

function square(id: string, lng: number, lat: number, half = 2): ClipGlobeTerritory {
  return {
    territory_id: id,
    rings: [[
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
    ]],
  };
}

/** Twelve territories right round the equator, t0 at 0°, t1 at 30°E … t6 on the date line. */
function worldBoard(extra: Partial<ClipGlobeData> = {}): ClipGlobeData {
  return {
    territories: Array.from({ length: 12 }, (_, i) => square(`t${i}`, i <= 6 ? i * 30 : i * 30 - 360, 0)),
    camera: { centerLng: 0, centerLat: 0, angularRadiusDeg: 90 },
    ...extra,
  };
}

/** Everything within 20° of the view center: one fixed view shows it all. */
function regionalBoard(): ClipGlobeData {
  return {
    territories: [square('a', 10, 45), square('b', 20, 50), square('c', 25, 40), square('d', 5, 38)],
    camera: { centerLng: 15, centerLat: 44, angularRadiusDeg: 20 },
  };
}

function board(owners: Record<string, string | null>): ClipFrameState {
  const territories: ClipFrameState['territories'] = {};
  for (const [id, owner] of Object.entries(owners)) territories[id] = { owner_id: owner };
  return { turn_number: 1, players: [], territories };
}

/** Every territory owned by 'p1'; `changes` hands the listed ones to others. */
function allP1(changes: Record<string, string> = {}): ClipFrameState {
  const owners: Record<string, string> = {};
  for (let i = 0; i < 12; i++) owners[`t${i}`] = 'p1';
  return board({ ...owners, ...changes });
}

/**
 * Captures that alternate between the date line (t6) and Greenwich (t0), one
 * per moment, each handing the territory to a new owner so every moment has a
 * change on the opposite side from the last.
 */
function pingPong(moments: number): ClipFrameState[] {
  const owners: Record<string, string> = {};
  for (let i = 0; i < 12; i++) owners[`t${i}`] = 'p1';
  const states = [board({ ...owners })];
  for (let i = 0; i < moments; i++) {
    owners[i % 2 === 0 ? 't6' : 't0'] = `raider${i}`;
    states.push(board({ ...owners }));
  }
  return states;
}

function steps(...states: ClipFrameState[]): ClipCameraStep[] {
  return states.map((state) => ({ state, durationMs: 1500 }));
}

function angleBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const a = [Math.cos(aLat * DEG) * Math.cos(aLng * DEG), Math.cos(aLat * DEG) * Math.sin(aLng * DEG), Math.sin(aLat * DEG)];
  const b = [Math.cos(bLat * DEG) * Math.cos(bLng * DEG), Math.cos(bLat * DEG) * Math.sin(bLng * DEG), Math.sin(bLat * DEG)];
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;
}

function centerAt(path: ClipCameraPath, ms: number): { lng: number; lat: number } {
  const { camera } = clipCameraAt(path, ms);
  return { lng: camera.centerLng, lat: camera.centerLat };
}

describe('planClipCamera', () => {
  it('plans nothing without a globe or without a second moment', () => {
    expect(planClipCamera(null, steps(allP1(), allP1({ t6: 'p2' })))).toBeNull();
    expect(planClipCamera(worldBoard(), steps(allP1()))).toBeNull();
  });

  it('leaves a board the fixed view already covers alone', () => {
    const s = steps(
      board({ a: 'p1', b: 'p1', c: 'p2', d: 'p2' }),
      board({ a: 'p2', b: 'p1', c: 'p2', d: 'p1' }),
    );
    expect(planClipCamera(regionalBoard(), s)).toBeNull();
  });

  it('leaves a map that locks the globe rotation alone, whatever its extent', () => {
    expect(planClipCamera(worldBoard({ lockRotation: true }), steps(allP1(), allP1({ t6: 'p2' })))).toBeNull();
  });

  it('turns to a capture on the far side and arrives as it changes hands', () => {
    // t6 sits on the date line, directly behind a camera facing 0°.
    const path = planClipCamera(worldBoard(), steps(allP1(), allP1({ t6: 'p2' })))!;
    expect(path.turns).toHaveLength(1);
    const [turn] = path.turns;
    expect(turn.arriveMs).toBe(1500);
    // Sets off during the opening moment, and lands no later than halfway into the new one.
    expect(turn.startMs).toBeLessThan(1500);
    expect(turn.startMs).toBeGreaterThanOrEqual(1500 - 1500 * 0.6);
    expect(turn.endMs).toBeGreaterThanOrEqual(1500);
    expect(turn.endMs).toBeLessThanOrEqual(1500 + 1500 * 0.5);

    const settled = centerAt(path, turn.endMs + 1);
    expect(angleBetween(settled.lng, settled.lat, 180, 0)).toBeLessThan(1);
    // Before setting off, the opening view.
    expect(centerAt(path, 0)).toEqual({ lng: 0, lat: 0 });
  });

  it('keeps the zoom it was framed with', () => {
    const path = planClipCamera(worldBoard(), steps(allP1(), allP1({ t6: 'p2' })))!;
    for (const ms of [0, 1200, 1500, 2400]) expect(clipCameraAt(path, ms).camera.angularRadiusDeg).toBe(90);
  });

  it('reports the camera as moving only mid-turn', () => {
    const path = planClipCamera(worldBoard(), steps(allP1(), allP1({ t6: 'p2' })))!;
    const [turn] = path.turns;
    expect(clipCameraAt(path, turn.startMs - 1).moving).toBe(false);
    expect(clipCameraAt(path, (turn.startMs + turn.endMs) / 2).moving).toBe(true);
    expect(clipCameraAt(path, turn.endMs).moving).toBe(false);
  });

  it('holds still when the action is already near the middle', () => {
    // First turn to the date line; the next capture is 15° along, under the skip threshold.
    const withNeighbour = worldBoard();
    withNeighbour.territories.push(square('near', 165, 0));
    const withNear = (changes: Record<string, string>): ClipFrameState => {
      const owners: Record<string, string> = { near: 'p1' };
      for (let i = 0; i < 12; i++) owners[`t${i}`] = 'p1';
      return board({ ...owners, ...changes });
    };
    const path = planClipCamera(
      withNeighbour,
      steps(withNear({}), withNear({ t6: 'p2' }), withNear({ t6: 'p2', near: 'p2' })),
    )!;
    expect(path.turns).toHaveLength(1);
  });

  it('shows the bigger of two opposite fronts, not the ocean between them', () => {
    // Three captures around 90°E, one at 90°W.
    const path = planClipCamera(
      worldBoard(),
      steps(allP1(), allP1({ t2: 'p2', t3: 'p2', t4: 'p2', t9: 'p3' })),
    )!;
    const settled = centerAt(path, 10_000);
    expect(angleBetween(settled.lng, settled.lat, 90, 0)).toBeLessThan(5);
  });

  it('goes the short way across the date line', () => {
    // Turn to 150°E first, then to 150°W: 60° across the date line, not 300° back through Greenwich.
    const path = planClipCamera(
      worldBoard(),
      steps(allP1(), allP1({ t5: 'p2' }), allP1({ t5: 'p2', t7: 'p2' })),
    )!;
    expect(path.turns).toHaveLength(2);
    const second = path.turns[1];
    for (let k = 0; k <= 10; k++) {
      const { lng } = centerAt(path, second.startMs + ((second.endMs - second.startMs) * k) / 10);
      expect(Math.abs(lng)).toBeGreaterThanOrEqual(149);
    }
  });

  it('closes on the leading empire when the last moment changes nothing', () => {
    // p2 ends holding the four territories from 60°E to 150°E.
    const final = allP1({ t2: 'p2', t3: 'p2', t4: 'p2', t5: 'p2', t0: 'p3', t1: 'p3', t6: 'p3', t7: 'p3', t8: 'p3', t9: 'p3', t10: 'p3', t11: 'p1' });
    const withoutFinalChange = planClipCamera(worldBoard(), steps(allP1(), final, final))!;
    const settled = centerAt(withoutFinalChange, 10_000);
    // p3 holds the most (seven, from 150°W round to 30°E), so the closing view faces them.
    expect(angleBetween(settled.lng, settled.lat, -75, 0)).toBeLessThan(80);
  });

  it('keeps turns in order and never overlapping, however short the moments', () => {
    const quick: ClipCameraStep[] = pingPong(10).map((state) => ({ state, durationMs: 300 }));
    const path = planClipCamera(worldBoard(), quick)!;
    expect(path.turns.length).toBeGreaterThan(5);
    for (let k = 1; k < path.turns.length; k++) {
      expect(path.turns[k].startMs).toBeGreaterThanOrEqual(path.turns[k - 1].endMs);
      expect(path.turns[k].endMs).toBeGreaterThan(path.turns[k].startMs);
    }
  });

  it('rests after arriving before setting off again, when the moments allow it', () => {
    const path = planClipCamera(worldBoard(), pingPong(6).map((state) => ({ state, durationMs: 1500 })))!;
    expect(path.turns.length).toBeGreaterThan(3);
    for (let k = 1; k < path.turns.length; k++) {
      expect(path.turns[k].startMs - path.turns[k - 1].endMs).toBeGreaterThanOrEqual(300);
    }
  });

  it('stays finite when the next action is directly behind the camera', () => {
    const path = planClipCamera(worldBoard(), steps(allP1(), allP1({ t6: 'p2' })))!;
    const [turn] = path.turns;
    for (let k = 0; k <= 20; k++) {
      const c = centerAt(path, turn.startMs + ((turn.endMs - turn.startMs) * k) / 20);
      expect(Number.isFinite(c.lng)).toBe(true);
      expect(Number.isFinite(c.lat)).toBe(true);
    }
  });
});

describe('clipCameraSettledAt', () => {
  it('treats a turn as a cut at the moment it arrives for', () => {
    const path = planClipCamera(worldBoard(), steps(allP1(), allP1({ t6: 'p2' })))!;
    const [turn] = path.turns;
    expect(clipCameraSettledAt(path, turn.arriveMs - 1).centerLng).toBe(0);
    const after = clipCameraSettledAt(path, turn.arriveMs);
    expect(angleBetween(after.centerLng, after.centerLat, 180, 0)).toBeLessThan(1);
  });
});

describe('planClipGifFrames', () => {
  it('is one frame per moment without a camera plan, exactly as before', () => {
    const s: ClipCameraStep[] = [
      { state: allP1(), durationMs: 2400 },
      { state: allP1({ t1: 'p2' }), durationMs: 800 },
      { state: allP1({ t1: 'p2' }), durationMs: 3200 },
    ];
    expect(planClipGifFrames(s, null)).toEqual([
      { stepIndex: 0, atMs: 0, delayMs: 2400, turning: false },
      { stepIndex: 1, atMs: 2400, delayMs: 800, turning: false },
      { stepIndex: 2, atMs: 3200, delayMs: 3200, turning: false },
    ]);
  });

  it('adds in-between frames for a turn and keeps the clip the same length', () => {
    const s = steps(allP1(), allP1({ t6: 'p2' }), allP1({ t6: 'p2' }));
    const path = planClipCamera(worldBoard(), s)!;
    const frames = planClipGifFrames(s, path);
    const total = frames.reduce((sum, f) => sum + f.delayMs, 0);
    expect(total).toBeCloseTo(4500, 6);
    expect(frames.filter((f) => f.turning).length).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < frames.length; k++) expect(frames[k].atMs).toBeGreaterThanOrEqual(frames[k - 1].atMs);
    // Each frame belongs to the moment its slot falls in.
    for (const f of frames) {
      const start = f.stepIndex * 1500;
      expect(f.atMs).toBeGreaterThanOrEqual(start);
      expect(f.atMs).toBeLessThanOrEqual(start + 1500);
    }
  });

  it('holds the in-between frames to one budget however many turns there are', () => {
    const states = pingPong(40);
    const s = states.map((state) => ({ state, durationMs: 500 }));
    const path = planClipCamera(worldBoard(), s)!;
    expect(path.turns.length).toBeGreaterThan(30);
    const frames = planClipGifFrames(s, path);
    expect(frames.filter((f) => f.turning).length).toBeLessThanOrEqual(48);
    const total = frames.reduce((sum, f) => sum + f.delayMs, 0);
    expect(total).toBeCloseTo(500 * states.length, 6);
  });
});

describe('capturesByStep', () => {
  it('lists the tiles on the board that changed hands in each moment, none in the opening one', () => {
    const s = steps(allP1(), allP1({ t3: 'p2' }), allP1({ t3: 'p2' }), allP1({ t3: 'p2', t9: 'p3' }));
    expect(capturesByStep(worldBoard(), s)).toEqual([[], ['t3'], [], ['t9']]);
  });

  it('ignores changes to tiles that are not on the board', () => {
    // The Moon inset asks about its own tiles only; Earth's fighting is not its news.
    const moonOnly: ClipGlobeData = { territories: [square('moon_a', 0, 0)], camera: { centerLng: 0, centerLat: 0, angularRadiusDeg: 90 } };
    const s = steps(board({ moon_a: null, t1: 'p1' }), board({ moon_a: null, t1: 'p2' }), board({ moon_a: 'p2', t1: 'p2' }));
    expect(capturesByStep(moonOnly, s)).toEqual([[], [], ['moon_a']]);
  });

  it('lists nothing without a board', () => {
    expect(capturesByStep(null, steps(allP1(), allP1({ t3: 'p2' })))).toEqual([[], []]);
  });
});

describe('the Moon inset', () => {
  /** Authored lunar tiles are wide lon/lat quads, like the Space Age map's. */
  function lunar(id: string, west: number, east: number, south: number, north: number): PolygonData {
    return {
      territory_id: id,
      name: id,
      geometry: {
        type: 'Polygon',
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
    };
  }

  it('opens on the near side and turns to a capture on the far side', () => {
    const moon = buildClipGlobeData(
      [
        lunar('near_north', -70, 70, 5, 55),
        lunar('near_south', -60, 50, -55, -5),
        lunar('far_north', 95, 175, 5, 55),
        lunar('far_south', 95, 175, -55, -5),
      ],
      { territoryIds: ['near_north', 'near_south', 'far_north', 'far_south'], globeView: { center_lat: 0, center_lng: 0 } },
    )!;
    expect(moon.camera.centerLng).toBe(0);
    expect(moon.camera.angularRadiusDeg).toBe(90);

    const start = board({ near_north: null, near_south: null, far_north: null, far_south: null });
    const farCaptured = board({ near_north: null, near_south: null, far_north: 'p2', far_south: null });
    const path = planClipCamera(moon, steps(start, farCaptured))!;
    expect(path.turns).toHaveLength(1);
    const settled = centerAt(path, 10_000);
    expect(angleBetween(settled.lng, settled.lat, 135, 30)).toBeLessThan(10);
  });
});
