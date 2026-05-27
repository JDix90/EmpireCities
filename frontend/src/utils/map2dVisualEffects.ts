import * as PIXI from 'pixi.js';
import type { MapVisualEvent } from '../utils/mapVisualEvents';
import {
  CAPTURE_FLASH_RGB,
  COMBAT_RING_RGB,
  EVENT_AMBER_RGB,
  EVENT_STABILITY_RGB,
  EVENT_TRUCE_RGB,
  FORTIFY_COLOR,
  INFLUENCE_RING_RGB,
  INFLUENCE_BLOCKED_RGB,
  MAP_VISUAL_DURATIONS,
  NAVAL_RING_RGB,
  REINFORCE_COLOR,
  hexToRgb,
  lerpRgb,
  rgbToPixi,
} from '../utils/mapVisualStyles';
import { eventDurationMs, resolveEventVisualMode } from '../utils/mapEventEffects';

export interface TerritoryCentroid {
  territoryId: string;
  regionId?: string;
  x: number;
  y: number;
  polygon: [number, number][];
}

const PLAYER_HEX: Record<string, number> = {
  '#e74c3c': 0xe74c3c,
  '#3498db': 0x3498db,
  '#2ecc71': 0x2ecc71,
  '#f39c12': 0xf39c12,
  '#9b59b6': 0x9b59b6,
  '#1abc9c': 0x1abc9c,
  '#e67e22': 0xe67e22,
  '#ecf0f1': 0xecf0f1,
};

function playerHex(color?: string): number {
  if (!color) return 0x888888;
  return PLAYER_HEX[color] ?? (parseInt(color.replace('#', ''), 16) || 0x888888);
}

function drawPolygon(g: PIXI.Graphics, points: [number, number][], fill: number, alpha: number, border?: number): void {
  if (points.length < 3) return;
  g.lineStyle(border != null ? 2 : 0, border ?? fill, border != null ? 0.9 : 0);
  g.beginFill(fill, alpha);
  g.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i]![0], points[i]![1]);
  g.closePath();
  g.endFill();
}

function runReinforceEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  centroid: TerritoryCentroid,
  onDone: () => void,
): void {
  const color = event.playerColor ?? REINFORCE_COLOR;
  const txt = new PIXI.Text(`+${event.units ?? 1}`, {
    fontSize: 22,
    fill: color,
    fontWeight: 'bold',
  });
  txt.anchor.set(0.5);
  txt.position.set(centroid.x, centroid.y);
  layer.addChild(txt);

  const totalTxt = new PIXI.Text(`Total: ${event.totalAfter ?? '?'}`, {
    fontSize: 14,
    fill: color,
    fontWeight: 'bold',
  });
  totalTxt.anchor.set(0.5);
  totalTxt.alpha = 0;
  totalTxt.position.set(centroid.x, centroid.y + 22);
  layer.addChild(totalTxt);

  const started = Date.now();
  const ticker = new PIXI.Ticker();
  ticker.add(() => {
    const elapsed = Date.now() - started;
    if (elapsed < 800) {
      txt.alpha = Math.min(1, elapsed / 400);
      txt.position.y = centroid.y - (elapsed / 800) * 18;
    } else if (elapsed < 2000) {
      txt.alpha = Math.max(0, 1 - (elapsed - 1800) / 200);
      totalTxt.alpha = Math.min(1, (elapsed - 800) / 300);
    } else if (elapsed >= MAP_VISUAL_DURATIONS.reinforce) {
      ticker.destroy();
      txt.destroy();
      totalTxt.destroy();
      onDone();
    }
  });
  ticker.start();
}

function runFortifyEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  from: TerritoryCentroid,
  to: TerritoryCentroid,
  onDone: () => void,
): void {
  const arc = new PIXI.Graphics();
  layer.addChild(arc);
  const label = new PIXI.Text(`→ ${event.units ?? 1}`, {
    fontSize: 16,
    fill: event.playerColor ?? FORTIFY_COLOR,
    fontWeight: 'bold',
  });
  label.anchor.set(0.5);
  label.position.set((from.x + to.x) / 2, (from.y + to.y) / 2 - 10);
  layer.addChild(label);

  const started = Date.now();
  const ticker = new PIXI.Ticker();
  ticker.add(() => {
    const elapsed = Date.now() - started;
    const t = Math.min(1, elapsed / 600);
    arc.clear();
    arc.lineStyle(3, playerHex(event.playerColor ?? FORTIFY_COLOR), 0.35 + t * 0.55);
    arc.moveTo(from.x, from.y);
    arc.lineTo(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    label.alpha = t;
    if (elapsed >= MAP_VISUAL_DURATIONS.fortify) {
      ticker.destroy();
      arc.destroy();
      label.destroy();
      onDone();
    }
  });
  ticker.start();
}

function runCombatEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  from: TerritoryCentroid | null,
  to: TerritoryCentroid,
  onDone: () => void,
): void {
  const arc = new PIXI.Graphics();
  const ring = new PIXI.Graphics();
  layer.addChild(arc);
  layer.addChild(ring);

  const lossLabels: PIXI.Text[] = [];
  const addLoss = (x: number, y: number, text: string) => {
    const lbl = new PIXI.Text(text, { fontSize: 15, fill: '#fca5a5', fontWeight: 'bold' });
    lbl.anchor.set(0.5);
    lbl.position.set(x, y);
    lbl.alpha = 0;
    layer.addChild(lbl);
    lossLabels.push(lbl);
  };

  let captureOverlay: PIXI.Graphics | null = null;
  if (event.captured && event.newOwnerColor) {
    captureOverlay = new PIXI.Graphics();
    layer.addChild(captureOverlay);
  }

  const started = Date.now();
  const duration = event.captured ? MAP_VISUAL_DURATIONS.combatCaptured : MAP_VISUAL_DURATIONS.combat;
  const ticker = new PIXI.Ticker();

  ticker.add(() => {
    const elapsed = Date.now() - started;

    if (from && elapsed >= 400 && elapsed < 1800) {
      const t = Math.min(1, (elapsed - 400) / 500);
      arc.clear();
      arc.lineStyle(3, playerHex(event.attackerColor ?? '#ef4444'), 0.85);
      arc.moveTo(from.x, from.y);
      arc.lineTo(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }

    if (elapsed >= 900 && elapsed < 2200) {
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin((elapsed - 900) * 0.012));
      const r = 12 + pulse * 22;
      ring.clear();
      ring.lineStyle(3, rgbToPixi(COMBAT_RING_RGB), pulse * 0.85);
      ring.drawCircle(to.x, to.y, r);
    }

    if (elapsed >= 1800 && lossLabels.length === 0) {
      if (from && (event.attackerLosses ?? 0) > 0) {
        addLoss(from.x, from.y - 16, `-${event.attackerLosses} ⚔`);
      }
      if ((event.defenderLosses ?? 0) > 0) {
        addLoss(to.x, to.y - 16, `-${event.defenderLosses} 🛡`);
      }
      for (const lbl of lossLabels) lbl.alpha = 1;
    }

    if (captureOverlay && event.captured && elapsed >= 2200) {
      const capT = Math.min(1, (elapsed - 2200) / MAP_VISUAL_DURATIONS.captureFlash);
      const fromRgb = event.defenderColor ? hexToRgb(event.defenderColor) : CAPTURE_FLASH_RGB;
      const toRgb = hexToRgb(event.newOwnerColor ?? '#ffffff');
      const mix = lerpRgb(fromRgb, toRgb, capT);
      captureOverlay.clear();
      drawPolygon(captureOverlay, to.polygon, rgbToPixi(mix), 0.35 + capT * 0.45, rgbToPixi(mix));
    }

    if (elapsed >= duration) {
      ticker.destroy();
      arc.destroy();
      ring.destroy();
      captureOverlay?.destroy();
      for (const lbl of lossLabels) lbl.destroy();
      onDone();
    }
  });
  ticker.start();
}

function runNavalEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  from: TerritoryCentroid | null,
  to: TerritoryCentroid,
  onDone: () => void,
): void {
  const arc = new PIXI.Graphics();
  const ring = new PIXI.Graphics();
  const splash = new PIXI.Text('⚓', { fontSize: 28, fontWeight: 'bold' });
  splash.anchor.set(0.5);
  splash.position.set(to.x, to.y);
  splash.alpha = 0;
  layer.addChild(arc);
  layer.addChild(ring);
  layer.addChild(splash);

  const lossLabels: PIXI.Text[] = [];
  const started = Date.now();
  const ticker = new PIXI.Ticker();

  ticker.add(() => {
    const elapsed = Date.now() - started;

    if (from && elapsed >= 300 && elapsed < 1600) {
      const t = Math.min(1, (elapsed - 300) / 450);
      arc.clear();
      arc.lineStyle(3.5, rgbToPixi(NAVAL_RING_RGB), 0.5 + t * 0.45);
      arc.moveTo(from.x, from.y);
      arc.lineTo(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }

    if (elapsed >= 700) {
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin((elapsed - 700) * 0.014));
      ring.clear();
      ring.lineStyle(3, rgbToPixi(NAVAL_RING_RGB), pulse * 0.9);
      ring.drawCircle(to.x, to.y, 14 + pulse * 20);
      splash.alpha = Math.min(1, (elapsed - 700) / 250);
    }

    if (elapsed >= 1500 && lossLabels.length === 0) {
      if (from && (event.attackerLosses ?? 0) > 0) {
        const lbl = new PIXI.Text(`-${event.attackerLosses} ⚓`, { fontSize: 14, fill: '#7dd3fc', fontWeight: 'bold' });
        lbl.anchor.set(0.5);
        lbl.position.set(from.x, from.y - 16);
        layer.addChild(lbl);
        lossLabels.push(lbl);
      }
      if ((event.defenderLosses ?? 0) > 0) {
        const lbl = new PIXI.Text(`-${event.defenderLosses} ⚓`, { fontSize: 14, fill: '#bae6fd', fontWeight: 'bold' });
        lbl.anchor.set(0.5);
        lbl.position.set(to.x, to.y + 18);
        layer.addChild(lbl);
        lossLabels.push(lbl);
      }
    }

    if (elapsed >= MAP_VISUAL_DURATIONS.naval) {
      ticker.destroy();
      arc.destroy();
      ring.destroy();
      splash.destroy();
      for (const lbl of lossLabels) lbl.destroy();
      onDone();
    }
  });
  ticker.start();
}

function runInfluenceEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  target: TerritoryCentroid,
  onDone: () => void,
): void {
  const blocked = event.variant === 'blocked';
  const ringRgb = blocked ? INFLUENCE_BLOCKED_RGB : INFLUENCE_RING_RGB;
  const duration = blocked ? MAP_VISUAL_DURATIONS.influenceBlocked : MAP_VISUAL_DURATIONS.influence;

  const ring = new PIXI.Graphics();
  const icon = new PIXI.Text(blocked ? '🚫' : '📡', { fontSize: 26, fontWeight: 'bold' });
  icon.anchor.set(0.5);
  icon.position.set(target.x, target.y);
  icon.alpha = 0;
  layer.addChild(ring);
  layer.addChild(icon);

  let captureOverlay: PIXI.Graphics | null = null;
  if (!blocked && event.newOwnerColor) {
    captureOverlay = new PIXI.Graphics();
    layer.addChild(captureOverlay);
  }

  const started = Date.now();
  const ticker = new PIXI.Ticker();

  ticker.add(() => {
    const elapsed = Date.now() - started;

    if (elapsed >= 200) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(elapsed * (blocked ? 0.014 : 0.011)));
      const r = 10 + pulse * (blocked ? 20 : 28);
      ring.clear();
      ring.lineStyle(3, rgbToPixi(ringRgb), pulse * (blocked ? 0.65 : 0.85));
      ring.drawCircle(target.x, target.y, r);
      icon.alpha = Math.min(1, (elapsed - 200) / 350);
    }

    if (captureOverlay && event.newOwnerColor && elapsed >= 1200) {
      const capT = Math.min(1, (elapsed - 1200) / MAP_VISUAL_DURATIONS.captureFlash);
      const fromRgb = event.defenderColor ? hexToRgb(event.defenderColor) : [80, 80, 100] as [number, number, number];
      const toRgb = hexToRgb(event.newOwnerColor ?? '#ffffff');
      const mix = lerpRgb(fromRgb, toRgb, capT);
      captureOverlay.clear();
      drawPolygon(captureOverlay, target.polygon, rgbToPixi(mix), 0.3 + capT * 0.5, rgbToPixi(mix));
    }

    if (elapsed >= duration) {
      ticker.destroy();
      ring.destroy();
      icon.destroy();
      captureOverlay?.destroy();
      onDone();
    }
  });
  ticker.start();
}

function runEventEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  centroids: Map<string, TerritoryCentroid>,
  onDone: () => void,
): void {
  const mode = resolveEventVisualMode(event);
  const duration = eventDurationMs(mode);
  const labels: PIXI.Text[] = [];
  const graphics: PIXI.Graphics[] = [];

  const addLabel = (x: number, y: number, text: string, color: string, delay = 0) => {
    const lbl = new PIXI.Text(text, { fontSize: 20, fill: color, fontWeight: 'bold' });
    lbl.anchor.set(0.5);
    lbl.position.set(x, y);
    lbl.alpha = 0;
    layer.addChild(lbl);
    labels.push(lbl);
    (lbl as PIXI.Text & { _delay?: number })._delay = delay;
    return lbl;
  };

  if (mode === 'territory_deltas' && event.affectedTerritories?.length) {
    for (const row of event.affectedTerritories) {
      const c = centroids.get(row.territory_id);
      if (!c) continue;
      const sign = row.delta >= 0 ? '+' : '';
      const color = row.delta >= 0 ? REINFORCE_COLOR : '#f87171';
      addLabel(c.x, c.y, `${sign}${row.delta}`, color);
    }
  } else if (mode === 'strike_hit') {
    for (const row of event.affectedTerritories ?? [{ territory_id: event.territoryId, delta: -1 }]) {
      const c = centroids.get(row.territory_id);
      if (!c) continue;
      const ring = new PIXI.Graphics();
      layer.addChild(ring);
      graphics.push(ring);
      (ring as PIXI.Graphics & { _centroid?: TerritoryCentroid })._centroid = c;
      if (row.delta !== 0) {
        addLabel(c.x, c.y - 14, `-${Math.abs(row.delta)}`, '#fca5a5');
      }
    }
  } else if (mode === 'global_disaster') {
    const targets = event.affectedTerritories?.length
      ? event.affectedTerritories.map((r) => centroids.get(r.territory_id)).filter(Boolean) as TerritoryCentroid[]
      : [...centroids.values()];
    for (const c of targets) {
      const g = new PIXI.Graphics();
      layer.addChild(g);
      graphics.push(g);
      (g as PIXI.Graphics & { _centroid?: TerritoryCentroid })._centroid = c;
      if (event.affectedTerritories) {
        const row = event.affectedTerritories.find((r) => r.territory_id === c.territoryId);
        if (row && row.delta !== 0) {
          addLabel(c.x, c.y, `${row.delta}`, '#fbbf24');
        }
      }
    }
  } else if (mode === 'region_highlight') {
    const regionId = event.regionId;
    const inRegion = [...centroids.values()].filter((c) => !regionId || c.regionId === regionId);
    for (const c of inRegion) {
      const g = new PIXI.Graphics();
      layer.addChild(g);
      graphics.push(g);
      (g as PIXI.Graphics & { _centroid?: TerritoryCentroid })._centroid = c;
    }
    if (inRegion.length === 0) {
      onDone();
      return;
    }
  } else if (mode === 'truce_pulse') {
    const sample = [...centroids.values()].slice(0, 8);
    for (const c of sample) {
      const g = new PIXI.Graphics();
      layer.addChild(g);
      graphics.push(g);
      (g as PIXI.Graphics & { _centroid?: TerritoryCentroid })._centroid = c;
    }
  } else if (mode === 'draft_bonus') {
    const bonus = event.units ?? 0;
    const sample = [...centroids.values()].slice(0, 6);
    for (const c of sample) {
      addLabel(c.x, c.y, `+${bonus}`, REINFORCE_COLOR);
    }
  }

  const started = Date.now();
  const ticker = new PIXI.Ticker();
  ticker.add(() => {
    const elapsed = Date.now() - started;

    for (const lbl of labels) {
      const delay = (lbl as PIXI.Text & { _delay?: number })._delay ?? 0;
      const local = elapsed - delay;
      if (local < 0) continue;
      if (local < 500) {
        lbl.alpha = Math.min(1, local / 300);
        lbl.position.y -= 0.4;
      } else if (local > duration - 400) {
        lbl.alpha = Math.max(0, 1 - (local - (duration - 400)) / 400);
      } else {
        lbl.alpha = 1;
      }
    }

    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(elapsed * 0.009));
    for (const g of graphics) {
      const c = (g as PIXI.Graphics & { _centroid?: TerritoryCentroid })._centroid;
      if (!c) continue;
      g.clear();
      if (mode === 'global_disaster') {
        drawPolygon(g, c.polygon, rgbToPixi(EVENT_AMBER_RGB), pulse * 0.35);
        g.lineStyle(2, rgbToPixi(EVENT_AMBER_RGB), pulse * 0.7);
        g.drawCircle(c.x, c.y, 8 + pulse * 12);
      } else if (mode === 'region_highlight') {
        drawPolygon(g, c.polygon, rgbToPixi(EVENT_STABILITY_RGB), pulse * 0.28);
      } else if (mode === 'truce_pulse') {
        g.lineStyle(3, rgbToPixi(EVENT_TRUCE_RGB), pulse * 0.75);
        g.drawCircle(c.x, c.y, 10 + pulse * 16);
      } else if (mode === 'strike_hit') {
        g.lineStyle(3, rgbToPixi(COMBAT_RING_RGB), pulse * 0.9);
        g.drawCircle(c.x, c.y, 12 + pulse * 18);
      }
    }

    if (elapsed >= duration) {
      ticker.destroy();
      for (const lbl of labels) lbl.destroy();
      for (const g of graphics) g.destroy();
      onDone();
    }
  });
  ticker.start();
}

