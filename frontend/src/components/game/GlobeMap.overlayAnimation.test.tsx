/**
 * Globe effects play over their territory, not in the canvas's top-left
 * corner. The globe's CSS2DRenderer places each HTML overlay by writing
 * `style.transform` on the element it is handed, every frame; an effect that
 * animated `transform` on that same element replaced the placement while it
 * ran, so a reinforcement's "+3" and "Total: 9", the capture flag and the
 * battle flashes all played in the corner. The placed element must stay bare
 * and the animation must run on a child.
 *
 * react-globe.gl is replaced by a stand-in that records the overlays and the
 * element builder it is handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
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
      pointOfView: () => ({ lat: 0, lng: 0, altitude: 1.8 }),
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

import { GlobeMapCore, type GlobeEvent } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

const britain = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/community_britain_925.json'), 'utf8'));
const [first, second] = britain.territories as Array<{ territory_id: string }>;

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

type Overlay = { kind: string; id: string };

/** Every overlay on the globe now, built the way the globe builds it. */
function overlaysOnGlobe(): Array<{ kind: string; el: HTMLElement }> {
  const data = (globe.props!.htmlElementsData as Overlay[]) ?? [];
  const build = globe.props!.htmlElement as (d: object) => HTMLElement;
  return data.map((d) => ({ kind: d.kind, el: build(d) }));
}

/** The element the renderer places carries no animation or transform of its own. */
function expectPlacedElementBare(el: HTMLElement) {
  expect(el.style.animation).toBe('');
  expect(el.style.animationName).toBe('');
  expect(el.style.transform).toBe('');
}

function play(events: GlobeEvent[]) {
  act(() => { useGameStore.setState({ gameState: gameState() as never }); });
  return render(
    <GlobeMapCore mapData={britain} onTerritoryClick={() => {}} width={390} height={740}
      selfPlayerId="me" frameBudget reducedEffects autoSpin={false} events={events} />,
  );
}

describe('globe effects play over their territory', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    globe.props = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useGameStore.setState({ gameState: null });
      useUiStore.getState().reset();
    });
  });

  it('animates a reinforcement\'s "+3" and "Total: 6" on a child of the placed element', () => {
    play([{ id: 'ev-r', type: 'reinforce', territoryId: first.territory_id, playerId: 'ai_1', units: 3, totalAfter: 6, playerColor: '#3498db' }]);

    act(() => { vi.advanceTimersByTime(900); });
    const plus = overlaysOnGlobe().find((o) => o.kind === 'animation-units-plus');
    expect(plus).toBeDefined();
    expectPlacedElementBare(plus!.el);
    const plusFx = plus!.el.firstElementChild as HTMLElement;
    expect(plusFx.style.animationName || plusFx.style.animation).toContain('globeFloatUp');
    expect(plus!.el.textContent).toBe('+3');

    act(() => { vi.advanceTimersByTime(1200); });
    const total = overlaysOnGlobe().find((o) => o.kind === 'animation-units-total');
    expect(total).toBeDefined();
    expectPlacedElementBare(total!.el);
    const totalFx = total!.el.firstElementChild as HTMLElement;
    expect(totalFx.style.animationName || totalFx.style.animation).toContain('globePulseIn');
    expect(total!.el.textContent).toBe('Total: 6');
  });

  it('leaves every battle overlay\'s placed element bare through a capture', () => {
    play([{
      id: 'ev-c', type: 'combat', territoryId: second.territory_id, fromTerritoryId: first.territory_id, playerId: 'ai_1',
      attackerLosses: 1, defenderLosses: 2, captured: true, attackerColor: '#3498db', defenderColor: '#c0392b', newOwnerColor: '#3498db',
    }]);

    const seen = new Set<string>();
    for (let t = 0; t < 8000; t += 100) {
      act(() => { vi.advanceTimersByTime(100); });
      for (const { kind, el } of overlaysOnGlobe()) {
        if (!kind.startsWith('animation-')) continue;
        seen.add(kind);
        expectPlacedElementBare(el);
        const fx = el.firstElementChild as HTMLElement | null;
        expect(fx?.style.animation || fx?.style.animationName).toBeTruthy();
      }
    }
    expect(seen.has('animation-captured')).toBe(true);
    expect(seen.has('animation-explosion')).toBe(true);
  });
});
