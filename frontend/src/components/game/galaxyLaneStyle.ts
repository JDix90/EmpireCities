/**
 * How a hyperspace lane is drawn for the viewer, wherever it is drawn: the
 * galaxy chart (GalaxyStrategicView) and the lines across Split's panes
 * (GalaxySplitView). One style, so the two views read the same.
 */
import type { LaneKind, LaneState } from '../../utils/galaxyLanes';

export const LANE_COLORS = {
  open: 'rgba(120, 200, 255, 0.78)',
  closed: 'rgba(150, 160, 180, 0.32)',
  sealed: 'rgba(255, 120, 60, 0.95)',
  gated: 'rgba(255, 110, 110, 0.5)',
} as const;

export interface LaneStroke {
  stroke: string;
  strokeWidth: number;
  dash: string;
  /** The lane is live for the viewer (their corridor, or open): the chart animates its dashes. */
  flow: boolean;
}

export interface LaneStrokeInput {
  /** Any Emergency Seal on the lane, whoever set it. */
  sealed: boolean;
  /** The viewer may cross lanes at all (orbit access). */
  accessAllowed: boolean;
  state: LaneState;
  kind: LaneKind;
  /** The viewer's colour: their corridor wears it. */
  viewerColor: string;
}

/**
 * Sealed, locked, the viewer's corridor, open (they hold one end) or closed,
 * in that order of precedence. An engine-added lane reads as what it is: a
 * Jump Gate lane a thin private thread, a surge a loose temporary one.
 */
export function laneStroke({ sealed, accessAllowed, state, kind, viewerColor }: LaneStrokeInput): LaneStroke {
  let stroke: string;
  let strokeWidth: number;
  let dash: string;
  let flow = false;
  if (sealed) {
    stroke = LANE_COLORS.sealed;
    strokeWidth = 2.6;
    dash = '4 4';
  } else if (!accessAllowed) {
    stroke = LANE_COLORS.gated;
    strokeWidth = 1.7;
    dash = '3 6';
  } else if (state === 'corridor') {
    stroke = viewerColor;
    strokeWidth = 2.4;
    dash = '11 4';
    flow = true;
  } else if (state === 'open') {
    stroke = LANE_COLORS.open;
    strokeWidth = 1.8;
    dash = '7 6';
    flow = true;
  } else {
    stroke = LANE_COLORS.closed;
    strokeWidth = 1.2;
    dash = '2 5';
  }
  if (kind === 'jump_gate') {
    strokeWidth = Math.min(strokeWidth, 1.6);
    dash = '1 4';
  } else if (kind === 'lane_surge') {
    strokeWidth = Math.min(strokeWidth, 1.8);
    dash = '5 3';
  }
  return { stroke, strokeWidth, dash, flow };
}
