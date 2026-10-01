/**
 * Galactic Age — Split: every world's map at once, one pane per world.
 *
 * The galaxy chart (GalaxyStrategicView) shows each world as one node, and a
 * world tab opens one world's map; Split shows all of them at once, so the
 * player reads every front without cycling through the tabs. Panes sit in the
 * chart's ring order (utils/galaxySplitLayout.ts), so the worlds a lane joins
 * are side by side.
 *
 * A pane is the game's own map for one world, as the page's Globe / 2D Map
 * switch has it:
 *  - 2D: the flat map (GameMap), its view held still (`lockCamera`). To zoom,
 *    the player opens a world on its own.
 *  - Globe: the globe (GlobeMap), turned and zoomed as the single globe is,
 *    and spinning on other players' turns while the player's Spin is on.
 *    Without WebGL, the flat maps stand in.
 * Either way its targets read across lanes (`targetsAcrossWorlds`): pick a
 * gateway in one pane and the system it can strike lights in the next. Clicks,
 * selection and visual events are the single map's: the selection lives in
 * the shared UI store, and a pane plays only the events on its own world.
 *
 * The lanes run across the grid, gateway to gateway, drawn as the chart draws
 * them (galaxyLaneStyle.ts) over the maps: each pane reports where it drew its
 * systems (`onTerritoryCenters`), and its own lane stubs are turned off. A
 * globe reports again as it turns; a gateway round the back of its planet, or
 * off a zoomed globe's pane, draws its lane dimmed to the edge where it left
 * the view. A picked gateway's lanes stand out.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps } from 'react';
import { Maximize2 } from 'lucide-react';
import { inferWorldId } from '@borderfall/shared';
import GameMap from './GameMap';
import type GlobeMap from './GlobeMap';
import type { GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import type { GalaxyMapDatum } from './GalaxyStrategicView';
import { buildWorldNodes, type WorldNode } from './galaxyStrategicLayout';
import { laneStroke } from './galaxyLaneStyle';
import {
  splitLanes,
  splitLayout,
  type PaneCenter,
  type SplitCell,
  type SplitGeometry,
  type SplitWorld,
} from '../../utils/galaxySplitLayout';
import { laneKindOf, laneSealFor, laneStateFor, worldDisplayName } from '../../utils/galaxyLanes';
import { GlobeMapCoreLazy } from '../../utils/globeLoader';
import { webglAvailable } from '../../utils/webglSupport';
import { galaxyWorldGlobeProps } from '../../utils/galaxyGlobeSkin';
import { proceduralWorldTextureUrl } from '../../utils/proceduralPlanet';

type GameMapProps = ComponentProps<typeof GameMap>;
type GlobeMapProps = ComponentProps<typeof GlobeMap>;

/** What every flat pane's map shares with the single 2D map; the view sets the rest. */
export type SplitPaneMapProps = Omit<
  GameMapProps,
  | 'mapData'
  | 'activeWorldId'
  | 'width'
  | 'height'
  | 'moonInset'
  | 'resetViewRef'
  | 'lockCamera'
  | 'targetsAcrossWorlds'
  | 'ambientEnabled'
  | 'showOrbitStubs'
  | 'onTerritoryCenters'
>;

/**
 * What every globe pane shares with the single globe; the view sets the rest.
 * `skipAnimationsRef` and `onGlobeReady` answer for the whole view: the ref
 * flushes every pane's queue, and ready means every pane's globe is drawn.
 */
export type SplitPaneGlobeProps = Omit<
  GlobeMapProps,
  | 'mapData'
  | 'activeWorldId'
  | 'width'
  | 'height'
  | 'globeImageUrl'
  | 'bumpImageUrl'
  | 'showAtmosphere'
  | 'atmosphereColor'
  | 'atmosphereAltitude'
  | 'backgroundColor'
  | 'ambientEnabled'
  | 'previewMode'
  | 'targetsAcrossWorlds'
  | 'showOrbitStubs'
  | 'ownWorldEffectsOnly'
  | 'onTerritoryCenters'
  | 'releaseContextOnUnmount'
>;

export interface GalaxySplitViewProps {
  mapData: GalaxyMapDatum & GameMapProps['mapData'] & GlobeMapProps['mapData'];
  gameState: GameState | null;
  width: number;
  height: number;
  /** The viewer, whose share of each world its header counts. */
  viewerPlayerId?: string | null;
  /** The flat panes' maps. */
  mapProps: SplitPaneMapProps;
  /** Draw each world as a globe, as the page's Globe view does: what the globe panes share. */
  globeProps?: SplitPaneGlobeProps;
  /** Open one world on its own, as its world tab does. */
  onOpenWorld: (worldId: string) => void;
  /** The viewer may cross lanes at all; when not, every lane reads as locked, as on the chart. */
  laneAccessAllowed?: boolean;
}

