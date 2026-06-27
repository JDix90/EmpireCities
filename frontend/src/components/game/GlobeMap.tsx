/**
 * Borderfall — Interactive 3D Globe Map
 * Renders territories on a spin-able 3D globe using react-globe.gl.
 * Supports animated event overlays: reinforcements, combat, and fortification.
 */

import React, { useRef, useMemo, useState, useEffect, useCallback, lazy, Suspense } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { FastForward } from 'lucide-react';
const GameMapLazy = lazy(() => import('./GameMap'));
import { useGameStore } from '../../store/gameStore';
import { resolvePlayerTechEraId } from '../../utils/eraAdvancement';
import { eraBoardTheme } from '../../constants/eraBoardTheme';
import { useUiStore } from '../../store/uiStore';
import { type TerritoryGeoConfig, type ClipBbox } from '../../data/territoryGeoMapping';
import {
  buildTerritoryGlobeGeometries,
  type PolygonData,
} from '../../utils/globeTerritoryGeometry';
import { galaxyExoWideHullCapResolution } from '../../utils/galaxyGlobeCapResolution';
import { buildGalaxyWorldTextureFromPolygons } from '../../utils/proceduralPlanet';
import { inferWorldId } from '@borderfall/shared';
import { deriveRegionalGlobeView, type GlobeViewConfig } from '../../utils/regionalGlobe';
import { isFogHidden } from '../../utils/fogVisibility';
import { getPlayerGlobeColor, getRegionCssColors } from '../../constants/accessibleColors';
import { useTerritoryGeoSources } from '../../hooks/useTerritoryGeoSources';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { subscribeUserPreferences } from '../../utils/userPreferences';
import {
  SPACE_AGE_WASTELANDS,
  wastelandColorRgb,
  wastelandColorRgba,
  wastelandGlyph,
} from '../../data/spaceAgeWastelands';
import {
  isMapStrikeAbility,
  STRIKE_MAP_STYLES,
  type MapStrikeAbilityId,
} from '../../utils/mapStrikeEffects';
import { hexToRgb, lerpRgb, MAP_VISUAL_DURATIONS, INFLUENCE_RING_RGB, INFLUENCE_BLOCKED_RGB, NAVAL_RING_RGB, EVENT_AMBER_RGB, EVENT_STABILITY_RGB, EVENT_TRUCE_RGB, ERA_ADVANCE_GOLD_RGB } from '../../utils/mapVisualStyles';
import { eventDurationMs, resolveEventVisualMode } from '../../utils/mapEventEffects';
import type { MapVisualEvent } from '../../utils/mapVisualEvents';
import {
  eraAdvanceCascadePhase,
  eraAdvanceDisplayName,
  eraAdvancePolygonRgba,
  sortTerritoryIdsByLatLng,
} from '../../utils/eraAdvanceVisualUtils';
import {
  shouldEmphasizeAdjacencyBorders,
  shouldRenderConnectionArcs,
  type ResolvedConnectionHintMode,
} from '../../utils/connectionHints';
import { computePhaseAdjacencyTargets } from '../../utils/mapAdjacencyTargets';
import { effectiveContinentBonus } from '../../utils/continentBonus';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Tiny altitude spread so coplanar caps do not z-fight at shared borders (react-globe extrusion). */
function polygonAltitudeHash(territoryId: string): number {
  let h = 2166136261;
  for (let i = 0; i < territoryId.length; i++) {
    h = Math.imul(h ^ territoryId.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 4096) / 4096;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GlobeEvent {
  id: string;
  type: 'reinforce' | 'combat' | 'fortify' | 'strike' | 'capture' | 'naval' | 'influence' | 'event' | 'era_advance';
  kind?: 'reinforce' | 'combat' | 'fortify' | 'strike' | 'capture' | 'naval' | 'influence' | 'event' | 'era_advance';
  territoryId: string;
  fromTerritoryId?: string;
  units?: number;
  totalAfter?: number;
  attackerLosses?: number;
  defenderLosses?: number;
  captured?: boolean;
  playerColor?: string;
  attackerColor?: string;
  defenderColor?: string;
  newOwnerColor?: string;
  /** Tech strike ability — drives map-local globe animation variant */
  strikeAbilityId?: string;
  variant?: string;
  unitReduction?: number;
  affectedTerritories?: Array<{ territory_id: string; delta: number }>;
  regionId?: string;
  global?: boolean;
  cardId?: string;
}

interface MapTerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  globe_id?: 'earth' | 'moon';
  world_id?: string;
  galaxy_position?: [number, number];
  /** Galaxy Option A: per-territory diffuse / bump overrides on drill-down. */
  globe_image_url?: string;
  bump_image_url?: string;
  iso_codes?: string[];
  clip_bbox?: ClipBbox;
  geo_config?: TerritoryGeoConfig;
  geo_polygon?: [number, number][];
  geo_multipolygon?: [number, number][][];
}

interface GameMapData {
  map_id?: string;
  map_kind?: 'standard' | 'galaxy';
  worlds?: Array<{
    world_id: string;
    display_name: string;
    globe_image_url?: string;
    bump_image_url?: string;
    show_atmosphere?: boolean;
    atmosphere_color?: string;
    atmosphere_altitude?: number;
    background_color?: string;
    requires_orbit_access?: boolean;
  }>;
  canvas_width?: number;
  canvas_height?: number;
  /** Matches `projection_bounds` in map JSON — used for canvas→globe when geo_polygon missing */
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  /** Optional globe camera: used for regional / single-theater maps */
  globe_view?: GlobeViewConfig;
  territories: MapTerritory[];
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
  regions?: Array<{ region_id: string; name: string; bonus: number }>;
}

interface GlobeMapProps {
  mapData: GameMapData;
  onTerritoryClick: (territoryId: string) => void;
  width?: number;
  height?: number;
  events?: GlobeEvent[];
  onEventDone?: (eventId: string) => void;
  /** Lighter motion (mobile / accessibility): no idle globe spin resume after animations */
  reducedEffects?: boolean;
  /** User-controlled globe spin toggle. When false, globe does not auto-rotate. */
  autoSpin?: boolean;
  /**
   * User-controlled "Follow the action" toggle. When false, the camera never
   * auto-recenters on events. Even when true, the recenter yields to active
   * drag/zoom interaction (see shouldAutoFollow). Default true.
   */
  cameraFollow?: boolean;
  /**
   * Filled with a callback that flushes the globe's queued animations (the same
   * action as the on-globe "Skip animations" button). Lets the parent drain the
   * globe queue as part of a unified "skip everything" handler.
   */
  skipAnimationsRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * When provided, the on-globe "Skip animations" button calls this instead of
   * the local globe-only flush — so it can clear the parent's modal/theater
   * backlog too. Falls back to the local flush when omitted (replay/spectator).
   */
  onSkipAll?: () => void;
  /** If set, draw a pulsing gold ring on this territory (tutorial highlighting). */
  highlightTerritoryId?: string;
  /** Override globe surface texture (defaults to Earth blue marble). */
  globeImageUrl?: string;
  /** Override globe bump/topology texture. */
  bumpImageUrl?: string;
  /** Override atmosphere glow color. */
  atmosphereColor?: string;
  /** Override atmosphere altitude (0 disables visible halo). */
  atmosphereAltitude?: number;
  /** Override whether atmosphere is shown at all. */
  showAtmosphere?: boolean;
  /** Override globe canvas background color. */
  backgroundColor?: string;
  /** Filters territories by canonical world id (defaults to `earth`). */
  activeWorldId?: string;
  /** Ambient turn-holder glow and contested frontier arcs. */
  ambientEnabled?: boolean;
  turnHolderPlayerId?: string | null;
  /** The viewing player's id — frames their territories + pauses idle spin on their turn (WI2). */
  selfPlayerId?: string | null;
  /** When set, pulse every territory owned by this player (first-turn reinforcement coach, WI1). */
  coachHighlightOwnerId?: string | null;
  contestedBorders?: Array<{ fromId: string; toId: string; sea: boolean }>;
  /** How aggressively to render animated connection lines vs border highlights. */
  connectionHintMode?: ResolvedConnectionHintMode;
  /** Fires once when react-globe.gl has initialized and the globe is rendered. */
  onGlobeReady?: () => void;
  /** Lobby / map-hub preview: region-colored caps without live game state. */
  previewMode?: boolean;
}

/**
 * Discriminated union for everything we render through the globe's HTML
 * overlay layer.  We deliberately do NOT accept arbitrary HTML strings here:
 * any user-controlled string (territory / region names from custom maps)
 * goes through `textContent`, never through `innerHTML`, which closes the
 * stored-XSS vector that existed when this layer used `el.innerHTML = …`.
 *
 * If you need a new overlay shape, ADD a new variant rather than reaching
 * for an `html: string` escape hatch.
 */
type HtmlDatumBase = {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  /** Optional click-forward target — set on interactive markers (e.g. sea-route hubs). */
  onClickTerritoryId?: string;
};

type HtmlDatum =
  | (HtmlDatumBase & {
      kind: 'region-label';
      name: string;
      bonus: number;
      color: string;
    })
  | (HtmlDatumBase & {
      kind: 'building-icons';
      icons: string;
      tooltip: string;
    })
  | (HtmlDatumBase & {
      kind: 'capital-marker';
      color: string;
    })
  | (HtmlDatumBase & {
      kind: 'sea-route-marker';
      territoryName: string;
      color: string;
      size: number;
      glow: number;
    })
  | (HtmlDatumBase & {
      kind: 'animation-units-plus';
      text: string;
      color: string;
    })
  | (HtmlDatumBase & {
      kind: 'animation-units-total';
      text: string;
      color: string;
    })
  | (HtmlDatumBase & {
      kind: 'animation-explosion';
    })
  | (HtmlDatumBase & {
      kind: 'animation-loss-banner';
      text: string;
    })
  | (HtmlDatumBase & {
      kind: 'animation-captured';
    })
  | (HtmlDatumBase & {
      kind: 'animation-source-units';
      text: string;
    })
  | (HtmlDatumBase & {
      kind: 'animation-dest-units';
      text: string;
      color: string;
    })
  | (HtmlDatumBase & {
      kind: 'animation-strike-flash';
      emoji: string;
      glowRgb: string;
    })
  | (HtmlDatumBase & {
      kind: 'wasteland-zone';
      name: string;
      description: string;
      glyph: string;
      colorRgba: string;
    });

interface ArcDatum {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
  stroke: number;
  dashLen: number;
  dashGap: number;
  animateTime: number;
  altitude: number | null;
  /**
   * Optional territory to forward clicks to. Set on adjacency / combat arcs so
   * that arcs rendered over the globe do not "swallow" clicks that were
   * intended for a territory sitting underneath the arc geometry. Without
   * this, raycasting inside react-globe.gl can hit the arc tube before the
   * polygon cap and drop the click.
   */
  clickForwardTerritoryId?: string;
}

interface RingDatum {
  id: string;
  lat: number;
  lng: number;
  maxRadius: number;
  speed: number;
  repeatPeriod: number;
  colorFn: (t: number) => string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(46, 125, 158, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeCentroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lat: number; lng: number } {
  let sumLng = 0, sumLat = 0, count = 0;
  const allPolys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.coordinates;
  for (const poly of allPolys) {
    for (const ring of poly) {
      for (const coord of ring) {
        sumLng += coord[0];
        sumLat += coord[1];
        count++;
      }
    }
  }
  return count > 0 ? { lat: sumLat / count, lng: sumLng / count } : { lat: 0, lng: 0 };
}

function cameraViewForTwo(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { lat: number; lng: number; altitude: number } {
  const midLat = (a.lat + b.lat) / 2;
  let midLng: number;
  const dLng = Math.abs(a.lng - b.lng);
  if (dLng > 180) {
    midLng = ((a.lng + b.lng) / 2 + 180) % 360 - 180;
  } else {
    midLng = (a.lng + b.lng) / 2;
  }
  const angDist = Math.sqrt(
    Math.pow(a.lat - b.lat, 2) + Math.pow(dLng > 180 ? 360 - dLng : dLng, 2)
  );
  const altitude = Math.max(1.5, Math.min(3.0, 1.2 + angDist / 40));
  return { lat: midLat, lng: midLng, altitude };
}

let eventIdCounter = 0;
function uid(prefix: string): string {
  return `${prefix}-${++eventIdCounter}-${Date.now()}`;
}

/**
 * Construct the DOM node for an HTML overlay datum.  All user-facing strings
 * (region names, territory names) are written via `textContent` — never as
 * `innerHTML` — so a malicious custom-map name like
 *   `'<img src=x onerror=…>'`
 * renders as literal text instead of executing in the player's session.
 */
function buildHtmlOverlayElement(
  datum: HtmlDatum,
  onTerritoryClick: (territoryId: string) => void,
): HTMLElement {
  const el = document.createElement('div');

  switch (datum.kind) {
    case 'region-label': {
      el.style.cssText = [
        `color:${datum.color}`,
        'font-size:11px',
        'font-weight:700',
        'letter-spacing:0.04em',
        'text-shadow:0 1px 4px rgba(0,0,0,0.95),0 0 10px rgba(0,0,0,0.8)',
        'white-space:nowrap',
        'pointer-events:none',
        'user-select:none',
      ].join(';');
      el.appendChild(document.createTextNode(datum.name));
      el.appendChild(document.createTextNode('\u2002'));
      const bonusEl = document.createElement('span');
      bonusEl.style.cssText = 'color:#ffd700;opacity:0.9';
      bonusEl.textContent = `+${datum.bonus}`;
      el.appendChild(bonusEl);
      break;
    }

    case 'building-icons': {
      el.style.cssText =
        'font-size:11px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,0.9);pointer-events:none';
      el.title = datum.tooltip;
      el.textContent = datum.icons;
      break;
    }

    case 'capital-marker': {
      el.style.cssText = [
        'width:12px',
        'height:12px',
        'transform:rotate(45deg)',
        'border:2px solid #ffd700',
        `background:${datum.color}`,
        'box-shadow:0 0 6px rgba(0,0,0,0.85)',
        'pointer-events:none',
      ].join(';');
      el.title = 'Capital';
      break;
    }

    case 'sea-route-marker': {
      el.style.cssText = [
        `width:${datum.size}px`,
        `height:${datum.size}px`,
        'border-radius:999px',
        'border:2px solid rgba(255,255,255,0.92)',
        `background:${hexToRgba(datum.color, 0.95)}`,
        `box-shadow:0 0 ${datum.glow}px ${hexToRgba(datum.color, 0.7)}, 0 0 3px rgba(255,255,255,0.95)`,
        'cursor:pointer',
      ].join(';');
      el.title = datum.territoryName;
      break;
    }

    case 'animation-units-plus': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:900',
        'font-size:24px',
        `color:${datum.color}`,
        'white-space:nowrap',
        'text-align:center',
        `text-shadow:0 0 14px ${datum.color}, 0 2px 6px rgba(0,0,0,0.7)`,
        'animation:globeFloatUp 1.4s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.text;
      break;
    }

    case 'animation-units-total': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:700',
        'font-size:15px',
        'color:#fff',
        'white-space:nowrap',
        'text-align:center',
        'background:rgba(0,0,0,0.78)',
        'padding:3px 12px',
        'border-radius:6px',
        `border:1px solid ${datum.color}55`,
        'animation:globePulseIn 1.1s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.text;
      break;
    }

    case 'animation-explosion': {
      el.style.cssText = [
        'font-size:36px',
        'text-align:center',
        'text-shadow:0 0 24px rgba(255,150,50,0.9), 0 0 48px rgba(255,100,0,0.5)',
        'animation:globeExplosionPulse 0.9s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = '💥';
      break;
    }

    case 'animation-strike-flash': {
      el.style.cssText = [
        'font-size:42px',
        'text-align:center',
        `text-shadow:0 0 28px ${datum.glowRgb}, 0 0 56px ${datum.glowRgb}`,
        'animation:globeStrikeFlash 1.1s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.emoji;
      break;
    }

    case 'animation-loss-banner': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:900',
        'font-size:20px',
        'color:#f87171',
        'white-space:nowrap',
        'text-align:center',
        'text-shadow:0 0 10px rgba(248,113,113,0.7), 0 2px 4px rgba(0,0,0,0.6)',
        'animation:globeFadeInUp 1.4s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.text;
      break;
    }

    case 'animation-captured': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:900',
        'font-size:16px',
        'color:#4ade80',
        'white-space:nowrap',
        'text-align:center',
        'text-shadow:0 0 16px rgba(74,222,128,0.8)',
        'animation:globeCaptured 1.6s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = '⚑ CAPTURED!';
      break;
    }

    case 'animation-source-units': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:900',
        'font-size:20px',
        'color:#fbbf24',
        'white-space:nowrap',
        'text-align:center',
        'text-shadow:0 0 10px rgba(251,191,36,0.6), 0 2px 4px rgba(0,0,0,0.6)',
        'animation:globeArrowPulse 1.4s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.text;
      break;
    }

    case 'animation-dest-units': {
      el.style.cssText = [
        "font-family:'Courier New', monospace",
        'font-weight:900',
        'font-size:20px',
        `color:${datum.color}`,
        'white-space:nowrap',
        'text-align:center',
        `text-shadow:0 0 10px ${datum.color}99, 0 2px 4px rgba(0,0,0,0.6)`,
        'animation:globeArrowPulse 1.4s ease-out forwards',
        'pointer-events:none',
      ].join(';');
      el.textContent = datum.text;
      break;
    }

    case 'wasteland-zone': {
      // Small ambient crater glyph — no visible label, full name + flavor
      // text appear on hover via the native title tooltip. The territories
      // around it carry the gameplay; this is just world-building.
      el.style.cssText = [
        'width:20px',
        'height:20px',
        'border-radius:999px',
        `background:radial-gradient(circle, ${datum.colorRgba} 0%, ${datum.colorRgba.replace(/[\d.]+\)$/, '0.25)')} 60%, rgba(0,0,0,0) 100%)`,
        `border:1px solid ${datum.colorRgba}`,
        `box-shadow:0 0 10px ${datum.colorRgba}, inset 0 0 4px rgba(0,0,0,0.5)`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'color:rgba(255,255,255,0.95)',
        'font-size:11px',
        'font-weight:700',
        'text-shadow:0 0 3px rgba(0,0,0,0.9)',
        'animation:globeWastelandPulse 3.6s ease-in-out infinite',
        'pointer-events:auto',
        'cursor:help',
        'user-select:none',
      ].join(';');
      el.title = `${datum.name} — ${datum.description}`;
      el.textContent = datum.glyph;
      break;
    }
  }

  if (datum.onClickTerritoryId) {
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.onclick = (event) => {
      event.stopPropagation();
      onTerritoryClick(datum.onClickTerritoryId!);
    };
  } else if (!el.style.pointerEvents) {
    el.style.pointerEvents = 'none';
  }

  return el;
}

