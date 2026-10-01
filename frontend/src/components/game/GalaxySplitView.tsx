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
 * Flat maps only: a globe shows half a world at a time, which is what Split is
 * for, and four WebGL globes on one screen cost too much.
 */

import { useCallback, useMemo, type ComponentProps } from 'react';
import { Maximize2 } from 'lucide-react';
import GameMap from './GameMap';
import type { GameState } from '../../store/gameStore';
import type { GalaxyMapDatum } from './GalaxyStrategicView';
import { buildWorldNodes, type WorldNode } from './galaxyStrategicLayout';
import { splitLayout } from '../../utils/galaxySplitLayout';
import { worldDisplayName } from '../../utils/galaxyLanes';

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
}

/** Space between panes, and each pane's header above its map. */
export const SPLIT_GAP_PX = 6;
export const SPLIT_HEADER_PX = 30;

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

  return (
    <div
      className="grid h-full w-full"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, ${paneWidth}px)`,
        gridTemplateRows: `repeat(${layout.rows}, ${paneHeight + SPLIT_HEADER_PX}px)`,
        gap: SPLIT_GAP_PX,
      }}
      data-testid="galaxy-split-view"
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
            />
          </div>
        </section>
      ))}
    </div>
  );
}