/** Space between panes, and each pane's header above its map. */
export const SPLIT_GAP_PX = 6;
export const SPLIT_HEADER_PX = 30;
/** GameMap's border: its canvas starts this far inside the map box. A globe has none. */
const MAP_BORDER_PX = 1;
/** The chart's colour for a viewer with no colour of their own. */
const GOLD = '#e6b34d';

type Centers = ReadonlyMap<string, PaneCenter>;

/**
 * Where each pane drew its systems, by world. A globe reports on every frame it
 * turns, so the lanes subscribe to this on their own and the panes do not
 * re-render with them.
 */
function createCentersStore() {
  let centers: Readonly<Record<string, Centers>> = {};
  const listeners = new Set<() => void>();
  return {
    get: () => centers,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report: (worldId: string, next: Centers) => {
      if (centers[worldId] === next) return;
      centers = { ...centers, [worldId]: next };
      for (const listener of listeners) listener();
    },
  };
}
type CentersStore = ReturnType<typeof createCentersStore>;

/** Each owner's share of the world in their colour, the unclaimed rest left as track. */
function OwnershipBar({ node, viewerPlayerId }: { node: WorldNode; viewerPlayerId?: string | null }) {
  const viewer = viewerPlayerId ? node.ownership.find((s) => s.player_id === viewerPlayerId) : undefined;
  const neutral = node.territory_count - node.ownership.reduce((n, s) => n + s.count, 0);
  const parts = node.ownership.map((s) => `${s.player_id === viewerPlayerId ? 'You' : s.name} ${s.count}`);
  if (neutral > 0) parts.push(`unclaimed ${neutral}`);
  const label = `${node.display_name}, ${node.territory_count} systems: ${parts.join(', ')}`;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        role="img"
        aria-label={label}
        title={label}
        className="flex h-2 min-w-[40px] flex-1 gap-[2px] overflow-hidden rounded-full bg-bf-border/50"
      >
        {node.ownership.map((s) => (
          <div key={s.player_id} style={{ flexGrow: s.count, flexBasis: 0, backgroundColor: s.color }} />
        ))}
        {neutral > 0 && <div style={{ flexGrow: neutral, flexBasis: 0 }} />}
      </div>
      {viewer && (
        <span className="shrink-0 text-[11px] tabular-nums text-bf-muted">
          {viewer.count}/{node.territory_count}
        </span>
      )}
    </div>
  );
}

interface SplitLanesProps {
  store: CentersStore;
  connections: GalaxySplitViewProps['mapData']['connections'];
  worldOf: (territoryId: string) => string | undefined;
  cells: ReadonlyArray<SplitCell<SplitWorld>>;
  geometry: SplitGeometry;
  width: number;
  height: number;
  gameState: GameState | null;
  viewerPlayerId?: string | null;
  viewerColor: string;
  laneAccessAllowed: boolean;
}

/** The lanes, over the maps; clicks pass through to the systems beneath. */
function SplitLanes({
  store,
  connections,
  worldOf,
  cells,
  geometry,
  width,
  height,
  gameState,
  viewerPlayerId,
  viewerColor,
  laneAccessAllowed,
}: SplitLanesProps) {
  const centers = useSyncExternalStore(store.subscribe, store.get);
  const lanes = useMemo(
    () => splitLanes(connections, worldOf, cells, centers, geometry),
    [connections, worldOf, cells, centers, geometry],
  );
  const { selectedTerritory, attackSource } = useUiStore();
  const picked = attackSource ?? selectedTerritory;
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={width}
      height={height}
      aria-hidden
      data-testid="galaxy-split-lanes"
    >
      {lanes.map((lane) => {
        const seal = gameState ? laneSealFor(gameState, lane.from, lane.to) : null;
        const state = gameState ? laneStateFor(gameState, lane.from, lane.to, viewerPlayerId) : 'closed';
        const style = laneStroke({
          sealed: !!seal,
          accessAllowed: laneAccessAllowed,
          state,
          kind: laneKindOf(lane.source),
          viewerColor,
        });
        const isPicked = picked === lane.from || picked === lane.to;
        // A gateway out of sight dims its lane: the lane leaves the view there.
        const outOfSight = lane.hidden1 || lane.hidden2;
        const opacity = (isPicked ? 1 : 0.75) * (outOfSight ? 0.5 : 1);
        return (
          <g
            key={lane.key}
            data-lane={lane.key}
            data-picked={isPicked || undefined}
            data-out-of-sight={outOfSight || undefined}
            opacity={opacity}
          >
            <line
              x1={lane.x1}
              y1={lane.y1}
              x2={lane.x2}
              y2={lane.y2}
              stroke={style.stroke}
              strokeWidth={isPicked ? style.strokeWidth + 1.2 : style.strokeWidth}
              strokeDasharray={style.dash}
              strokeLinecap="round"
            />
            {!lane.hidden1 && <circle cx={lane.x1} cy={lane.y1} r={3} fill={style.stroke} />}
            {!lane.hidden2 && <circle cx={lane.x2} cy={lane.y2} r={3} fill={style.stroke} />}
          </g>
        );
      })}
    </svg>
  );
}