// ── Animation Keyframes (injected as <style>) ─────────────────────────────────

const ANIMATION_STYLES = `
@keyframes globeFloatUp {
  0%   { transform: translateY(0) scale(0.3); opacity: 0; }
  15%  { transform: translateY(-6px) scale(1.15); opacity: 1; }
  60%  { transform: translateY(-22px) scale(1); opacity: 0.95; }
  100% { transform: translateY(-38px) scale(0.9); opacity: 0; }
}
@keyframes globePulseIn {
  0%   { transform: scale(0.4); opacity: 0; }
  25%  { transform: scale(1.08); opacity: 1; }
  65%  { transform: scale(1); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0; }
}
@keyframes globeExplosionPulse {
  0%   { transform: scale(0.3); opacity: 1; filter: brightness(2); }
  40%  { transform: scale(1.6); opacity: 0.7; filter: brightness(1.4); }
  100% { transform: scale(2.2); opacity: 0; filter: brightness(1); }
}
@keyframes globeFadeInUp {
  0%   { transform: translateY(8px); opacity: 0; }
  20%  { transform: translateY(0); opacity: 1; }
  75%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes globeArrowPulse {
  0%   { transform: translateY(4px) scale(0.8); opacity: 0; }
  20%  { transform: translateY(0) scale(1.05); opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes globeCaptured {
  0%   { transform: scale(0.5); opacity: 0; text-shadow: 0 0 0 transparent; }
  30%  { transform: scale(1.2); opacity: 1; text-shadow: 0 0 20px rgba(74,222,128,0.8); }
  60%  { transform: scale(1); opacity: 1; text-shadow: 0 0 12px rgba(74,222,128,0.5); }
  100% { transform: scale(0.95); opacity: 0; text-shadow: 0 0 0 transparent; }
}
@keyframes globeWastelandPulse {
  0%, 100% { opacity: 0.75; transform: scale(0.94); }
  50%      { opacity: 1;    transform: scale(1.06); }
}
@keyframes globeStrikeFlash {
  0%   { transform: scale(0.4); opacity: 0; filter: brightness(2); }
  25%  { transform: scale(1.35); opacity: 1; filter: brightness(1.6); }
  70%  { transform: scale(1.1); opacity: 0.95; filter: brightness(1.2); }
  100% { transform: scale(0.9); opacity: 0; filter: brightness(1); }
}
`;

// ── Component ──────────────────────────────────────────────────────────────────

