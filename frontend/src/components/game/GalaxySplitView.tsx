/**
 * Galactic Age — Split: every world's map at once, one pane per world.
 *
 * The galaxy chart (GalaxyStrategicView) shows each world as one node, and a
 * world tab opens one world's map; Split shows all of them as full flat maps,
 * so the player reads every front without cycling through the tabs. Panes sit
 * in the chart's ring order (utils/galaxySplitLayout.ts), so the worlds a lane
 * joins are side by side.
 *
 * Each pane is the ordinary 2D map (GameMap) drawing one world, with its view
 * held still (`lockCamera`) and its targets read across lanes
 * (`targetsAcrossWorlds`): pick a gateway in one pane and the system it can
 * strike lights in the next. Clicks, selection and visual events are the single
 * map's: the selection lives in the shared UI store, and a pane animates only
 * the territories it draws. To zoom, the player opens a world on its own.
 *
 * The lanes run across the grid, gateway to gateway, drawn as the chart draws
 * them (galaxyLaneStyle.ts) over the maps: each pane reports where it drew its
 * systems (`onTerritoryCenters`), and its own lane stubs are turned off. A
 * picked gateway's lanes stand out.
 *
 * Flat maps only: a globe shows half a world at a time, which is what Split is
 * for, and four WebGL globes on one screen cost too much.
 */

import { useCallback, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Maximize2 } from 'lucide-react';
import { inferWorldId } from '@borderfall/shared';
import GameMap from './GameMap';
import type { GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import type { GalaxyMapDatum } from './GalaxyStrategicView';
import { buildWorldNodes, type WorldNode } from './galaxyStrategicLayout';
import { laneStroke } from './galaxyLaneStyle';
import { splitLanes, splitLayout } from '../../utils/galaxySplitLayout';
import { laneKindOf, laneSealFor, laneStateFor, worldDisplayName } from '../../utils/galaxyLanes';

type GameMapProps = ComponentProps<typeof GameMap>;

/** What every pane's map shares with the single 2D map; the view sets the rest. */
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

export interface GalaxySplitViewProps {
  mapData: GalaxyMapDatum & GameMapProps['mapData'];
  gameState: GameState | null;
  width: number;
  height: number;
  /** The viewer, whose share of each world its header counts. */
  viewerPlayerId?: string | null;
  mapProps: SplitPaneMapProps;
  /** Open one world on its own, as its world tab does. */
  onOpenWorld: (worldId: string) => void;
  /** The viewer may cross lanes at all; when not, every lane reads as locked, as on the chart. */
  laneAccessAllowed?: boolean;
}

/** Space between panes, and each pane's header above its map. */
export const SPLIT_GAP_PX = 6;
export const SPLIT_HEADER_PX = 30;
/** GameMap's border: its canvas starts this far inside the map box. */
const MAP_BORDER_PX = 1;
/** The chart's colour for a viewer with no colour of their own. */
const GOLD = '#e6b34d';

type Centers = ReadonlyMap<string, { x: number; y: number }>;

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

export default function GalaxySplitView({
  mapData,
  gameState,
  width,
  height,
  viewerPlayerId,
  mapProps,
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

  // Where each pane drew its systems, by world: the lanes' ends.
  const [centers, setCenters] = useState<Record<string, Centers>>({});
  const reporters = useRef(new Map<string, (c: Centers) => void>());
  const reportCentersFor = (worldId: string) => {
    let report = reporters.current.get(worldId);
    if (!report) {
      report = (c: Centers) => setCenters((prev) => (prev[worldId] === c ? prev : { ...prev, [worldId]: c }));
      reporters.current.set(worldId, report);
    }
    return report;
  };
  const worldOf = useMemo(() => {
    const m = new Map(mapData.territories.map((t) => [t.territory_id, inferWorldId(t)]));
    return (tid: string) => m.get(tid);
  }, [mapData.territories]);
  const lanes = useMemo(
    () => splitLanes(mapData.connections, worldOf, layout.cells, centers, {
      paneWidth, paneHeight, gap: SPLIT_GAP_PX, header: SPLIT_HEADER_PX, inset: MAP_BORDER_PX,
    }),
    [mapData.connections, worldOf, layout.cells, centers, paneWidth, paneHeight],
  );
  const { selectedTerritory, attackSource } = useUiStore();
  const picked = attackSource ?? selectedTerritory;
  const viewerColor = (viewerPlayerId && playerInfo(viewerPlayerId)?.color) || GOLD;

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
            </div>
          </section>
        ))}
      </div>
      {/* The lanes, over the maps; clicks pass through to the systems beneath. */}
      <svg
        className="pointer-events-none absolute left-0 top-0"
        width={gridWidth}
        height={gridHeight}
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
          return (
            <g key={lane.key} data-lane={lane.key} data-picked={isPicked || undefined} opacity={isPicked ? 1 : 0.75}>
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
              <circle cx={lane.x1} cy={lane.y1} r={3} fill={style.stroke} />
              <circle cx={lane.x2} cy={lane.y2} r={3} fill={style.stroke} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
