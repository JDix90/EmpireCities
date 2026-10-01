import { describe, it, expect } from 'vitest';
import { LANE_COLORS, laneStroke, type LaneStrokeInput } from './galaxyLaneStyle';

const base: LaneStrokeInput = { sealed: false, accessAllowed: true, state: 'closed', kind: 'authored', viewerColor: '#c0392b' };
const style = (over: Partial<LaneStrokeInput>) => laneStroke({ ...base, ...over });

describe('laneStroke', () => {
  it("draws the viewer's corridor in their colour, an open lane blue, a closed one dim", () => {
    expect(style({ state: 'corridor' })).toEqual({ stroke: '#c0392b', strokeWidth: 2.4, dash: '11 4', flow: true });
    expect(style({ state: 'open' })).toEqual({ stroke: LANE_COLORS.open, strokeWidth: 1.8, dash: '7 6', flow: true });
    expect(style({ state: 'closed' })).toEqual({ stroke: LANE_COLORS.closed, strokeWidth: 1.2, dash: '2 5', flow: false });
  });

  it('puts a seal first, then a lock, over whatever the viewer holds', () => {
    expect(style({ state: 'corridor', sealed: true, accessAllowed: false }))
      .toEqual({ stroke: LANE_COLORS.sealed, strokeWidth: 2.6, dash: '4 4', flow: false });
    expect(style({ state: 'corridor', accessAllowed: false }))
      .toEqual({ stroke: LANE_COLORS.gated, strokeWidth: 1.7, dash: '3 6', flow: false });
  });

  it('thins the lanes an engine added, whatever their state', () => {
    expect(style({ state: 'corridor', kind: 'jump_gate' })).toMatchObject({ strokeWidth: 1.6, dash: '1 4', stroke: '#c0392b' });
    expect(style({ state: 'corridor', kind: 'lane_surge' })).toMatchObject({ strokeWidth: 1.8, dash: '5 3' });
    // Already thinner than the cap: left as it is.
    expect(style({ state: 'closed', kind: 'jump_gate' })).toMatchObject({ strokeWidth: 1.2, dash: '1 4' });
    expect(style({ state: 'open', kind: 'colony' })).toMatchObject({ strokeWidth: 1.8, dash: '7 6' });
  });
});