export function playMap2dVisualEffect(
  layer: PIXI.Container,
  event: MapVisualEvent,
  centroids: Map<string, TerritoryCentroid>,
  onDone: () => void,
): void {
  if (event.kind === 'strike') {
    onDone();
    return;
  }

  if (event.kind === 'event') {
    runEventEffect(layer, event, centroids, onDone);
    return;
  }

  const target = centroids.get(event.territoryId);
  if (!target) {
    onDone();
    return;
  }

  switch (event.kind) {
    case 'reinforce':
      runReinforceEffect(layer, event, target, onDone);
      break;
    case 'fortify': {
      const from = event.fromTerritoryId ? centroids.get(event.fromTerritoryId) : null;
      if (!from) {
        onDone();
        return;
      }
      runFortifyEffect(layer, event, from, target, onDone);
      break;
    }
    case 'combat':
    case 'capture': {
      const from = event.fromTerritoryId ? centroids.get(event.fromTerritoryId) : null;
      runCombatEffect(layer, event, from ?? null, target, onDone);
      break;
    }
    case 'naval': {
      const from = event.fromTerritoryId ? centroids.get(event.fromTerritoryId) : null;
      runNavalEffect(layer, event, from ?? null, target, onDone);
      break;
    }
    case 'influence':
      runInfluenceEffect(layer, event, target, onDone);
      break;
    default:
      onDone();
  }
}