function GlobeMap({
  mapData,
  onTerritoryClick,
  width = 900,
  height = 600,
  events = [],
  onEventDone,
  reducedEffects = false,
  autoSpin = true,
  cameraFollow = true,
  skipAnimationsRef,
  onSkipAll,
  highlightTerritoryId,
  globeImageUrl = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.1/example/img/earth-blue-marble.jpg',
  bumpImageUrl = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.1/example/img/earth-topology.png',
  atmosphereColor = 'lightskyblue',
  atmosphereAltitude = 0.15,
  showAtmosphere = true,
  backgroundColor = 'rgba(10, 14, 26, 1)',
  activeWorldId = 'earth',
  ambientEnabled = false,
  turnHolderPlayerId,
  selfPlayerId = null,
  coachHighlightOwnerId = null,
  contestedBorders = [],
  connectionHintMode = 'full',
  onGlobeReady,
  previewMode = false,
}: GlobeMapProps) {
  const isFloodedNorthAmerica =
    mapData.map_id === 'community_flooded_north_america' ||
    mapData.territories.some((t) => t.territory_id === 'rainier_islands');
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { gameState } = useGameStore();
  const { selectedTerritory, attackSource } = useUiStore();
  const [, setPrefsRevision] = useState(0);
  useEffect(() => subscribeUserPreferences(() => setPrefsRevision((n) => n + 1)), []);
  // GeoJSON sources load through the shared module-cached loader, so the 2D
  // map and the globe download each Natural Earth file once per session and
  // the per-map trigger conditions live in exactly one place
  // (useTerritoryGeoSources). Null until every required source resolves.
  const geoSources = useTerritoryGeoSources(mapData);
  const countriesGeo = geoSources?.countriesGeo ?? null;
  const statesGeo = geoSources?.statesGeo ?? null;
  const risorgimentoGeo = geoSources?.risorgimentoGeo ?? null;
  const regionalAdmin1Geo = geoSources?.regionalAdmin1Geo ?? null;
  const admin50Geo = geoSources?.admin50Geo ?? null;
  const straitHormuzGeo = geoSources?.straitHormuzGeo ?? null;
  const australiaGeo = geoSources?.australiaGeo ?? null;
  const britainGeo = geoSources?.britainGeo ?? null;
  const hornAfricaGeo = geoSources?.hornAfricaGeo ?? null;
  const mexicoGeo = geoSources?.mexicoGeo ?? null;
  /** Bumps when react-globe.gl calls onGlobeReady so we can apply camera after the ref exists */
  const [globeReadyTick, setGlobeReadyTick] = useState(0);

  // Animation layer state
  const [overlays, setOverlays] = useState<HtmlDatum[]>([]);
  const [arcs, setArcs] = useState<ArcDatum[]>([]);
  const [rings, setRings] = useState<RingDatum[]>([]);
  /** Brief territory polygon tint during strike abilities */
  const [polygonStrikeFlash, setPolygonStrikeFlash] = useState<{
    territoryId: string;
    abilityId: MapStrikeAbilityId;
    phase: number;
  } | null>(null);
  /** Ownership color wash after territory capture */
  const [polygonCaptureFlash, setPolygonCaptureFlash] = useState<{
    territoryId: string;
    phase: number;
    fromRgb: [number, number, number];
    toRgb: [number, number, number];
  } | null>(null);
  /** Gold cascade wash across all owned territories during era advance */
  const [polygonEraAdvanceFlash, setPolygonEraAdvanceFlash] = useState<{
    phases: Map<string, number>;
    playerRgb: [number, number, number];
  } | null>(null);
  const polygonFlashTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const polygonCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const polygonEraAdvanceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Event queue refs
  const eventQueueRef = useRef<GlobeEvent[]>([]);
  const seenEventIdsRef = useRef(new Set<string>());
  const isAnimatingRef = useRef(false);
  const currentEventIdRef = useRef<string | null>(null);
  const autoRotateTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const cleanupTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // True while it's the viewing player's turn — pauses idle auto-spin so their
  // territories don't drift off-screen while deciding (WI2). Honored at every
  // site that (re-)enables autoRotate.
  const spinSuppressedRef = useRef(false);

  /** Drives visibility of the "Skip animations" control (refs → React state). */
  const [animationUi, setAnimationUi] = useState({ playing: false, backlog: 0 });
  const flushAnimationUi = useCallback(() => {
    setAnimationUi({
      playing: isAnimatingRef.current,
      backlog: eventQueueRef.current.length,
    });
  }, []);

  // ── Polygon data (territories) ─────────────────────────────────────────

  const polygonsData = useMemo(
    (): PolygonData[] =>
      // NOTE: keep every key of GlobeGeometryInputs here — dropping one (e.g.
      // regionalAdmin1Geo) silently downgrades affected maps to the blocky
      // geo_polygon fallback on the globe while the 2D map still looks correct.
      buildTerritoryGlobeGeometries(mapData, {
        countriesGeo,
        statesGeo,
        risorgimentoGeo,
        regionalAdmin1Geo,
        admin50Geo,
        straitHormuzGeo,
        australiaGeo,
        britainGeo,
        hornAfricaGeo,
        mexicoGeo,
      }),
    [mapData, countriesGeo, statesGeo, risorgimentoGeo, regionalAdmin1Geo, admin50Geo, straitHormuzGeo, australiaGeo, britainGeo, hornAfricaGeo, mexicoGeo],
  );

  const renderedPolygonsData = useMemo(
    () => polygonsData.filter((p) => {
      const territory = mapData.territories.find((t) => t.territory_id === p.territory_id);
      if (!territory) return false;
      if (territory.region_id === 'sea_routes') return false;
      return inferWorldId(territory) === activeWorldId;
    }),
    [polygonsData, mapData.territories, activeWorldId],
  );

  /**
   * Galaxy worlds: paint the procedural surface so terrain lines up with the
   * actual territory polygons (land under territories, ocean/void between).
   * Falls back to the plain noise texture from `globeImageUrl` when the geometry
   * isn't ready (Sol before Natural Earth loads) or no canvas is available.
   */
  const galaxyPolygonTexture = useMemo(
    () =>
      mapData.map_kind === 'galaxy'
        ? buildGalaxyWorldTextureFromPolygons(activeWorldId, renderedPolygonsData)
        : undefined,
    [mapData.map_kind, activeWorldId, renderedPolygonsData],
  );

  const territoryById = useMemo(() => {
    const m = new Map<string, MapTerritory>();
    for (const t of mapData.territories) m.set(t.territory_id, t);
    return m;
  }, [mapData.territories]);

  // ── Territory center lookup ────────────────────────────────────────────

  const territoryCenters = useMemo(() => {
    const centers = new Map<string, { lat: number; lng: number }>();
    for (const p of polygonsData) {
      centers.set(p.territory_id, computeCentroid(p.geometry));
    }
    return centers;
  }, [polygonsData]);

  const territoryCentersRef = useRef(territoryCenters);
  territoryCentersRef.current = territoryCenters;

  const startPolygonStrikeFlash = useCallback((territoryId: string, abilityId: MapStrikeAbilityId) => {
    const style = STRIKE_MAP_STYLES[abilityId];
    if (polygonFlashTimerRef.current) clearInterval(polygonFlashTimerRef.current);
    const started = Date.now();
    setPolygonStrikeFlash({ territoryId, abilityId, phase: 0 });
    polygonFlashTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= style.mapFlashMs) {
        if (polygonFlashTimerRef.current) clearInterval(polygonFlashTimerRef.current);
        polygonFlashTimerRef.current = null;
        setPolygonStrikeFlash(null);
        return;
      }
      setPolygonStrikeFlash({
        territoryId,
        abilityId,
        phase: 0.45 + 0.55 * Math.abs(Math.sin(elapsed * 0.014)),
      });
    }, 48);
  }, []);

  const startPolygonEraAdvanceCascade = useCallback((
    sortedIds: string[],
    playerRgb: [number, number, number],
    duration: number,
  ) => {
    if (polygonEraAdvanceTimerRef.current) clearInterval(polygonEraAdvanceTimerRef.current);
    const started = Date.now();
    const total = sortedIds.length;
    polygonEraAdvanceTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= duration) {
        if (polygonEraAdvanceTimerRef.current) clearInterval(polygonEraAdvanceTimerRef.current);
        polygonEraAdvanceTimerRef.current = null;
        setPolygonEraAdvanceFlash(null);
        return;
      }
      const phases = new Map<string, number>();
      for (let i = 0; i < sortedIds.length; i++) {
        phases.set(sortedIds[i]!, eraAdvanceCascadePhase(elapsed, i, total, duration));
      }
      setPolygonEraAdvanceFlash({ phases, playerRgb });
    }, 48);
  }, []);

  const startPolygonCaptureFlash = useCallback((
    territoryId: string,
    fromColor?: string,
    toColor?: string,
  ) => {
    if (polygonCaptureTimerRef.current) clearInterval(polygonCaptureTimerRef.current);
    const fromRgb = hexToRgb(fromColor ?? '#888888');
    const toRgb = hexToRgb(toColor ?? '#ffffff');
    const started = Date.now();
    setPolygonCaptureFlash({ territoryId, phase: 0, fromRgb, toRgb });
    polygonCaptureTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= MAP_VISUAL_DURATIONS.captureFlash) {
        if (polygonCaptureTimerRef.current) clearInterval(polygonCaptureTimerRef.current);
        polygonCaptureTimerRef.current = null;
        setPolygonCaptureFlash(null);
        return;
      }
      setPolygonCaptureFlash({
        territoryId,
        phase: elapsed / MAP_VISUAL_DURATIONS.captureFlash,
        fromRgb,
        toRgb,
      });
    }, 48);
  }, []);

  /**
   * Camera framing must follow the active world on galaxy / multi-world maps —
   * deriving from `territoryCenters` directly would average the bbox across all
   * worlds (e.g. Sol's North America + Verdan's Indonesia + Nexus' North Atlantic),
   * leaving the focused world off-center. Filter to the active world's polygons
   * so each drill-down lands on a world-local frame.
   */
  const activeWorldCenters = useMemo(() => {
    const centers = new Map<string, { lat: number; lng: number }>();
    for (const p of polygonsData) {
      const territory = territoryById.get(p.territory_id);
      if (!territory) continue;
      if (inferWorldId(territory) !== activeWorldId) continue;
      centers.set(p.territory_id, computeCentroid(p.geometry));
    }
    // Fallback to all centers when the active world filter excludes everything
    // (e.g. mis-typed world id in the props) so the globe never shows an empty
    // bounding box.
    return centers.size > 0 ? centers : territoryCenters;
  }, [polygonsData, territoryById, activeWorldId, territoryCenters]);

  const regionalGlobe = useMemo(
    () => deriveRegionalGlobeView(mapData.globe_view, activeWorldCenters),
    [mapData.globe_view, activeWorldCenters],
  );
  /**
   * Regional / authored-bounds maps: every extruded polygon uses cap + side materials.
   * Semi-transparent sides (default in three-globe) overlap thousands of faces from neighbors
   * and sort unpredictably — same RGB “shard” noise as transparent caps. Opaque cap + side fixes it.
   *
   * Galactic Age (`map_kind === 'galaxy'`) must stay on this opaque path too: semi-transparent
   * territory caps reintroduced whole-globe “color spill” (same class of bug as Space Age before
   * we forced solid fills on authored `projection_bounds` maps).
   */
  const useSolidPlayerCaps =
    regionalGlobe.lockRotation === true || mapData.projection_bounds != null;
  const regionalGlobeRef = useRef(regionalGlobe);
  regionalGlobeRef.current = regionalGlobe;

  // Mirror the cameraFollow prop into a ref so the per-animation guard
  // (shouldAutoFollow) can read the latest value without becoming a dependency
  // of every animation useCallback.
  const cameraFollowPropRef = useRef(cameraFollow);
  cameraFollowPropRef.current = cameraFollow;
  // True while the user is actively driving the camera (drag / wheel / pinch),
  // plus a short cooldown after they let go — so a queued animation never yanks
  // the view out from under them.
  const userInteractingRef = useRef(false);
  const lastInteractionAtRef = useRef(0);

  /** Galaxy drill-down: prefer each world's authored void color (parent may already pass it). */
  const effectiveBackgroundColor = useMemo(() => {
    if (mapData.map_kind !== 'galaxy' || !mapData.worlds?.length) return backgroundColor;
    const w = mapData.worlds.find((x) => x.world_id === activeWorldId);
    return w?.background_color ?? backgroundColor;
  }, [mapData.map_kind, mapData.worlds, activeWorldId, backgroundColor]);

  // ── Animation helpers ──────────────────────────────────────────────────

  const addOverlay = useCallback((item: HtmlDatum) => {
    setOverlays(prev => [...prev, item]);
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  const addArc = useCallback((item: ArcDatum) => {
    setArcs(prev => [...prev, item]);
  }, []);

  const removeArc = useCallback((id: string) => {
    setArcs(prev => prev.filter(a => a.id !== id));
  }, []);

  const addRings = useCallback((item: RingDatum) => {
    setRings(prev => [...prev, item]);
  }, []);

  const removeRings = useCallback((id: string) => {
    setRings(prev => prev.filter(r => r.id !== id));
  }, []);

  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    cleanupTimersRef.current.push(t);
    return t;
  }, []);

  const panCamera = useCallback((lat: number, lng: number, altitude: number, ms = 800) => {
    globeRef.current?.pointOfView({ lat, lng, altitude }, ms);
  }, []);

  const pauseAutoRotate = useCallback(() => {
    clearTimeout(autoRotateTimerRef.current);
    const ctrl = globeRef.current?.controls?.();
    if (ctrl) ctrl.autoRotate = false;
  }, []);

  const scheduleAutoRotateResume = useCallback(() => {
    if (reducedEffects || regionalGlobeRef.current.lockRotation || !autoSpin || spinSuppressedRef.current) return;
    clearTimeout(autoRotateTimerRef.current);
    autoRotateTimerRef.current = setTimeout(() => {
      const ctrl = globeRef.current?.controls?.();
      if (ctrl && !regionalGlobeRef.current.lockRotation && autoSpin && !spinSuppressedRef.current) {
        ctrl.autoRotate = true;
        ctrl.autoRotateSpeed = 0.4;
      }
    }, 2500);
  }, [reducedEffects, autoSpin]);

  // How long after the user stops dragging/zooming before auto-follow may move
  // the camera again. Matches the auto-rotate resume delay so the globe settles
  // before either kicks back in.
  const FOLLOW_INTERACTION_COOLDOWN_MS = 2500;

  /**
   * Whether a queued animation is allowed to recenter the camera right now.
   * Replaces the bare `!lockRotation` guard at every animation site so the new
   * rules live in one place:
   *  - regional/locked maps never pan (unchanged behavior),
   *  - the "Follow the action" preference can fully disable it,
   *  - and it always yields while the user is interacting or just did.
   */
  const shouldAutoFollow = useCallback(() => {
    if (regionalGlobeRef.current.lockRotation) return false;
    if (!cameraFollowPropRef.current) return false;
    if (userInteractingRef.current) return false;
    if (Date.now() - lastInteractionAtRef.current < FOLLOW_INTERACTION_COOLDOWN_MS) return false;
    return true;
  }, []);

  // Track active camera interaction via OrbitControls' own start/end events
  // (fired for mouse drag, wheel zoom, and touch pinch). This is the library-
  // native "the user is driving the camera" signal — distinct from the wrapper
  // pointer handlers below, which only disambiguate tap-vs-drag for clicks.
  useEffect(() => {
    const ctrl = globeRef.current?.controls?.();
    if (!ctrl?.addEventListener) return;
    const onStart = () => {
      userInteractingRef.current = true;
      pauseAutoRotate();
    };
    const onEnd = () => {
      userInteractingRef.current = false;
      lastInteractionAtRef.current = Date.now();
      scheduleAutoRotateResume();
    };
    ctrl.addEventListener('start', onStart);
    ctrl.addEventListener('end', onEnd);
    return () => {
      ctrl.removeEventListener('start', onStart);
      ctrl.removeEventListener('end', onEnd);
    };
  }, [globeReadyTick, pauseAutoRotate, scheduleAutoRotateResume]);

  // Regional maps: fixed camera, no idle spin; world maps: rotate when not in combat anim
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const ctrl = globe.controls?.();
    if (!ctrl) return;

    const lock = regionalGlobe.lockRotation || reducedEffects || !autoSpin || spinSuppressedRef.current;
    ctrl.autoRotate = !lock;
    ctrl.autoRotateSpeed = lock ? 0 : 0.4;

    globe.pointOfView(
      {
        lat: regionalGlobe.centerLat,
        lng: regionalGlobe.centerLng,
        altitude: regionalGlobe.altitude,
      },
      0,
    );
  }, [regionalGlobe, reducedEffects, autoSpin, globeReadyTick]);

  // WI2 — pause idle auto-spin while it's the viewing player's turn (so their
  // territories don't drift off-screen), and resume the gentle spin on others'
  // turns. Routes through spinSuppressedRef so the base effect + resume scheduler
  // both honor it.
  useEffect(() => {
    const isViewerTurn =
      !!selfPlayerId &&
      gameState?.players?.[gameState.current_player_index]?.player_id === selfPlayerId;
    spinSuppressedRef.current = isViewerTurn;
    const ctrl = globeRef.current?.controls?.();
    if (!ctrl) return;
    if (isViewerTurn) {
      clearTimeout(autoRotateTimerRef.current);
      ctrl.autoRotate = false;
    } else if (!(regionalGlobeRef.current.lockRotation || reducedEffects || !autoSpin)) {
      ctrl.autoRotate = true;
      ctrl.autoRotateSpeed = 0.4;
    }
  }, [gameState?.current_player_index, gameState?.players, selfPlayerId, autoSpin, reducedEffects, globeReadyTick]);

  // WI2 — frame the viewing player's owned territories at the start of their
  // turn/phase so they're centered and on-screen. Reuses panCamera +
  // cameraViewForTwo + the territory-centroid cache. Fires once per
  // (player_index, phase); yields to active interaction and the "Follow the
  // action" preference via shouldAutoFollow().
  const lastFramedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState || !selfPlayerId) return;
    if (regionalGlobeRef.current.lockRotation) return;
    const isViewerTurn =
      gameState.players?.[gameState.current_player_index]?.player_id === selfPlayerId;
    if (!isViewerTurn) return;
    const key = `${gameState.current_player_index}:${gameState.phase}`;
    if (lastFramedKeyRef.current === key) return;
    if (!shouldAutoFollow()) return;
    lastFramedKeyRef.current = key;
    const owned: { lat: number; lng: number }[] = [];
    for (const [tid, t] of Object.entries(gameState.territories)) {
      if (t.owner_id !== selfPlayerId) continue;
      const c = territoryCentersRef.current.get(tid);
      if (c) owned.push(c);
    }
    if (owned.length === 0) return;
    const lats = owned.map((c) => c.lat);
    const lngs = owned.map((c) => c.lng);
    const view = cameraViewForTwo(
      { lat: Math.min(...lats), lng: Math.min(...lngs) },
      { lat: Math.max(...lats), lng: Math.max(...lngs) },
    );
    panCamera(view.lat, view.lng, view.altitude, 1200);
  }, [gameState, selfPlayerId, shouldAutoFollow, panCamera]);

  /**
   * three-conic-polygon-geometry uses this as max segment length (degrees) before interpolating ring
   * vertices, and skips interior grid points only when min(lng span, lat span) < this value.
   * At the default 5°, large authored quads (14 Nations) get planar Delaunay + sphere lift → shard noise.
   * Natural Earth regional maps need ~5° for smooth coastlines. Most regional maps with
   * `projection_bounds` ship small WGS84 quads (a few degrees per side) → 360° keeps the authored ring
   * and earcuts it (no interior grid).
   *
   * Space Age and Galactic Age are exceptions: their authored quads span 50°–170° of arc per side.
   * Without subdivision the flat earcut lifted to the sphere dips far below the surface and only the
   * strokes show. Force 5° subdivision for those maps and for any moon-view render so caps actually
   * hug the sphere.
   *
   * Galactic exo Voronoi: some worlds’ hulls exceed 180° planar lng — interior lattice + Turf PIP
   * punches holes (`galaxyExoWideHullCapResolution`).
   */
  const getPolygonCapCurvatureResolution = useCallback(
    (polygon: object) => {
      if (activeWorldId === 'moon') return 5;
      if (mapData.map_id === 'era_space_age') return 5;
      if (mapData.map_kind === 'galaxy') {
        if (activeWorldId !== 'sol') {
          const wide = galaxyExoWideHullCapResolution((polygon as PolygonData).geometry);
          if (wide != null) return wide;
        }
        return 5;
      }
      return mapData.projection_bounds != null ? 360 : 5;
    },
    [activeWorldId, mapData.map_id, mapData.map_kind, mapData.projection_bounds],
  );

  /** Keep WebGL backing store in sync when the game resizes the map pane (devtools, sidebar, etc.). */
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || width <= 0 || height <= 0) return;
    globe.renderer().setSize(width, height);
  }, [width, height, globeReadyTick]);

  const getPolygonAltitude = useCallback(
    (polygon: object) => {
      const id = (polygon as PolygonData).territory_id;
      const authoredRegional = mapData.projection_bounds != null;
      if (isFloodedNorthAmerica) {
        const base = 0.022;
        const jitter = polygonAltitudeHash(id) * 0.001;
        return base + jitter;
      }
      // Moon-view caps need a slightly higher base than other authored
      // regionals: the lunar texture is contrasty (light highlands, very dark
      // mare) and authored moon rings are very wide (~150° lng), so even with
      // 5° curvature subdivision a thin cap sits visually flush with the
      // surface and reads as outline-only. 0.014 puts the cap clearly above.
      if (activeWorldId === 'moon') {
        const base = 0.014;
        const jitter = polygonAltitudeHash(id) * 0.002;
        return base + jitter;
      }
      // Galaxy worlds (Mars / Io / Callisto / Earth-as-Sol III) ship the same
      // wide authored quads as Space Age moon rings; they need the higher
      // moon-style base so caps don't z-fight with the contrasty planet
      // texture. Without this they read as outline-only on Mars + Io.
      if (mapData.map_kind === 'galaxy') {
        // Exo worlds use Voronoi meshes + procedural skins with strong bump/normal contrast;
        // Sol III uses smoother Earth imagery — keep Sol slightly lower so caps stay snug on NE coastlines.
        const base = activeWorldId === 'sol' ? 0.02 : 0.032;
        const jitter = polygonAltitudeHash(id) * 0.0008;
        return base + jitter;
      }
      const base = authoredRegional
        ? 0.0075
        : regionalGlobe.lockRotation
          ? 0.0045
          : 0.008;
      const jitter =
        regionalGlobe.lockRotation || authoredRegional ? polygonAltitudeHash(id) * 0.0015 : 0;
      return base + jitter;
    },
    [regionalGlobe.lockRotation, mapData.map_kind, mapData.projection_bounds, isFloodedNorthAmerica, activeWorldId],
  );

  // ── Animation sequences ────────────────────────────────────────────────

  const playNextRef = useRef<() => void>(() => {});

  const animateReinforce = useCallback((event: GlobeEvent) => {
    const center = territoryCentersRef.current.get(event.territoryId);
    if (!center) { playNextRef.current(); return; }

    pauseAutoRotate();
    if (shouldAutoFollow()) {
      panCamera(center.lat, center.lng, 1.5);
    }

    const color = event.playerColor ?? '#4ade80';
    const plusId = uid('reinforce-plus');
    const totalId = uid('reinforce-total');

    // Phase 1: "+N" floating up
    scheduleTimer(() => {
      addOverlay({
        kind: 'animation-units-plus',
        id: plusId,
        lat: center.lat,
        lng: center.lng,
        alt: 0.04,
        text: `+${event.units ?? 1}`,
        color,
      });
    }, 800);

    // Phase 2: "Total: X"
    scheduleTimer(() => {
      removeOverlay(plusId);
      addOverlay({
        kind: 'animation-units-total',
        id: totalId,
        lat: center.lat,
        lng: center.lng,
        alt: 0.04,
        text: `Total: ${event.totalAfter ?? '?'}`,
        color,
      });
    }, 2000);

    // Cleanup
    scheduleTimer(() => {
      removeOverlay(totalId);
      playNextRef.current();
    }, 3200);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay]);

  const animateCombat = useCallback((event: GlobeEvent) => {
    const targetCenter = territoryCentersRef.current.get(event.territoryId);
    const sourceCenter = event.fromTerritoryId
      ? territoryCentersRef.current.get(event.fromTerritoryId)
      : null;
    if (!targetCenter) { playNextRef.current(); return; }

    pauseAutoRotate();

    // World maps: frame the action. Regional (locked) maps: keep the user’s camera.
    if (shouldAutoFollow()) {
      if (sourceCenter) {
        const view = cameraViewForTwo(sourceCenter, targetCenter);
        panCamera(view.lat, view.lng, view.altitude);
      } else {
        panCamera(targetCenter.lat, targetCenter.lng, 1.8);
      }
    }

    const atkColor = event.attackerColor ?? '#ef4444';
    const arcId = uid('combat-arc');
    const ringId = uid('combat-ring');
    const explosionId = uid('combat-explosion');
    const atkLossId = uid('combat-atk-loss');
    const defLossId = uid('combat-def-loss');
    const capturedId = uid('combat-captured');

    // Phase 1: Attack arc
    if (sourceCenter) {
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: [atkColor, '#ff6b35'],
          stroke: 2.5,
          dashLen: 0.4,
          dashGap: 0.15,
          animateTime: 500,
          altitude: null,
          clickForwardTerritoryId: event.territoryId,
        });
      }, 600);
    }

    // Phase 2: Explosion rings at target
    scheduleTimer(() => {
      addRings({
        id: ringId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        maxRadius: 4,
        speed: 4,
        repeatPeriod: 350,
        colorFn: (t: number) => `rgba(255, 120, 50, ${Math.pow(1 - t, 1.5)})`,
      });
    }, 900);

    // Phase 3: Explosion emoji
    scheduleTimer(() => {
      addOverlay({
        kind: 'animation-explosion',
        id: explosionId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        alt: 0.06,
      });
    }, 1100);

    // Phase 4: Loss labels
    scheduleTimer(() => {
      removeOverlay(explosionId);
      removeRings(ringId);

      if (sourceCenter && (event.attackerLosses ?? 0) > 0) {
        addOverlay({
          kind: 'animation-loss-banner',
          id: atkLossId,
          lat: sourceCenter.lat,
          lng: sourceCenter.lng,
          alt: 0.04,
          text: `-${event.attackerLosses} ⚔️`,
        });
      }

      const defLoss = event.defenderLosses ?? 0;
      if (defLoss > 0) {
        addOverlay({
          kind: 'animation-loss-banner',
          id: defLossId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.04,
          text: `-${defLoss} 🛡️`,
        });
      }
    }, 1800);

    // Phase 5: Captured banner (if applicable)
    if (event.captured) {
      scheduleTimer(() => {
        startPolygonCaptureFlash(
          event.territoryId,
          event.defenderColor,
          event.newOwnerColor ?? event.attackerColor,
        );
        addOverlay({
          kind: 'animation-captured',
          id: capturedId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.07,
        });
      }, 2200);
    }

    // Cleanup
    const totalDuration = event.captured ? 3800 : 3300;
    scheduleTimer(() => {
      removeArc(arcId);
      removeRings(ringId);
      removeOverlay(explosionId);
      removeOverlay(atkLossId);
      removeOverlay(defLossId);
      removeOverlay(capturedId);
      playNextRef.current();
    }, totalDuration);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addArc, removeArc, addRings, removeRings, startPolygonCaptureFlash]);

  const animateFortify = useCallback((event: GlobeEvent) => {
    const destCenter = territoryCentersRef.current.get(event.territoryId);
    const srcCenter = event.fromTerritoryId
      ? territoryCentersRef.current.get(event.fromTerritoryId)
      : null;
    if (!destCenter) { playNextRef.current(); return; }

    pauseAutoRotate();

    if (shouldAutoFollow()) {
      if (srcCenter) {
        const view = cameraViewForTwo(srcCenter, destCenter);
        panCamera(view.lat, view.lng, view.altitude);
      } else {
        panCamera(destCenter.lat, destCenter.lng, 1.5);
      }
    }

    const color = event.playerColor ?? '#38bdf8';
    const arcId = uid('fortify-arc');
    const srcLabelId = uid('fortify-src');
    const dstLabelId = uid('fortify-dst');

    // Phase 1: Movement arc
    if (srcCenter) {
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: srcCenter.lat,
          startLng: srcCenter.lng,
          endLat: destCenter.lat,
          endLng: destCenter.lng,
          color: ['#38bdf8', '#06b6d4'],
          stroke: 2,
          dashLen: 0.3,
          dashGap: 0.2,
          animateTime: 800,
          altitude: null,
        });
      }, 600);
    }

    // Phase 2: Unit count overlays
    scheduleTimer(() => {
      if (srcCenter) {
        addOverlay({
          kind: 'animation-source-units',
          id: srcLabelId,
          lat: srcCenter.lat,
          lng: srcCenter.lng,
          alt: 0.04,
          text: `-${event.units ?? 0} →`,
        });
      }
      addOverlay({
        kind: 'animation-dest-units',
        id: dstLabelId,
        lat: destCenter.lat,
        lng: destCenter.lng,
        alt: 0.04,
        text: `+${event.units ?? 0}`,
        color,
      });
    }, 800);

    // Cleanup
    scheduleTimer(() => {
      removeArc(arcId);
      removeOverlay(srcLabelId);
      removeOverlay(dstLabelId);
      playNextRef.current();
    }, 2600);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addArc, removeArc]);

  const animateStrike = useCallback((event: GlobeEvent) => {
    const abilityRaw = event.strikeAbilityId ?? event.variant ?? 'nuclear_strike';
    if (!isMapStrikeAbility(abilityRaw)) {
      playNextRef.current();
      return;
    }
    const abilityId = abilityRaw;
    const style = STRIKE_MAP_STYLES[abilityId];
    const targetCenter = territoryCentersRef.current.get(event.territoryId);
    if (!targetCenter) {
      playNextRef.current();
      return;
    }

    pauseAutoRotate();
    if (shouldAutoFollow()) {
      panCamera(targetCenter.lat, targetCenter.lng, abilityId === 'atom_bomb' ? 2.0 : 1.7);
    }
    startPolygonStrikeFlash(event.territoryId, abilityId);

    const ringId = uid('strike-ring');
    const ring2Id = uid('strike-ring2');
    const flashId = uid('strike-flash');
    const lossId = uid('strike-loss');
    const explosionId = abilityId === 'atom_bomb' ? uid('strike-explosion') : null;
    const arcIds: string[] = [];
    const glowRgb = `rgba(${style.ringRgb.join(',')}, 0.85)`;
    const lossUnits = abilityId === 'atom_bomb'
      ? 99
      : (event.unitReduction ?? event.defenderLosses ?? 2);

    const ringColorFn = (t: number) =>
      `rgba(${style.ringRgb[0]}, ${style.ringRgb[1]}, ${style.ringRgb[2]}, ${Math.pow(1 - t, 1.4) * 0.9})`;

    if (abilityId === 'orbital_strike') {
      for (const offset of [-4, 0, 4]) {
        const arcId = uid('strike-beam');
        arcIds.push(arcId);
        scheduleTimer(() => {
          addArc({
            id: arcId,
            startLat: Math.min(82, targetCenter.lat + 38),
            startLng: targetCenter.lng + offset,
            endLat: targetCenter.lat,
            endLng: targetCenter.lng + offset * 0.15,
            color: ['#e0f7fa', '#67e8f9', '#0891b2'],
            stroke: 2.2,
            dashLen: 0.15,
            dashGap: 0.05,
            animateTime: 280,
            altitude: 0.25,
            clickForwardTerritoryId: event.territoryId,
          });
        }, 180 + Math.abs(offset) * 20);
      }
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 5,
          speed: 5,
          repeatPeriod: 280,
          colorFn: ringColorFn,
        });
      }, 520);
    } else if (abilityId === 'hypersonic_strike') {
      const arcId = uid('strike-streak');
      arcIds.push(arcId);
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: targetCenter.lat + 28,
          startLng: targetCenter.lng - 32,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: ['#fff', '#fed7aa', '#ea580c'],
          stroke: 3,
          dashLen: 0.55,
          dashGap: 0.08,
          animateTime: 160,
          altitude: 0.12,
          clickForwardTerritoryId: event.territoryId,
        });
      }, 120);
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 6,
          speed: 9,
          repeatPeriod: 220,
          colorFn: ringColorFn,
        });
        addRings({
          id: ring2Id,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4,
          speed: 11,
          repeatPeriod: 180,
          colorFn: (t: number) => `rgba(255, 255, 255, ${Math.pow(1 - t, 2) * 0.75})`,
        });
      }, 340);
    } else if (abilityId === 'cyber_attack' || abilityId === 'data_breach') {
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4,
          speed: 7,
          repeatPeriod: 180,
          colorFn: ringColorFn,
        });
      }, 200);
    } else if (abilityId === 'swarm_strike') {
      const offsets = [
        { lat: 14, lng: -16 },
        { lat: 10, lng: -6 },
        { lat: 18, lng: 4 },
        { lat: 8, lng: 14 },
        { lat: 16, lng: -22 },
        { lat: 12, lng: 18 },
      ];
      for (const off of offsets) {
        const arcId = uid('strike-swarm');
        arcIds.push(arcId);
        scheduleTimer(() => {
          addArc({
            id: arcId,
            startLat: targetCenter.lat + off.lat,
            startLng: targetCenter.lng + off.lng,
            endLat: targetCenter.lat,
            endLng: targetCenter.lng,
            color: ['#fff', '#fed7aa', '#ea580c'],
            stroke: 1.8,
            dashLen: 0.4,
            dashGap: 0.1,
            animateTime: 140,
            altitude: 0.1,
            clickForwardTerritoryId: event.territoryId,
          });
        }, 100 + Math.abs(off.lng) * 8);
      }
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 5,
          speed: 6,
          repeatPeriod: 220,
          colorFn: ringColorFn,
        });
      }, 480);
    } else if (abilityId === 'dyson_beam') {
      const arcId = uid('strike-dyson');
      arcIds.push(arcId);
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: Math.min(78, targetCenter.lat + 42),
          startLng: targetCenter.lng,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: ['#fffef0', '#fef08a', '#facc15', '#ca8a04'],
          stroke: 4,
          dashLen: 0.08,
          dashGap: 0.02,
          animateTime: 900,
          altitude: 0.3,
          clickForwardTerritoryId: event.territoryId,
        });
      }, 250);
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 7,
          speed: 3,
          repeatPeriod: 450,
          colorFn: ringColorFn,
        });
        addRings({
          id: ring2Id,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 5,
          speed: 4,
          repeatPeriod: 380,
          colorFn: (t: number) => `rgba(255, 255, 220, ${Math.pow(1 - t, 1.5) * 0.75})`,
        });
      }, 1100);
    } else if (abilityId === 'air_strike') {
      const sourceCenter = event.fromTerritoryId
        ? territoryCentersRef.current.get(event.fromTerritoryId)
        : null;
      if (sourceCenter) {
        const arcId = uid('strike-air');
        arcIds.push(arcId);
        scheduleTimer(() => {
          addArc({
            id: arcId,
            startLat: sourceCenter.lat + 6,
            startLng: sourceCenter.lng - 4,
            endLat: targetCenter.lat,
            endLng: targetCenter.lng,
            color: ['#f8fafc', '#cbd5e1', '#64748b'],
            stroke: 2.4,
            dashLen: 0.32,
            dashGap: 0.07,
            animateTime: 340,
            altitude: 0.2,
            clickForwardTerritoryId: event.territoryId,
          });
        }, 120);
      }
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4,
          speed: 6,
          repeatPeriod: 240,
          colorFn: ringColorFn,
        });
      }, 400);
    } else if (abilityId === 'river_blockade') {
      const sourceCenter = event.fromTerritoryId
        ? territoryCentersRef.current.get(event.fromTerritoryId)
        : null;
      if (sourceCenter) {
        const arcId = uid('strike-blockade');
        arcIds.push(arcId);
        scheduleTimer(() => {
          addArc({
            id: arcId,
            startLat: sourceCenter.lat,
            startLng: sourceCenter.lng,
            endLat: targetCenter.lat,
            endLng: targetCenter.lng,
            color: ['#e0f2fe', '#38bdf8', '#0284c7'],
            stroke: 3,
            dashLen: 0.25,
            dashGap: 0.08,
            animateTime: 520,
            altitude: null,
            clickForwardTerritoryId: event.territoryId,
          });
        }, 350);
      }
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4.5,
          speed: 5,
          repeatPeriod: 260,
          colorFn: ringColorFn,
        });
      }, 700);
    } else if (abilityId === 'nuclear_strike') {
      const arcId = uid('strike-missile');
      arcIds.push(arcId);
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: targetCenter.lat + 22,
          startLng: targetCenter.lng - 18,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: ['#fffde7', '#ffd54f', '#ff7043'],
          stroke: 2.5,
          dashLen: 0.35,
          dashGap: 0.1,
          animateTime: 420,
          altitude: 0.15,
          clickForwardTerritoryId: event.territoryId,
        });
      }, 200);
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4.5,
          speed: 4.5,
          repeatPeriod: 320,
          colorFn: ringColorFn,
        });
      }, 650);
    } else {
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 8,
          speed: 3.5,
          repeatPeriod: 400,
          colorFn: (t: number) => `rgba(255, 60, 0, ${Math.pow(1 - t, 1.2) * 0.95})`,
        });
      }, 400);
    }

    const flashDelay = abilityId === 'hypersonic_strike' ? 380
      : abilityId === 'swarm_strike' ? 520
        : abilityId === 'orbital_strike' ? 680
          : abilityId === 'nuclear_strike' ? 780
            : abilityId === 'dyson_beam' ? 1400
              : abilityId === 'air_strike' ? 480
                : abilityId === 'river_blockade' ? 820
                  : abilityId === 'cyber_attack' || abilityId === 'data_breach' ? 420
                    : 900;

    scheduleTimer(() => {
      addOverlay({
        kind: 'animation-strike-flash',
        id: flashId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        alt: 0.07,
        emoji: style.emoji,
        glowRgb,
      });
      if (abilityId === 'atom_bomb' && explosionId) {
        addOverlay({
          kind: 'animation-explosion',
          id: explosionId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.06,
        });
      }
    }, flashDelay);

    scheduleTimer(() => {
      removeOverlay(flashId);
      if (lossUnits > 0 && abilityId !== 'atom_bomb') {
        addOverlay({
          kind: 'animation-loss-banner',
          id: lossId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.05,
          text: `-${lossUnits} ${style.emoji}`,
        });
      } else if (abilityId === 'atom_bomb') {
        addOverlay({
          kind: 'animation-loss-banner',
          id: lossId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.05,
          text: '☢️ OBLITERATED',
        });
      }
    }, flashDelay + 900);

    scheduleTimer(() => {
      for (const arcId of arcIds) removeArc(arcId);
      removeRings(ringId);
      removeRings(ring2Id);
      removeOverlay(flashId);
      removeOverlay(lossId);
      if (explosionId) removeOverlay(explosionId);
      playNextRef.current();
    }, Math.min(style.mapFlashMs + 400, style.durationMs - 200));
  }, [
    pauseAutoRotate,
    panCamera,
    scheduleTimer,
    addOverlay,
    removeOverlay,
    addArc,
    removeArc,
    addRings,
    removeRings,
    startPolygonStrikeFlash,
  ]);

  const animateNaval = useCallback((event: GlobeEvent) => {
    const targetCenter = territoryCentersRef.current.get(event.territoryId);
    const sourceCenter = event.fromTerritoryId
      ? territoryCentersRef.current.get(event.fromTerritoryId)
      : null;
    if (!targetCenter) { playNextRef.current(); return; }

    pauseAutoRotate();
    if (shouldAutoFollow()) {
      if (sourceCenter) {
        const view = cameraViewForTwo(sourceCenter, targetCenter);
        panCamera(view.lat, view.lng, view.altitude);
      } else {
        panCamera(targetCenter.lat, targetCenter.lng, 1.7);
      }
    }

    const arcId = uid('naval-arc');
    const ringId = uid('naval-ring');
    const flashId = uid('naval-flash');
    const atkLossId = uid('naval-atk-loss');
    const defLossId = uid('naval-def-loss');
    const navalRgb = NAVAL_RING_RGB;
    const glowRgb = `rgba(${navalRgb.join(',')}, 0.85)`;
    const ringColorFn = (t: number) =>
      `rgba(${navalRgb[0]}, ${navalRgb[1]}, ${navalRgb[2]}, ${Math.pow(1 - t, 1.4) * 0.9})`;

    if (sourceCenter) {
      scheduleTimer(() => {
        addArc({
          id: arcId,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: targetCenter.lat,
          endLng: targetCenter.lng,
          color: ['#e0f2fe', '#38bdf8', '#0284c7'],
          stroke: 2.8,
          dashLen: 0.35,
          dashGap: 0.12,
          animateTime: 480,
          altitude: null,
          clickForwardTerritoryId: event.territoryId,
        });
      }, 500);
    }

    scheduleTimer(() => {
      addRings({
        id: ringId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        maxRadius: 5,
        speed: 5,
        repeatPeriod: 300,
        colorFn: ringColorFn,
      });
    }, 850);

    scheduleTimer(() => {
      addOverlay({
        kind: 'animation-strike-flash',
        id: flashId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        alt: 0.06,
        emoji: '⚓',
        glowRgb,
      });
    }, 1000);

    scheduleTimer(() => {
      removeRings(ringId);
      if (sourceCenter && (event.attackerLosses ?? 0) > 0) {
        addOverlay({
          kind: 'animation-loss-banner',
          id: atkLossId,
          lat: sourceCenter.lat,
          lng: sourceCenter.lng,
          alt: 0.04,
          text: `-${event.attackerLosses} ⚓`,
        });
      }
      if ((event.defenderLosses ?? 0) > 0) {
        addOverlay({
          kind: 'animation-loss-banner',
          id: defLossId,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          alt: 0.04,
          text: `-${event.defenderLosses} ⚓`,
        });
      }
    }, 1700);

    scheduleTimer(() => {
      removeArc(arcId);
      removeOverlay(flashId);
      removeOverlay(atkLossId);
      removeOverlay(defLossId);
      playNextRef.current();
    }, MAP_VISUAL_DURATIONS.naval);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addArc, removeArc, addRings, removeRings]);

  const animateInfluence = useCallback((event: GlobeEvent) => {
    const targetCenter = territoryCentersRef.current.get(event.territoryId);
    if (!targetCenter) { playNextRef.current(); return; }

    const blocked = event.variant === 'blocked';
    pauseAutoRotate();
    if (shouldAutoFollow()) {
      panCamera(targetCenter.lat, targetCenter.lng, 1.6);
    }

    const ringId = uid('influence-ring');
    const ring2Id = uid('influence-ring2');
    const flashId = uid('influence-flash');
    const infRgb = blocked ? INFLUENCE_BLOCKED_RGB : INFLUENCE_RING_RGB;
    const glowRgb = `rgba(${infRgb.join(',')}, ${blocked ? 0.55 : 0.85})`;
    const ringColorFn = (t: number) =>
      `rgba(${infRgb[0]}, ${infRgb[1]}, ${infRgb[2]}, ${Math.pow(1 - t, 1.3) * (blocked ? 0.55 : 0.85)})`;
    const duration = blocked ? MAP_VISUAL_DURATIONS.influenceBlocked : MAP_VISUAL_DURATIONS.influence;

    scheduleTimer(() => {
      addRings({
        id: ringId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        maxRadius: blocked ? 4 : 6,
        speed: blocked ? 3 : 4,
        repeatPeriod: blocked ? 280 : 320,
        colorFn: ringColorFn,
      });
      if (!blocked) {
        addRings({
          id: ring2Id,
          lat: targetCenter.lat,
          lng: targetCenter.lng,
          maxRadius: 4,
          speed: 6,
          repeatPeriod: 240,
          colorFn: (t: number) => `rgba(255, 255, 255, ${Math.pow(1 - t, 2) * 0.5})`,
        });
      }
    }, 300);

    scheduleTimer(() => {
      if (!blocked) {
        startPolygonCaptureFlash(
          event.territoryId,
          event.defenderColor,
          event.newOwnerColor ?? event.playerColor,
        );
      }
      addOverlay({
        kind: 'animation-strike-flash',
        id: flashId,
        lat: targetCenter.lat,
        lng: targetCenter.lng,
        alt: 0.07,
        emoji: blocked ? '🚫' : '📡',
        glowRgb,
      });
    }, blocked ? 600 : 1100);

    scheduleTimer(() => {
      removeRings(ringId);
      if (!blocked) removeRings(ring2Id);
      removeOverlay(flashId);
      playNextRef.current();
    }, duration);
  }, [pauseAutoRotate, panCamera, scheduleTimer, addOverlay, removeOverlay, addRings, removeRings, startPolygonCaptureFlash]);

  const animateEvent = useCallback((event: GlobeEvent) => {
    const mode = resolveEventVisualMode(event as MapVisualEvent);
    const duration = eventDurationMs(mode);
    pauseAutoRotate();

    const regionMap = new Map<string, string>();
    for (const t of mapData.territories) regionMap.set(t.territory_id, t.region_id);

    const overlayIds: string[] = [];
    const ringIds: string[] = [];
    const affected = event.affectedTerritories ?? [];
    const centers = territoryCentersRef.current;

    const focusId = affected[0]?.territory_id ?? event.territoryId;
    const focus = focusId && focusId !== '__global__' ? centers.get(focusId) : null;
    if (focus && shouldAutoFollow()) {
      panCamera(focus.lat, focus.lng, mode === 'global_disaster' ? 2.2 : 1.8);
    }

    if (mode === 'territory_deltas') {
      affected.forEach((row, i) => {
        const c = centers.get(row.territory_id);
        if (!c) return;
        const id = uid(`event-delta-${i}`);
        overlayIds.push(id);
        scheduleTimer(() => {
          addOverlay({
            kind: 'animation-loss-banner',
            id,
            lat: c.lat,
            lng: c.lng,
            alt: 0.05,
            text: row.delta >= 0 ? `+${row.delta}` : `${row.delta}`,
          });
        }, 200 + i * 120);
      });
    } else if (mode === 'global_disaster') {
      const rows = affected.length > 0
        ? affected
        : [...centers.keys()].map((territory_id) => ({ territory_id, delta: -1 }));
      rows.slice(0, 24).forEach((row, i) => {
        const c = centers.get(row.territory_id);
        if (!c) return;
        const ringId = uid(`event-disaster-${i}`);
        ringIds.push(ringId);
        scheduleTimer(() => {
          addRings({
            id: ringId,
            lat: c.lat,
            lng: c.lng,
            maxRadius: 4,
            speed: 5,
            repeatPeriod: 280,
            colorFn: (t: number) => `rgba(${EVENT_AMBER_RGB.join(',')}, ${Math.pow(1 - t, 1.4) * 0.85})`,
          });
          if (row.delta !== 0) {
            const oid = uid(`event-disaster-txt-${i}`);
            overlayIds.push(oid);
            addOverlay({
              kind: 'animation-loss-banner',
              id: oid,
              lat: c.lat,
              lng: c.lng,
              alt: 0.04,
              text: `${row.delta}`,
            });
          }
        }, 150 + i * 80);
      });
    } else if (mode === 'region_highlight') {
      let idx = 0;
      for (const [tid, c] of centers) {
        if (event.regionId && regionMap.get(tid) !== event.regionId) continue;
        if (idx >= 18) break;
        const ringId = uid(`event-region-${idx}`);
        ringIds.push(ringId);
        const delay = 200 + idx * 60;
        idx += 1;
        scheduleTimer(() => {
          addRings({
            id: ringId,
            lat: c.lat,
            lng: c.lng,
            maxRadius: 3.5,
            speed: 4,
            repeatPeriod: 350,
            colorFn: (t: number) => `rgba(${EVENT_STABILITY_RGB.join(',')}, ${Math.pow(1 - t, 1.3) * 0.8})`,
          });
        }, delay);
      }
    } else if (mode === 'strike_hit') {
      const rows = affected.length > 0 ? affected : [{ territory_id: event.territoryId, delta: -1 }];
      rows.forEach((row, i) => {
        const c = centers.get(row.territory_id);
        if (!c) return;
        scheduleTimer(() => {
          startPolygonStrikeFlash(row.territory_id, 'cyber_attack');
          const oid = uid(`event-strike-${i}`);
          overlayIds.push(oid);
          addOverlay({
            kind: 'animation-strike-flash',
            id: oid,
            lat: c.lat,
            lng: c.lng,
            alt: 0.06,
            emoji: '💥',
            glowRgb: 'rgba(255, 120, 50, 0.85)',
          });
        }, 300 + i * 200);
      });
    } else if (mode === 'truce_pulse') {
      [...centers.values()].slice(0, 6).forEach((c, i) => {
        const ringId = uid(`event-truce-${i}`);
        ringIds.push(ringId);
        scheduleTimer(() => {
          addRings({
            id: ringId,
            lat: c.lat,
            lng: c.lng,
            maxRadius: 5,
            speed: 3,
            repeatPeriod: 400,
            colorFn: (t: number) => `rgba(${EVENT_TRUCE_RGB.join(',')}, ${Math.pow(1 - t, 1.5) * 0.75})`,
          });
        }, i * 150);
      });
    } else if (mode === 'draft_bonus') {
      const bonus = event.units ?? 0;
      [...centers.entries()].slice(0, 4).forEach(([, c], i) => {
        const oid = uid(`event-draft-${i}`);
        overlayIds.push(oid);
        scheduleTimer(() => {
          addOverlay({
            kind: 'animation-loss-banner',
            id: oid,
            lat: c.lat,
            lng: c.lng,
            alt: 0.05,
            text: `+${bonus}`,
          });
        }, i * 100);
      });
    }

    scheduleTimer(() => {
      for (const id of ringIds) removeRings(id);
      for (const id of overlayIds) removeOverlay(id);
      playNextRef.current();
    }, duration);
  }, [
    pauseAutoRotate,
    panCamera,
    scheduleTimer,
    addOverlay,
    removeOverlay,
    addRings,
    removeRings,
    startPolygonStrikeFlash,
    mapData.territories,
  ]);

  const animateEraAdvance = useCallback((event: GlobeEvent) => {
    const duration = MAP_VISUAL_DURATIONS.eraAdvance;
    pauseAutoRotate();

    const centers = territoryCentersRef.current;
    const rows = event.affectedTerritories?.length
      ? event.affectedTerritories
      : [{ territory_id: event.territoryId, delta: 0 }];
    const territoryIds = rows.map((row) => row.territory_id);
    const sortedIds = sortTerritoryIdsByLatLng(territoryIds, centers, event.territoryId);

    const focus = centers.get(event.territoryId);
    if (focus && shouldAutoFollow()) {
      panCamera(focus.lat, focus.lng, 1.5);
    }

    const playerRgb = hexToRgb(event.playerColor ?? '#f39c12');
    const ringIds: string[] = [];
    const overlayIds: string[] = [];
    const eraName = eraAdvanceDisplayName(event.variant);

    startPolygonEraAdvanceCascade(sortedIds, playerRgb, duration);

    if (focus) {
      for (let wave = 0; wave < 3; wave++) {
        const ringId = uid(`era-advance-burst-${wave}`);
        ringIds.push(ringId);
        scheduleTimer(() => {
          addRings({
            id: ringId,
            lat: focus.lat,
            lng: focus.lng,
            maxRadius: 14 - wave * 2,
            speed: 5.5,
            repeatPeriod: 320,
            colorFn: (t: number) => {
              const pulse = Math.pow(1 - t, 1.1);
              const mix = lerpRgb(playerRgb, ERA_ADVANCE_GOLD_RGB, 0.55 + wave * 0.12);
              const white = lerpRgb(mix, [255, 255, 255], (1 - t) * 0.4);
              return `rgba(${white.join(',')}, ${pulse * (0.95 - wave * 0.15)})`;
            },
          });
        }, wave * 140);
      }

      const bannerId = uid('era-advance-banner');
      overlayIds.push(bannerId);
      scheduleTimer(() => {
        addOverlay({
          kind: 'animation-strike-flash',
          id: bannerId,
          lat: focus.lat,
          lng: focus.lng,
          alt: 0.1,
          emoji: '✨',
          glowRgb: 'rgba(255, 255, 255, 0.95)',
        });
        const labelId = uid('era-advance-label');
        overlayIds.push(labelId);
        addOverlay({
          kind: 'animation-loss-banner',
          id: labelId,
          lat: focus.lat,
          lng: focus.lng,
          alt: 0.14,
          text: `${eraName.toUpperCase()} ERA`,
        });
        const subId = uid('era-advance-sub');
        overlayIds.push(subId);
        addOverlay({
          kind: 'animation-loss-banner',
          id: subId,
          lat: focus.lat - 1.2,
          lng: focus.lng,
          alt: 0.11,
          text: 'Civilization Ascends',
        });
      }, 280);
    }

    sortedIds.forEach((tid, i) => {
      const c = centers.get(tid);
      if (!c || tid === event.territoryId) return;
      const ringId = uid(`era-advance-cascade-${i}`);
      ringIds.push(ringId);
      const stagger = 320 + i * 70;
      scheduleTimer(() => {
        addRings({
          id: ringId,
          lat: c.lat,
          lng: c.lng,
          maxRadius: 7,
          speed: 4.5,
          repeatPeriod: 300,
          colorFn: (t: number) => {
            const pulse = Math.pow(1 - t, 1.3);
            const mix = lerpRgb(playerRgb, ERA_ADVANCE_GOLD_RGB, 0.5);
            return `rgba(${mix.join(',')}, ${pulse * 0.75})`;
          },
        });
      }, stagger);
    });

    scheduleTimer(() => {
      for (const id of ringIds) removeRings(id);
      for (const id of overlayIds) removeOverlay(id);
      playNextRef.current();
    }, duration);
  }, [
    pauseAutoRotate,
    panCamera,
    scheduleTimer,
    addRings,
    removeRings,
    addOverlay,
    removeOverlay,
    startPolygonEraAdvanceCascade,
  ]);

  // ── Event queue engine ─────────────────────────────────────────────────

  playNextRef.current = () => {
    const next = eventQueueRef.current.shift();
    if (!next) {
      isAnimatingRef.current = false;
      currentEventIdRef.current = null;
      scheduleAutoRotateResume();
      flushAnimationUi();
      return;
    }
    isAnimatingRef.current = true;
    currentEventIdRef.current = next.id;
    flushAnimationUi();

    switch (next.kind ?? next.type) {
      case 'reinforce': animateReinforce(next); break;
      case 'combat':
      case 'capture':
        animateCombat(next); break;
      case 'fortify': animateFortify(next); break;
      case 'strike': animateStrike(next); break;
      case 'naval': animateNaval(next); break;
      case 'influence': animateInfluence(next); break;
      case 'event': animateEvent(next); break;
      case 'era_advance': animateEraAdvance(next); break;
      default: playNextRef.current(); break;
    }
  };

  const skipRemainingAnimations = useCallback(() => {
    for (const t of cleanupTimersRef.current) clearTimeout(t);
    cleanupTimersRef.current = [];
    if (polygonEraAdvanceTimerRef.current) clearInterval(polygonEraAdvanceTimerRef.current);
    polygonEraAdvanceTimerRef.current = null;
    setPolygonEraAdvanceFlash(null);
    setOverlays([]);
    setArcs([]);
    setRings([]);

    const ids: string[] = [];
    if (currentEventIdRef.current) ids.push(currentEventIdRef.current);
    for (const ev of eventQueueRef.current) ids.push(ev.id);
    eventQueueRef.current = [];
    currentEventIdRef.current = null;
    isAnimatingRef.current = false;

    for (const id of ids) onEventDone?.(id);
    scheduleAutoRotateResume();
    flushAnimationUi();
  }, [onEventDone, scheduleAutoRotateResume, flushAnimationUi]);

  // Expose the globe flush to the parent (resetViewRef pattern) so a unified
  // "skip everything" handler can drain the globe queue alongside the modal /
  // theater backlogs.
  useEffect(() => {
    if (!skipAnimationsRef) return;
    skipAnimationsRef.current = skipRemainingAnimations;
    return () => {
      if (skipAnimationsRef) skipAnimationsRef.current = null;
    };
  }, [skipAnimationsRef, skipRemainingAnimations]);

  const showSkipAnimations =
    !previewMode && animationUi.playing && animationUi.backlog > 0;

  useEffect(() => {
    let hasNew = false;
    for (const ev of events) {
      if (!seenEventIdsRef.current.has(ev.id)) {
        seenEventIdsRef.current.add(ev.id);
        eventQueueRef.current.push(ev);
        onEventDone?.(ev.id);
        hasNew = true;
      }
    }
    // Prevent unbounded growth of seen IDs in long sessions
    if (seenEventIdsRef.current.size > 500) {
      const entries = [...seenEventIdsRef.current];
      seenEventIdsRef.current = new Set(entries.slice(-200));
    }
    flushAnimationUi();
    if (hasNew && !isAnimatingRef.current) {
      playNextRef.current();
    }
  }, [events, onEventDone, flushAnimationUi]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const t of cleanupTimersRef.current) clearTimeout(t);
      clearTimeout(autoRotateTimerRef.current);
      if (polygonFlashTimerRef.current) clearInterval(polygonFlashTimerRef.current);
      if (polygonEraAdvanceTimerRef.current) clearInterval(polygonEraAdvanceTimerRef.current);
    };
  }, []);

  // ── Adjacency arcs (show attackable / fortifiable connections) ──────────

  const territoryCentroids = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>();
    for (const poly of polygonsData) {
      if (!map.has(poly.territory_id)) {
        const c = computeCentroid(poly.geometry);
        map.set(poly.territory_id, c);
      }
    }
    return map;
  }, [polygonsData]);

  /** Maps territory_id → region_id for fast lookups in polygon accessors. */
  const territoryRegionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mapData.territories) m.set(t.territory_id, t.region_id);
    return m;
  }, [mapData.territories]);

  /** Maps region_id → CSS color string (stable palette keyed by regions array order). */
  const regionColorMap = useMemo(() => {
    const m = new Map<string, string>();
    const orderedIds = mapData.regions
      ? mapData.regions.map((r) => r.region_id)
      : [...new Set(mapData.territories.map((t) => t.region_id))].sort();
    const regionColors = getRegionCssColors();
    orderedIds.forEach((rid, i) => m.set(rid, regionColors[i % regionColors.length]));
    return m;
  }, [mapData.regions, mapData.territories]);

  /** Floating region-name labels — one per region, positioned at the geographic centroid
   *  of its member territories. Non-interactive (pointer-events: none). */
  const regionHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (!mapData.regions) return [];
    const out: HtmlDatum[] = [];
    // Labels show the EFFECTIVE bonus for this game's player count (matches the
    // reinforcements actually granted), not the raw map value.
    const playerCount = gameState?.players.length ?? 6;

    for (const region of mapData.regions) {
      if (region.region_id === 'sea_routes') continue;

      const regionTerritories = mapData.territories.filter(
        (t) =>
          t.region_id === region.region_id &&
          t.region_id !== 'sea_routes' &&
          inferWorldId(t) === activeWorldId,
      );
      if (regionTerritories.length < 2) continue;

      let sumLat = 0, sumLng = 0, count = 0;
      for (const t of regionTerritories) {
        const c = territoryCentroids.get(t.territory_id);
        if (c) { sumLat += c.lat; sumLng += c.lng; count++; }
      }
      if (count === 0) continue;

      const color = regionColorMap.get(region.region_id) ?? '#aaaaaa';

      out.push({
        kind: 'region-label',
        id: `region-label-${region.region_id}`,
        lat: sumLat / count,
        lng: sumLng / count,
        alt: 0.07,
        name: region.name,
        bonus: effectiveContinentBonus(region.bonus, playerCount),
        color,
      });
    }
    return out;
  }, [mapData.regions, mapData.territories, territoryCentroids, regionColorMap, activeWorldId, gameState?.players.length]);

  const buildingHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (!gameState) return [];
    const out: HtmlDatum[] = [];
    for (const [tid, tState] of Object.entries(gameState.territories)) {
      const terr = territoryById.get(tid);
      if (!terr || inferWorldId(terr) !== activeWorldId) continue;
      // Fog of war: don't reveal building icons on unscouted territories.
      if (isFogHidden(tState)) continue;
      const buildings: string[] = (tState as { buildings?: string[] }).buildings ?? [];
      if (buildings.length === 0) continue;
      const c = territoryCentroids.get(tid);
      if (!c) continue;
      const icons = buildings
        .map((b: string) => {
          if (b.includes('port') || b.includes('naval')) return '⚓';
          if (b.includes('fort') || b.includes('wall') || b.includes('defense') || b.includes('castle')) return '🛡';
          if (b.includes('lab') || b.includes('acad') || b.includes('univ') || b.includes('research')) return '🔬';
          if (b.includes('farm') || b.includes('mine') || b.includes('market') || b.includes('production') || b.includes('plantation')) return '⚙';
          return '🏛';
        })
        .join('');
      out.push({
        kind: 'building-icons',
        id: `building-globe-${tid}`,
        lat: c.lat,
        lng: c.lng,
        alt: 0.055,
        icons,
        tooltip: buildings.join(', '),
      });
    }
    return out;
  }, [gameState, territoryCentroids, territoryById, activeWorldId]);

  const capitalHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (!gameState) return [];
    const out: HtmlDatum[] = [];
    for (const pl of gameState.players) {
      if (!pl.capital_territory_id) continue;
      const terr = territoryById.get(pl.capital_territory_id);
      if (!terr || inferWorldId(terr) !== activeWorldId) continue;
      const c = territoryCentroids.get(pl.capital_territory_id);
      if (!c) continue;
      out.push({
        kind: 'capital-marker',
        id: `capital-globe-${pl.player_id}`,
        lat: c.lat,
        lng: c.lng,
        alt: 0.045,
        color: pl.color,
      });
    }
    return out;
  }, [gameState, territoryCentroids, territoryById, activeWorldId]);

  const adjacencyArcs = useMemo(() => {
    if (!gameState) return [];
    const phase = gameState.phase;
    const source = attackSource ?? selectedTerritory;
    if (!source) return [];

    const sourceOwner = gameState.territories[source]?.owner_id;
    const myId = gameState.players.find(p =>
      p.player_id === sourceOwner
    )?.player_id;
    if (!myId) return [];

    const sourceCenter = territoryCentroids.get(source);
    if (!sourceCenter) return [];
    const sourceTerr = territoryById.get(source);
    if (!sourceTerr || inferWorldId(sourceTerr) !== activeWorldId) return [];

    const result: ArcDatum[] = [];
    for (const conn of mapData.connections) {
      const neighborId = conn.from === source ? conn.to : conn.to === source ? conn.from : null;
      if (!neighborId) continue;

      const neighborOwner = gameState.territories[neighborId]?.owner_id;
      const neighborCenter = territoryCentroids.get(neighborId);
      if (!neighborCenter) continue;
      const neighborTerr = territoryById.get(neighborId);
      if (!neighborTerr || inferWorldId(neighborTerr) !== activeWorldId) continue;

      if (phase === 'attack') {
        if (neighborOwner === myId || !neighborOwner) continue;
        const isSea = conn.type === 'sea';
        result.push({
          id: `adj-${source}-${neighborId}`,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: isSea ? ['rgba(250, 204, 21, 0.6)', 'rgba(250, 204, 21, 0.15)'] : ['rgba(248, 113, 113, 0.6)', 'rgba(248, 113, 113, 0.15)'],
          stroke: isSea ? 1.2 : 1.5,
          dashLen: isSea ? 4 : 8,
          dashGap: isSea ? 4 : 3,
          animateTime: 2000,
          altitude: isSea ? 0.15 : 0.05,
          // Clicks landing on an attack arc should select the attackable target;
          // that's the territory the user is most likely aiming at.
          clickForwardTerritoryId: neighborId,
        });
      } else if (phase === 'fortify') {
        if (neighborOwner !== myId) continue;
        result.push({
          id: `adj-${source}-${neighborId}`,
          startLat: sourceCenter.lat,
          startLng: sourceCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: ['rgba(74, 222, 128, 0.5)', 'rgba(74, 222, 128, 0.1)'],
          stroke: 1.0,
          dashLen: 6,
          dashGap: 4,
          animateTime: 3000,
          altitude: 0.04,
          clickForwardTerritoryId: neighborId,
        });
      }
    }
    return result;
  }, [gameState, attackSource, selectedTerritory, mapData.connections, territoryCentroids, territoryById, activeWorldId]);

  const contestedFrontierArcs = useMemo((): ArcDatum[] => {
    if (!ambientEnabled || reducedEffects || !gameState || gameState.phase !== 'attack') return [];
    const result: ArcDatum[] = [];
    for (const edge of contestedBorders) {
      const fromCenter = territoryCentroids.get(edge.fromId);
      const toCenter = territoryCentroids.get(edge.toId);
      const fromTerr = territoryById.get(edge.fromId);
      const toTerr = territoryById.get(edge.toId);
      if (!fromCenter || !toCenter || !fromTerr || !toTerr) continue;
      if (inferWorldId(fromTerr) !== activeWorldId || inferWorldId(toTerr) !== activeWorldId) continue;
      result.push({
        id: `contested-${edge.fromId}-${edge.toId}`,
        startLat: fromCenter.lat,
        startLng: fromCenter.lng,
        endLat: toCenter.lat,
        endLng: toCenter.lng,
        color: edge.sea
          ? ['rgba(250, 204, 21, 0.45)', 'rgba(250, 204, 21, 0.12)']
          : ['rgba(248, 113, 113, 0.5)', 'rgba(248, 113, 113, 0.12)'],
        stroke: edge.sea ? 1.1 : 1.4,
        dashLen: edge.sea ? 5 : 7,
        dashGap: edge.sea ? 4 : 3,
        animateTime: 2400,
        altitude: edge.sea ? 0.12 : 0.04,
        clickForwardTerritoryId: edge.toId,
      });
    }
    return result;
  }, [ambientEnabled, reducedEffects, gameState, contestedBorders, territoryCentroids, territoryById, activeWorldId]);

  // ── Permanent sea lane arcs ────────────────────────────────────────────
  // Sea-route territories (region_id === 'sea_routes') are rendered as tiny
  // polygon markers on the ocean.  These arcs draw the actual trade-route
  // spokes from each marker hub to every land territory it connects.

  const seaRouteTerritoryIds = useMemo(
    () =>
      new Set(
        mapData.territories
          .filter((t) => t.region_id === 'sea_routes' && inferWorldId(t) === activeWorldId)
          .map((t) => t.territory_id),
      ),
    [mapData.territories, activeWorldId],
  );

  const seaLaneArcs = useMemo((): ArcDatum[] => {
    if (seaRouteTerritoryIds.size === 0) return [];

    const result: ArcDatum[] = [];

    for (const seaId of seaRouteTerritoryIds) {
      const seaCenter = territoryCentroids.get(seaId);
      if (!seaCenter) continue;

      // Color by current owner, else default ocean teal.
      let c0 = 'rgba(94, 234, 212, 0.42)';
      let c1 = 'rgba(94, 234, 212, 0.1)';
      if (gameState) {
        const ownerId = gameState.territories[seaId]?.owner_id;
        const owner = ownerId ? gameState.players.find((p) => p.player_id === ownerId) : null;
        if (owner?.color) {
          c0 = hexToRgba(owner.color, 0.4);
          c1 = hexToRgba(owner.color, 0.1);
        }
      }

      for (const conn of mapData.connections) {
        const neighborId = conn.from === seaId ? conn.to : conn.to === seaId ? conn.from : null;
        if (!neighborId) continue;
        if (seaRouteTerritoryIds.has(neighborId)) continue; // skip sea-to-sea
        const neighborCenter = territoryCentroids.get(neighborId);
        if (!neighborCenter) continue;

        result.push({
          id: `sealane-${seaId}-${neighborId}`,
          startLat: seaCenter.lat,
          startLng: seaCenter.lng,
          endLat: neighborCenter.lat,
          endLng: neighborCenter.lng,
          color: [c0, c1],
          stroke: 0.8,
          dashLen: 0.22,
          dashGap: 0.14,
          animateTime: 7000,
          altitude: 0.06,
        });
      }
    }
    return result;
  }, [seaRouteTerritoryIds, territoryCentroids, mapData.connections, gameState]);

  const seaRouteHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (seaRouteTerritoryIds.size === 0) return [];

    const out: HtmlDatum[] = [];
    for (const territory of mapData.territories) {
      if (territory.region_id !== 'sea_routes') continue;
      const center = territoryCentroids.get(territory.territory_id);
      if (!center) continue;

      const ownerId = gameState?.territories[territory.territory_id]?.owner_id;
      const owner = ownerId ? gameState?.players.find((p) => p.player_id === ownerId) : null;
      const selected = territory.territory_id === selectedTerritory || territory.territory_id === attackSource;
      const color = owner?.color ?? '#5eead4';
      const size = selected ? 16 : 12;
      const glow = selected ? 18 : 10;

      out.push({
        kind: 'sea-route-marker',
        id: `sea-route-marker-${territory.territory_id}`,
        lat: center.lat,
        lng: center.lng,
        alt: 0.028,
        onClickTerritoryId: territory.territory_id,
        territoryName: territory.name,
        color,
        size,
        glow,
      });
    }
    return out;
  }, [seaRouteTerritoryIds, mapData.territories, territoryCentroids, gameState, selectedTerritory, attackSource]);

  // Decorative Earth wasteland markers (Space Age) — shown only on Earth
  // view of the era_space_age map. Each gets a pulsing radial-gradient
  // glyph + name label and matching ring animation. Skipped on the moon
  // inset and on every other map.
  const wastelandHtmlOverlays = useMemo((): HtmlDatum[] => {
    if (mapData.map_id !== 'era_space_age' || activeWorldId !== 'earth') return [];
    return SPACE_AGE_WASTELANDS.map((w) => ({
      id: `wasteland-${w.id}`,
      kind: 'wasteland-zone' as const,
      lat: w.lat,
      lng: w.lng,
      // Sit clearly above polygon caps (which max ~0.009 on Earth) and
      // above building/capital overlays so the icon never disappears
      // behind a labeled territory.
      alt: 0.025,
      name: w.name,
      description: w.description,
      glyph: wastelandGlyph(w.kind),
      colorRgba: wastelandColorRgba(w.kind, 0.9),
    }));
  }, [mapData.map_id, activeWorldId]);

  const wastelandRings = useMemo((): RingDatum[] => {
    if (mapData.map_id !== 'era_space_age' || activeWorldId !== 'earth') return [];
    return SPACE_AGE_WASTELANDS.map((w) => {
      const [r, g, b] = wastelandColorRgb(w.kind);
      return {
        id: `wasteland-ring-${w.id}`,
        lat: w.lat,
        lng: w.lng,
        maxRadius: w.radius,
        speed: 0.4,
        repeatPeriod: w.periodMs,
        // Slow outward pulse around the marker — visible but not loud.
        // Peaks at ~0.4 alpha at the leading edge and fades to 0 as the
        // ring expands, so it reads as a heartbeat halo instead of a
        // combat ping.
        colorFn: (t: number) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, 0.4 * (1 - t))})`,
      };
    });
  }, [mapData.map_id, activeWorldId]);

  const combinedHtmlOverlays = useMemo(
    () => [
      ...regionHtmlOverlays,
      ...seaRouteHtmlOverlays,
      ...capitalHtmlOverlays,
      ...buildingHtmlOverlays,
      ...wastelandHtmlOverlays,
      ...overlays,
    ],
    [
      regionHtmlOverlays,
      seaRouteHtmlOverlays,
      capitalHtmlOverlays,
      buildingHtmlOverlays,
      wastelandHtmlOverlays,
      overlays,
    ],
  );

  const adjacencyTargets = useMemo(() => {
    const source = attackSource ?? selectedTerritory;
    if (!gameState || !source) return new Set<string>();
    return computePhaseAdjacencyTargets(gameState, mapData.connections, {
      attackSource: source,
      territoryFilter: (territoryId) => {
        const terr = territoryById.get(territoryId);
        return !!terr && inferWorldId(terr) === activeWorldId;
      },
    });
  }, [
    gameState,
    attackSource,
    selectedTerritory,
    mapData.connections,
    territoryById,
    activeWorldId,
  ]);

  const emphasizeAdjacencyBorders = shouldEmphasizeAdjacencyBorders(connectionHintMode);
  const renderConnectionArcs = shouldRenderConnectionArcs(connectionHintMode);

  const combinedArcs = useMemo(() => {
    if (!renderConnectionArcs) return arcs;
    return [...seaLaneArcs, ...arcs, ...adjacencyArcs, ...contestedFrontierArcs];
  }, [renderConnectionArcs, seaLaneArcs, arcs, adjacencyArcs, contestedFrontierArcs]);

  // ── Polygon accessors ──────────────────────────────────────────────────

  const getPolygonColor = useCallback(
    (polygon: object) => {
      const p = polygon as PolygonData;
      const empty = isFloodedNorthAmerica
        ? useSolidPlayerCaps
          ? 'rgb(245, 242, 230)'
          : 'rgba(245, 242, 230, 0.98)'
        : useSolidPlayerCaps
          ? 'rgb(45, 52, 72)'
          : 'rgba(45, 52, 72, 0.92)';
      if (!gameState) {
        if (previewMode) {
          const regionId = territoryRegionMap.get(p.territory_id);
          const regionColor = regionId ? regionColorMap.get(regionId) : undefined;
          if (regionColor) return regionColor;
        }
        return empty;
      }

      let base: string = empty;
      const tState = gameState.territories[p.territory_id];
      if (tState?.owner_id) {
        const player = gameState.players.find((ply) => ply.player_id === tState.owner_id);
        if (player) {
          const raw = (player.color || '').trim();
          const lookupKey = raw.startsWith('#') ? raw.toLowerCase() : raw;
          base = getPlayerGlobeColor(lookupKey, useSolidPlayerCaps)
            ?? (useSolidPlayerCaps ? 'rgb(136, 136, 136)' : 'rgba(136, 136, 136, 0.92)');
        }
      }

      if (
        polygonStrikeFlash &&
        polygonStrikeFlash.territoryId === p.territory_id
      ) {
        const [r, g, b] = STRIKE_MAP_STYLES[polygonStrikeFlash.abilityId].ringRgb;
        const alpha = 0.28 + 0.42 * polygonStrikeFlash.phase;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      if (
        polygonCaptureFlash &&
        polygonCaptureFlash.territoryId === p.territory_id
      ) {
        const [r, g, b] = lerpRgb(
          polygonCaptureFlash.fromRgb,
          polygonCaptureFlash.toRgb,
          polygonCaptureFlash.phase,
        );
        const alpha = 0.32 + 0.48 * polygonCaptureFlash.phase;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      if (polygonEraAdvanceFlash) {
        const phase = polygonEraAdvanceFlash.phases.get(p.territory_id);
        if (phase && phase > 0.02) {
          return eraAdvancePolygonRgba(polygonEraAdvanceFlash.playerRgb, phase);
        }
      }

      return base;
    },
    [gameState, previewMode, territoryRegionMap, regionColorMap, useSolidPlayerCaps, isFloodedNorthAmerica, polygonStrikeFlash, polygonCaptureFlash, polygonEraAdvanceFlash],
  );

  const getPolygonStroke = useCallback(
    (polygon: object) => {
      const p = polygon as PolygonData;
      if (p.territory_id === selectedTerritory || p.territory_id === attackSource) {
        return '#ffd700';
      }
      if (adjacencyTargets.has(p.territory_id)) {
        const phaseColor = gameState?.phase === 'attack' ? '#f87171' : '#4ade80';
        return emphasizeAdjacencyBorders ? phaseColor : phaseColor;
      }
      if (
        ambientEnabled &&
        turnHolderPlayerId &&
        gameState?.territories[p.territory_id]?.owner_id === turnHolderPlayerId
      ) {
        const holder = gameState.players.find((pl) => pl.player_id === turnHolderPlayerId);
        if (holder?.color) return holder.color;
      }
      // Galactic Age: every territory on a world often shares one region_id, and
      // REGION_CSS_COLORS can sit close to player blues/greens — borders vanish and
      // the cap reads as one solid player “shell”. Use a neutral rim so each cap
      // stays readable on textured globes (Sol / Verdan / Rust / Nexus).
      if (mapData.map_kind === 'galaxy') {
        return '#ffffff';
      }
      const regionId = territoryRegionMap.get(p.territory_id);
      const regionColor = regionId ? regionColorMap.get(regionId) : undefined;
      if (regionColor) return regionColor;
      return useSolidPlayerCaps ? 'rgb(228, 234, 245)' : 'rgba(12, 18, 32, 0.92)';
    },
    [
      mapData.map_kind,
      selectedTerritory,
      attackSource,
      adjacencyTargets,
      gameState,
      gameState?.phase,
      ambientEnabled,
      turnHolderPlayerId,
      useSolidPlayerCaps,
      territoryRegionMap,
      regionColorMap,
      emphasizeAdjacencyBorders,
    ],
  );

  const getPolygonSideColor = useCallback(
    (polygon: object) => {
      const fallback = useSolidPlayerCaps ? 'rgb(14, 18, 30)' : 'rgba(6, 10, 18, 0.45)';
      // Era re-skin (Layer 1): tint each territory's extruded WALLS in its OWNER's
      // era accent, so era gaps read on the globe (the primary view) — your modern
      // empire's walls glow green next to an opponent still in ancient gold. Caps
      // stay player-colored (ownership); stroke keeps its region/adjacency signal.
      if (!gameState?.settings.era_advancement_enabled) return fallback;
      const tState = gameState.territories[(polygon as PolygonData).territory_id];
      if (!tState?.owner_id) return fallback;
      const owner = gameState.players.find((ply) => ply.player_id === tState.owner_id);
      if (!owner) return fallback;
      return hexToRgba(eraBoardTheme(resolvePlayerTechEraId(gameState, owner)).accent, useSolidPlayerCaps ? 0.9 : 0.65);
    },
    [gameState, useSolidPlayerCaps],
  );

  // ── Globe layer accessors (stable) ─────────────────────────────────────

  const htmlElAccessors = useMemo(() => ({
    lat: (d: object) => (d as HtmlDatum).lat,
    lng: (d: object) => (d as HtmlDatum).lng,
    alt: (d: object) => (d as HtmlDatum).alt,
    element: (d: object) => buildHtmlOverlayElement(d as HtmlDatum, onTerritoryClick),
  }), [onTerritoryClick]);

  const arcAccessors = useMemo(() => ({
    startLat: (d: object) => (d as ArcDatum).startLat,
    startLng: (d: object) => (d as ArcDatum).startLng,
    endLat: (d: object) => (d as ArcDatum).endLat,
    endLng: (d: object) => (d as ArcDatum).endLng,
    color: (d: object) => (d as ArcDatum).color,
    stroke: (d: object) => (d as ArcDatum).stroke,
    dashLen: (d: object) => (d as ArcDatum).dashLen,
    dashGap: (d: object) => (d as ArcDatum).dashGap,
    animateTime: (d: object) => (d as ArcDatum).animateTime,
    altitude: (d: object) => (d as ArcDatum).altitude,
  }), []);

  // ── Tutorial highlight ring ──────────────────────────────────────────────
  const tutorialRing = useMemo((): RingDatum | null => {
    if (!highlightTerritoryId) return null;
    const center = territoryCenters.get(highlightTerritoryId);
    if (!center) return null;
    return {
      id: `tutorial-highlight-${highlightTerritoryId}`,
      lat: center.lat,
      lng: center.lng,
      maxRadius: 1.2,
      speed: 1.5,
      repeatPeriod: 800,
      colorFn: (t: number) => `rgba(255, 215, 0, ${Math.max(0, 1 - t)})`,
    };
  }, [highlightTerritoryId, territoryCenters]);

  // First-turn coach (WI1): pulse every territory the new player owns during the
  // reinforcement step so "tap one of your glowing territories" has an obvious
  // referent. coachHighlightOwnerId is null (dormant) for everyone else.
  const coachOwnedRings = useMemo((): RingDatum[] => {
    if (!coachHighlightOwnerId || gameState?.phase !== 'draft') return [];
    const out: RingDatum[] = [];
    for (const [tid, t] of Object.entries(gameState.territories)) {
      if (t.owner_id !== coachHighlightOwnerId) continue;
      const center = territoryCenters.get(tid);
      if (!center) continue;
      out.push({
        id: `coach-own-${tid}`,
        lat: center.lat,
        lng: center.lng,
        maxRadius: 0.9,
        speed: 1.2,
        repeatPeriod: 1100,
        colorFn: (x: number) => `rgba(255, 215, 0, ${Math.max(0, 0.7 - x)})`,
      });
    }
    return out;
  }, [coachHighlightOwnerId, gameState, territoryCenters]);

  const combinedRings = useMemo(() => {
    const out = [...rings, ...wastelandRings, ...coachOwnedRings];
    if (tutorialRing) out.push(tutorialRing);
    return out;
  }, [rings, tutorialRing, wastelandRings, coachOwnedRings]);

  const ringAccessors = useMemo(() => ({
    lat: (d: object) => (d as RingDatum).lat,
    lng: (d: object) => (d as RingDatum).lng,
    maxRadius: (d: object) => (d as RingDatum).maxRadius,
    speed: (d: object) => (d as RingDatum).speed,
    repeatPeriod: (d: object) => (d as RingDatum).repeatPeriod,
    color: (d: object) => (d as RingDatum).colorFn,
  }), []);

  // ── Drag-threshold guard (mobile) ──────────────────────────────────────
  // react-globe.gl's Three.js raycaster can fire polygon clicks even after a
  // drag on touch devices. We track the pointer-down position and mark the
  // interaction as a drag if movement exceeds 8 px so we can suppress clicks.
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDragRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    isDragRef.current = false;
    // New gesture: any pending fallback from the previous tap is stale.
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerDownPosRef.current) return;
    const dx = e.clientX - pointerDownPosRef.current.x;
    const dy = e.clientY - pointerDownPosRef.current.y;
    // Fingertips jitter more than mice — give touch a looser threshold so
    // ordinary taps aren't misread as drags and silently swallowed.
    const threshold = e.pointerType === 'touch' ? 14 : 8;
    if (Math.hypot(dx, dy) > threshold) isDragRef.current = true;
  }, []);

  /** True once react-globe.gl's own raycast handled the current gesture. */
  const polygonClickFiredRef = useRef(false);
  /** Pending fallback hit-test — cancelled by the next pointerdown/unmount. */
  const fallbackTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
  }, []);

  const guardedTerritoryClick = useCallback((territoryId: string) => {
    // The library's raycast resolved this gesture — also suppresses a
    // late-arriving fallback (and vice versa: once the fallback has fired,
    // a slow raycast landing afterwards must not double-click).
    if (polygonClickFiredRef.current) return;
    polygonClickFiredRef.current = true;
    if (isDragRef.current) return;
    onTerritoryClick(territoryId);
  }, [onTerritoryClick]);

  const renderedPolygonsRef = useRef<PolygonData[]>([]);
  renderedPolygonsRef.current = renderedPolygonsData;
  const onTerritoryClickRef = useRef(onTerritoryClick);
  onTerritoryClickRef.current = onTerritoryClick;

  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    const wasTap = pointerDownPosRef.current !== null && !isDragRef.current;
    // Stop tracking once the gesture ends; without this, later pointer moves
    // (hover, momentum) kept measuring against a stale down-position.
    pointerDownPosRef.current = null;
    if (!wasTap || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Only taps that land on the WebGL canvas count — pointerups bubbling
    // from overlay controls (Skip animations, HTML labels) must not select
    // the territory that happens to sit behind them.
    if (!(e.target instanceof HTMLCanvasElement)) return;

    // Fallback hit-test: three.js polygon raycasting is unreliable on small
    // canvases (mobile viewports), so when no onPolygonClick arrives for this
    // tap we resolve the territory ourselves from screen → globe coords.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    polygonClickFiredRef.current = false;
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      if (polygonClickFiredRef.current) return;
      const globe = globeRef.current as
        | (GlobeMethods & { toGlobeCoords?: (x: number, y: number) => { lat: number; lng: number } | null })
        | undefined;
      const coords = globe?.toGlobeCoords?.(x, y);
      if (!coords) return;
      const point: [number, number] = [coords.lng, coords.lat];
      const hit = renderedPolygonsRef.current.find((p) =>
        booleanPointInPolygon(point, { type: 'Feature', geometry: p.geometry, properties: {} }),
      );
      if (hit) {
        // Mark the gesture handled so a raycast that resolves late (>200ms
        // on a janky frame) cannot fire a second click for the same tap.
        polygonClickFiredRef.current = true;
        onTerritoryClickRef.current(hit.territory_id);
      }
    }, 200);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="w-full h-full rounded-lg overflow-hidden bg-bf-dark relative"
      style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
      data-testid="globe-map-root"
      data-globe-queue-depth={animationUi.backlog}
      data-globe-playing={animationUi.playing ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <style dangerouslySetInnerHTML={{ __html: ANIMATION_STYLES }} />
      {showSkipAnimations && (
        <button
          type="button"
          onClick={onSkipAll ?? skipRemainingAnimations}
          title="Skip queued animations (battles, reinforcements, and the current one end immediately)"
          className="absolute top-4 right-4 z-30 pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg
            bg-[rgba(18,22,35,0.92)] border border-bf-gold/45 text-bf-gold text-sm font-medium shadow-lg
            hover:bg-bf-gold/10 hover:border-bf-gold/70 transition-colors backdrop-blur-sm"
        >
          <FastForward className="w-4 h-4 shrink-0" aria-hidden />
          <span>Skip animations</span>
          <span className="text-xs tabular-nums opacity-85">({animationUi.backlog} queued)</span>
        </button>
      )}
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        backgroundColor={effectiveBackgroundColor}
        globeImageUrl={galaxyPolygonTexture ?? globeImageUrl}
        bumpImageUrl={bumpImageUrl}
        showAtmosphere={showAtmosphere}
        atmosphereColor={atmosphereColor}
        atmosphereAltitude={atmosphereAltitude}

        /* Territories */
        polygonsData={renderedPolygonsData}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={getPolygonColor}
        polygonSideColor={getPolygonSideColor}
        polygonStrokeColor={getPolygonStroke}
        polygonAltitude={getPolygonAltitude}
        polygonCapCurvatureResolution={getPolygonCapCurvatureResolution}
        polygonsTransitionDuration={0}
        polygonLabel={(p) => (p as PolygonData).name}
        onPolygonClick={(polygon) => polygon && guardedTerritoryClick((polygon as PolygonData).territory_id)}

        /* HTML overlays (floating text) */
        htmlElementsData={combinedHtmlOverlays}
        htmlLat={htmlElAccessors.lat}
        htmlLng={htmlElAccessors.lng}
        htmlAltitude={htmlElAccessors.alt}
        htmlElement={htmlElAccessors.element}
        htmlTransitionDuration={0}

        /* Arcs (event animations + adjacency indicators) */
        arcsData={combinedArcs}
        arcStartLat={arcAccessors.startLat}
        arcStartLng={arcAccessors.startLng}
        arcEndLat={arcAccessors.endLat}
        arcEndLng={arcAccessors.endLng}
        arcColor={arcAccessors.color}
        arcStroke={arcAccessors.stroke}
        arcDashLength={arcAccessors.dashLen}
        arcDashGap={arcAccessors.dashGap}
        arcDashAnimateTime={arcAccessors.animateTime}
        arcAltitude={arcAccessors.altitude}
        /**
         * Forward arc clicks to the underlying territory. The adjacency /
         * combat arcs rendered during Attack and Fortify phases cover a fair
         * amount of space between source and target, and react-globe.gl's
         * raycaster can hit the arc tube before the polygon cap. Without this
         * handler those clicks are swallowed, making it hard to select the
         * attackable / fortifiable territory the arc is pointing at.
         */
        onArcClick={(arc) => {
          const tid = (arc as ArcDatum).clickForwardTerritoryId;
          if (tid) guardedTerritoryClick(tid);
        }}

        /* Rings (explosion effects + tutorial highlight) */
        ringsData={combinedRings}
        ringLat={ringAccessors.lat}
        ringLng={ringAccessors.lng}
        ringColor={ringAccessors.color}
        ringMaxRadius={ringAccessors.maxRadius}
        ringPropagationSpeed={ringAccessors.speed}
        ringRepeatPeriod={ringAccessors.repeatPeriod}

        onGlobeReady={() => {
          setGlobeReadyTick((t) => t + 1);
          onGlobeReady?.();
        }}
      />
    </div>
  );
}

// ── WebGL-aware export ─────────────────────────────────────────────────────────
// Detects WebGL support at runtime; falls back to the 2D SVG GameMap so the
// game remains fully playable on browsers/devices without GPU acceleration.
export { GlobeMap as GlobeMapCore };

function GlobeMapWithFallback(props: GlobeMapProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const onGlobeReadyRef = useRef(props.onGlobeReady);
  onGlobeReadyRef.current = props.onGlobeReady;

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      setWebglOk(!!ctx);
    } catch {
      setWebglOk(false);
    }
  }, []);

  // The 2D fallback never mounts the globe, so its onGlobeReady would never
  // fire — signal readiness once the lighter 2D map path is chosen so the
  // turn-ready ack still happens for non-WebGL clients.
  useEffect(() => {
    if (webglOk === false) onGlobeReadyRef.current?.();
  }, [webglOk]);

  if (webglOk === null) return null;

  if (!webglOk) {
    return (
      <div style={{ width: props.width, height: props.height, position: 'relative' }}>
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-amber-800/80 text-amber-100 text-xs px-3 py-1 rounded-full pointer-events-none">
          3D globe unavailable — showing 2D map
        </div>
        <Suspense fallback={<div className="flex items-center justify-center h-full text-bf-muted text-sm">Loading 2D map…</div>}>
          <GameMapLazy
            mapData={props.mapData}
            onTerritoryClick={props.onTerritoryClick ?? (() => {})}
            width={props.width}
            height={props.height}
            highlightTerritoryId={props.highlightTerritoryId}
            connectionHintMode={props.connectionHintMode}
            reducedEffects={props.reducedEffects}
            ambientEnabled={props.ambientEnabled}
            contestedBorders={props.contestedBorders}
          />
        </Suspense>
      </div>
    );
  }

  return <GlobeMap {...props} />;
}

export default GlobeMapWithFallback;