export default function GalaxySplitView({
  mapData,
  gameState,
  width,
  height,
  viewerPlayerId,
  mapProps,
  globeProps,
  onOpenWorld,
  laneAccessAllowed = true,
}: GalaxySplitViewProps) {
  // The chart's own inputs, so a world's header and its chart node agree.
  const ownerOf = useCallback(
    (tid: string): string | null => gameState?.territories[tid]?.owner_id ?? null,
    [gameState],
  );
  const playerInfo = useCallback(
    (pid: string) => {
      const p = gameState?.players.find((pl) => pl.player_id === pid);
      return p ? { color: p.color, name: p.username } : null;
    },
    [gameState],
  );
  const displayNameOf = useCallback((wid: string) => worldDisplayName(mapData, wid), [mapData]);
  const authoredPositionOf = useCallback(
    (wid: string) => mapData.worlds?.find((w) => w.world_id === wid)?.galaxy_position,
    [mapData.worlds],
  );
  const nodes = useMemo(
    () => buildWorldNodes(mapData.territories, { ownerOf, playerInfo, displayNameOf, authoredPositionOf }),
    [mapData.territories, ownerOf, playerInfo, displayNameOf, authoredPositionOf],
  );
  const layout = useMemo(() => splitLayout(nodes), [nodes]);

  const paneWidth = Math.max(120, Math.floor((width - SPLIT_GAP_PX * (layout.cols - 1)) / layout.cols));
  const paneHeight = Math.max(
    90,
    Math.floor((height - SPLIT_GAP_PX * (layout.rows - 1)) / layout.rows) - SPLIT_HEADER_PX,
  );
  const gridWidth = layout.cols * paneWidth + (layout.cols - 1) * SPLIT_GAP_PX;
  const gridHeight = layout.rows * (paneHeight + SPLIT_HEADER_PX) + (layout.rows - 1) * SPLIT_GAP_PX;

  // Globes when the page shows globes and the browser can draw them.
  const wantsGlobes = !!globeProps;
  const globes = wantsGlobes && webglAvailable();

  // Where each pane drew its systems. A flat map and a globe put a system in
  // different places, so a change of pane starts a new record.
  const store = useMemo(() => createCentersStore(), [globes]);
  const reporters = useMemo(() => new Map<string, (c: Centers) => void>(), [store]);
  const reportCentersFor = (worldId: string) => {
    let report = reporters.get(worldId);
    if (!report) {
      report = (c: Centers) => store.report(worldId, c);
      reporters.set(worldId, report);
    }
    return report;
  };
  const worldOf = useMemo(() => {
    const m = new Map(mapData.territories.map((t) => [t.territory_id, inferWorldId(t)]));
    return (tid: string) => m.get(tid);
  }, [mapData.territories]);
  const geometry = useMemo<SplitGeometry>(
    () => ({
      paneWidth,
      paneHeight,
      gap: SPLIT_GAP_PX,
      header: SPLIT_HEADER_PX,
      inset: globes ? 0 : MAP_BORDER_PX,
    }),
    [paneWidth, paneHeight, globes],
  );
  const viewerColor = (viewerPlayerId && playerInfo(viewerPlayerId)?.color) || GOLD;

  // Ready, for the turn-ready ack, once every pane's globe is drawn: each time
  // the globes come up. Without WebGL the flat panes stand in, drawn at once.
  const onGlobeReadyRef = useRef(globeProps?.onGlobeReady);
  onGlobeReadyRef.current = globeProps?.onGlobeReady;
  const worldIdsRef = useRef<string[]>([]);
  worldIdsRef.current = layout.cells.map((c) => c.world.world_id);
  const readiness = useMemo(() => ({ ready: new Set<string>(), told: false }), [globes]);
  const globeReadyFor = (worldId: string) => () => {
    readiness.ready.add(worldId);
    if (readiness.told || !worldIdsRef.current.every((w) => readiness.ready.has(w))) return;
    readiness.told = true;
    onGlobeReadyRef.current?.();
  };
  useEffect(() => {
    if (wantsGlobes && !globes) onGlobeReadyRef.current?.();
  }, [wantsGlobes, globes]);

  // The page's "skip animations" flushes every globe pane's queue.
  const paneSkips = useRef(new Map<string, { current: (() => void) | null }>());
  const skipRefFor = (worldId: string) => {
    let ref = paneSkips.current.get(worldId);
    if (!ref) {
      ref = { current: null };
      paneSkips.current.set(worldId, ref);
    }
    return ref;
  };
  const skipAnimationsRef = globeProps?.skipAnimationsRef;
  useEffect(() => {
    if (!skipAnimationsRef || !globes) return;
    skipAnimationsRef.current = () => {
      for (const ref of paneSkips.current.values()) ref.current?.();
    };
    return () => {
      skipAnimationsRef.current = null;
    };
  }, [skipAnimationsRef, globes]);

  return (
    <div className="relative" style={{ width: gridWidth, height: gridHeight }} data-testid="galaxy-split-view">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, ${paneWidth}px)`,
          gridTemplateRows: `repeat(${layout.rows}, ${paneHeight + SPLIT_HEADER_PX}px)`,
          gap: SPLIT_GAP_PX,
        }}
      >
        {layout.cells.map(({ world, row, col }) => (
          <section
            key={world.world_id}
            aria-label={world.display_name}
            className="flex min-w-0 flex-col"
            style={{ gridRow: row + 1, gridColumn: col + 1 }}
            data-world-id={world.world_id}
          >
            <div className="flex items-center gap-2 px-1" style={{ height: SPLIT_HEADER_PX }}>
              <h3 className="max-w-[45%] truncate font-display text-sm text-bf-gold">{world.display_name}</h3>
              <OwnershipBar node={world} viewerPlayerId={viewerPlayerId} />
              <button
                type="button"
                onClick={() => onOpenWorld(world.world_id)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-bf-border text-bf-muted hover:border-bf-gold/60 hover:text-bf-gold"
                aria-label={`Open ${world.display_name}`}
                title={`Open ${world.display_name}`}
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            {/* Sized to the canvas: the map's box fills its parent, which here includes the header. */}
            <div style={{ width: paneWidth, height: paneHeight }}>
              {globeProps && globes ? (
                <Suspense
                  fallback={(
                    <div className="flex h-full items-center justify-center">
                      <p className="animate-pulse text-sm text-bf-muted">Loading globe…</p>
                    </div>
                  )}
                >
                  <GlobeMapCoreLazy
                    {...globeProps}
                    {...galaxyWorldGlobeProps(mapData.worlds, world.world_id, proceduralWorldTextureUrl(world.world_id))}
                    mapData={mapData}
                    activeWorldId={world.world_id}
                    width={paneWidth}
                    height={paneHeight}
                    ambientEnabled={false}
                    targetsAcrossWorlds
                    showOrbitStubs={false}
                    ownWorldEffectsOnly
                    releaseContextOnUnmount
                    onTerritoryCenters={reportCentersFor(world.world_id)}
                    skipAnimationsRef={skipRefFor(world.world_id)}
                    onGlobeReady={globeReadyFor(world.world_id)}
                  />
                </Suspense>
              ) : (
                <GameMap
                  {...mapProps}
                  mapData={mapData}
                  activeWorldId={world.world_id}
                  width={paneWidth}
                  height={paneHeight}
                  lockCamera
                  targetsAcrossWorlds
                  ambientEnabled={false}
                  showOrbitStubs={false}
                  onTerritoryCenters={reportCentersFor(world.world_id)}
                />
              )}
            </div>
          </section>
        ))}
      </div>
      <SplitLanes
        store={store}
        connections={mapData.connections}
        worldOf={worldOf}
        cells={layout.cells}
        geometry={geometry}
        width={gridWidth}
        height={gridHeight}
        gameState={gameState}
        viewerPlayerId={viewerPlayerId}
        viewerColor={viewerColor}
        laneAccessAllowed={laneAccessAllowed}
      />
    </div>
  );
}
