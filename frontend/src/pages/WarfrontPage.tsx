import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BIOME_NAMES,
  BUILDING_SPECS,
  NEAREST_PASSABLE_RADIUS,
  Sim,
  UnitKind,
  cellBeach,
  cellFord,
  cellPass,
  toIntFloor,
  type BuildingKindValue,
  type TerrainGrid,
  type UnitKindValue,
} from '@borderfall/warfront-sim';
import WarfrontTerrainCanvas from '../components/warfront/WarfrontTerrainCanvas';
import WarfrontProvincePanel from '../components/warfront/WarfrontProvincePanel';
import WarfrontResourceBar from '../components/warfront/WarfrontResourceBar';
import WarfrontCommandBar from '../components/warfront/WarfrontCommandBar';
import { AlertQueue, URGENT_ALERTS, blockedUnitIds, type Alert } from '../warfront/alerts';
import { MatchWatch } from '../warfront/watch';
import { computeProvinceStats, type ProvinceStats } from '../warfront/provinceStats';
import {
  buildOptions as buildOptionsFor,
  buildingView,
  buildingsInProvince,
  coloniseView,
  provinceHolding,
  resourceView,
  trainOptions as trainOptionsFor,
} from '../warfront/economyView';
import { buildingAtPoint, cellAtPoint } from '../warfront/picking';
import type { Camera } from '../warfront/camera';
import { SimRunner, type UnitView } from '../warfront/simRunner';
import {
  CONTROL_GROUP_KEYS,
  ControlGroups,
  applySelection,
  formationTargets,
  pruneSelection,
  unitAtPoint,
  unitsInRect,
  type WorldRect,
} from '../warfront/selection';
import { moveTarget } from '../warfront/orders';
import { buildOpeningScenario } from '../warfront/matchScenario';
import { fetchWarfrontTerrain } from '../services/warfrontApi';

/**
 * Warfront tactical view — Slice A step 3.
 *
 * Admin-only. The route is wrapped `<PrivateRoute><AdminRoute>` in App.tsx and the
 * endpoint it calls is admin-guarded server-side; the terrain endpoint also 404s while
 * `warfront_enabled` is off, which is the "flag is off" state below. See the isolation
 * rule in CLAUDE.md: nothing here may affect the live Borderfall game.
 *
 * What works now: the whole economy loop. A seat, villagers you assign to buildings
 * rather than order about (rule II), buildings the terrain decides you may raise (rule
 * IV), provinces colonised at a rising price (rule I) and lost with their seat (rule
 * III), and tribes that raid you from minute two (rule VI). What does not exist yet:
 * the sea, attrition and camps, doctrines, and any opponent but the tribes.
 */

/** Seat province the opening is played from — Gaul, the widest land frontier. */
const OPENING_PROVINCE = 'lugdunensis';
/** The seat the local player is playing. One seat until there are bots to play the rest. */
const VIEWER_OWNER = 1;
/** Click tolerance when picking a single unit, in cells. */
const PICK_RADIUS_CELLS = 3;
/** Spacing between units in a group order, in cells. */
const FORMATION_SPACING_CELLS = 2;
/**
 * How long to keep watching for a building site to appear before giving up on sending
 * the rest of the selected villagers to help. A build the simulation refused never
 * appears, and a promise left waiting forever would eventually assign villagers to some
 * unrelated building that happened to be raised on the same cell later.
 */
const PENDING_BUILD_TICKS = 30;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; grid: TerrainGrid; runner: SimRunner; originCell: number; stats: ProvinceStats[] };

const ALERT_TONE: Record<string, string> = {
  raid: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  loss: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  seat: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  hunger: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
};

export default function WarfrontPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hoverCell, setHoverCell] = useState(-1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const [placingKind, setPlacingKind] = useState<BuildingKindValue | null>(null);
  const [hud, setHud] = useState({ ticks: 0, units: 0 });
  const groupsRef = useRef(new ControlGroups());
  const [groupSlots, setGroupSlots] = useState<number[]>([]);
  const alertsRef = useRef(new AlertQueue());
  const watchRef = useRef(new MatchWatch());
  const pendingBuildRef = useRef<{ cell: number; helpers: number[]; until: number } | null>(null);
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);
  const [focus, setFocus] = useState<{ cell: number; nonce: number } | null>(null);
  const focusNonceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const grid = await fetchWarfrontTerrain();
        const { scenario, seatCell } = buildOpeningScenario(grid, {
          territoryId: OPENING_PROVINCE,
          owner: VIEWER_OWNER,
        });
        // A fixed seed: this view is a lab, and a stable seed makes what you see
        // reproducible from one reload to the next — including which tribe raids first.
        const runner = new SimRunner(new Sim({ seed: 20260913, scenario, terrain: grid }));
        // Computed once: the panel needs per-province counts, and recomputing them on
        // every pointer move would rescan ~600k cells.
        const stats = computeProvinceStats(grid);
        if (!cancelled) {
          setState({ kind: 'ready', grid, runner, originCell: seatCell, stats });
          setFocus({ cell: seatCell, nonce: ++focusNonceRef.current });
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
        // 404 is the flag gate, not a missing asset: the endpoint exists for admins and
        // answers only once warfront_enabled is on.
        if (err?.response?.status === 404) {
          setState({ kind: 'disabled' });
          return;
        }
        setState({ kind: 'error', message: err?.response?.data?.error ?? err?.message ?? 'Failed to load terrain' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runner = state.kind === 'ready' ? state.runner : null;
  const grid = state.kind === 'ready' ? state.grid : null;

  /** Live unit views for hit tests. Read on demand rather than kept in React state. */
  const currentUnits = useCallback((): UnitView[] => (runner ? runner.positions() : []), [runner]);

  /** Centres the camera on a cell. The nonce makes a repeated jump to the same cell work. */
  const jumpTo = useCallback((cell: number) => {
    if (cell < 0) return;
    setFocus({ cell, nonce: ++focusNonceRef.current });
  }, []);

  const raise = useCallback((kind: Alert['kind'], message: string, cell: number, tick: number) => {
    if (alertsRef.current.push(kind, message, cell, tick)) setAlerts([...alertsRef.current.list()]);
  }, []);

  /** Villagers of yours in the current selection — the only units rule II lets you employ. */
  const selectedVillagers = useMemo(() => {
    if (!runner) return [];
    const out: number[] = [];
    for (const id of selected) {
      const unit = runner.sim.entities.get(id);
      if (unit && unit.owner === VIEWER_OWNER && unit.kind === UnitKind.Villager) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }, [runner, selected]);

  /** Sends every selected villager to work a building. Rule II in one call. */
  const assignTo = useCallback(
    (buildingId: number, villagers: readonly number[]) => {
      if (!runner || villagers.length === 0) return;
      for (const id of villagers) runner.sim.issue({ type: 'assign', unit: id, building: buildingId });
    },
    [runner],
  );

  const onSelectPoint = useCallback(
    (wx: number, wy: number, additive: boolean) => {
      if (!runner || !grid) return;

      // Siting a building takes precedence over everything: the player asked for a spot.
      if (placingKind !== null) {
        const cell = cellAtPoint(grid, wx, wy);
        const builder = selectedVillagers[0];
        if (cell >= 0 && builder !== undefined) {
          runner.sim.issue({ type: 'build', unit: builder, kind: placingKind, cell });
          // The rest of the selection joins as builders once the site actually exists —
          // its id cannot be known until the command lands, two ticks from now.
          pendingBuildRef.current = {
            cell,
            helpers: selectedVillagers.slice(1),
            until: runner.ticks + PENDING_BUILD_TICKS,
          };
        }
        setPlacingKind(null);
        return;
      }

      const hitBuilding = buildingAtPoint(runner.sim, grid, wx, wy);
      if (hitBuilding !== null) {
        const building = runner.sim.buildings.get(hitBuilding)!;
        setSelectedBuilding(hitBuilding);
        // Rule II: villagers are assigned by clicking the building they are to work.
        if (building.owner === VIEWER_OWNER && BUILDING_SPECS[building.kind].workerSlots > 0) {
          assignTo(hitBuilding, selectedVillagers);
        }
        return;
      }

      const hit = unitAtPoint(currentUnits(), wx, wy, PICK_RADIUS_CELLS);
      if (hit !== null) setSelectedBuilding(null);
      setSelected((prev) => applySelection(prev, hit == null ? [] : [hit], additive));
    },
    [runner, grid, placingKind, selectedVillagers, assignTo, currentUnits],
  );

  const onSelectRect = useCallback(
    (rect: WorldRect, additive: boolean) => {
      setSelectedBuilding(null);
      setSelected((prev) => applySelection(prev, unitsInRect(currentUnits(), rect), additive));
    },
    [currentUnits],
  );

  const onOrder = useCallback(
    (wx: number, wy: number) => {
      if (!runner || !grid || selected.size === 0) return;
      // The simulation redirects an order onto impassable ground to the nearest walkable
      // cell, and drops it entirely when there is none within that radius. Checking the
      // same rule here is what lets the player be told, rather than watching an order
      // vanish silently.
      const col = Math.min(Math.max(Math.floor(wx), 0), grid.width - 1);
      const row = Math.min(Math.max(Math.floor(wy), 0), grid.height - 1);
      const target = grid.index(col, row);
      if (grid.nearestPassable(target, NEAREST_PASSABLE_RADIUS) < 0) {
        raise('no-route', 'Nothing can march there — no walkable ground nearby.', target, runner.ticks);
        return;
      }
      // Stable order so the same click always assigns the same unit to the same slot.
      const ids = [...selected].sort((a, b) => a - b);
      const targets = formationTargets(ids.length, wx, wy, FORMATION_SPACING_CELLS);
      ids.forEach((id, i) => {
        const t = moveTarget(grid, targets[i].x, targets[i].y);
        runner.sim.issue({ type: 'move', unit: id, x: t.x, y: t.y });
      });
    },
    [runner, grid, selected, raise],
  );

  const onColonise = useCallback(() => {
    if (!runner) return;
    const unit = selectedVillagers[0];
    if (unit === undefined) return;
    const view = coloniseView(runner.sim, unit);
    if (!view.ready) return;
    runner.sim.issue({ type: 'colonise', unit, province: view.provinceIndex });
  }, [runner, selectedVillagers]);

  const onTrain = useCallback(
    (kind: UnitKindValue) => {
      if (!runner || selectedBuilding === null) return;
      runner.sim.issue({ type: 'train', building: selectedBuilding, unit: kind });
    },
    [runner, selectedBuilding],
  );

  // Selection keys. The plane owns the camera keys; this owns the selection, so control
  // groups live here.
  useEffect(() => {
    if (!runner) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = e.key;
      if (key === 'Escape') {
        // Cancel the pending placement first: Escape means "not that", and clearing the
        // selection instead would leave the player siting a building with nobody to build it.
        if (placingKind !== null) {
          setPlacingKind(null);
          return;
        }
        setSelected(new Set());
        setSelectedBuilding(null);
        return;
      }
      // The jump key: the design gives every alert one, so nobody hunts for the thing
      // demanding attention.
      if (key === ' ') {
        e.preventDefault();
        const latest = alertsRef.current.latest();
        if (latest) jumpTo(latest.cell);
        return;
      }
      const slot = CONTROL_GROUP_KEYS.indexOf(key as (typeof CONTROL_GROUP_KEYS)[number]);
      if (slot < 0) return;
      e.preventDefault();
      const units = runner.positions();
      if (e.ctrlKey || e.metaKey) {
        groupsRef.current.assign(slot, selected);
        setGroupSlots(groupsRef.current.occupied(units));
      } else {
        setSelected(new Set(groupsRef.current.recall(slot, units)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runner, selected, placingKind, jumpTo]);

  // Never let a selection outlive its units — raids kill villagers, so this now bites.
  useEffect(() => {
    if (!runner) return;
    setSelected((prev) => {
      const pruned = pruneSelection(prev, runner.positions());
      return pruned.size === prev.size ? prev : pruned;
    });
    setSelectedBuilding((prev) => (prev !== null && !runner.sim.buildings.get(prev) ? null : prev));
  }, [runner, hud.units, hud.ticks]);

  const onCameraChange = useCallback((next: Camera) => setCamera(next), []);
  const onHoverCell = useCallback((cell: number) => setHoverCell(cell), []);
  const onFrame = useCallback(
    (info: { ticks: number; units: number }) => {
      setHud(info);
      if (!runner || !grid) return;

      // A unit that has stopped short of its goal is the simulation reporting that no
      // land route exists — worth saying out loud on a map whose whole point is terrain.
      for (const id of blockedUnitIds(runner.sim)) {
        const unit = runner.sim.entities.get(id);
        if (!unit || unit.owner !== VIEWER_OWNER) continue;
        const cell = grid.index(toIntFloor(unit.x), toIntFloor(unit.y));
        raise('blocked', 'A unit stopped: terrain blocks the route.', cell, runner.ticks);
      }

      // Raids, losses, fallen seats and hunger, derived from the state itself.
      for (const pending of watchRef.current.poll(runner.sim, VIEWER_OWNER)) {
        raise(pending.kind, pending.message, pending.cell, runner.ticks);
      }

      // A building site that has appeared gets the rest of its builders.
      const pending = pendingBuildRef.current;
      if (pending) {
        const site = runner.sim.buildings.atCell(pending.cell);
        if (site && site.owner === VIEWER_OWNER) {
          assignTo(site.id, pending.helpers);
          pendingBuildRef.current = null;
        } else if (runner.ticks > pending.until) {
          pendingBuildRef.current = null;
        }
      }
    },
    [runner, grid, raise, assignTo],
  );

  const statsByIndex = useMemo(() => {
    const map = new Map<number, ProvinceStats>();
    if (state.kind === 'ready') for (const entry of state.stats) map.set(entry.index, entry);
    return map;
  }, [state]);

  const hoveredProvince = useMemo(
    () => (grid && hoverCell >= 0 ? (statsByIndex.get(grid.owner(hoverCell)) ?? null) : null),
    [grid, hoverCell, statsByIndex],
  );

  /** Selected units standing in the hovered province. Refreshes with the HUD tick. */
  const unitsHere = useMemo(() => {
    if (!runner || !grid || !hoveredProvince) return 0;
    let count = 0;
    for (const id of selected) {
      const unit = runner.sim.entities.get(id);
      if (!unit) continue;
      if (grid.owner(grid.index(toIntFloor(unit.x), toIntFloor(unit.y))) === hoveredProvince.index) count += 1;
    }
    return count;
    // hud.ticks is a deliberate dependency: units move, so this must not be frozen.
  }, [runner, grid, hoveredProvince, selected, hud.ticks]);

  // Everything below is read fresh from the simulation on every HUD tick, because the
  // simulation is the only copy of this state that exists. `hud.ticks` is therefore a
  // deliberate dependency of each memo below rather than an accident: nothing else
  // changes identity when the simulation advances, so without it these would freeze at
  // the opening position and the panels would quietly lie.
  const resources = useMemo(
    () => (runner ? resourceView(runner.sim, VIEWER_OWNER) : null),
    [runner, hud.ticks],
  );

  const provinceBuildings = useMemo(
    () => (runner && hoveredProvince ? buildingsInProvince(runner.sim, hoveredProvince.index) : []),
    [runner, hoveredProvince, hud.ticks],
  );

  const holding = useMemo(
    () => (runner && hoveredProvince ? provinceHolding(runner.sim, hoveredProvince.index) : null),
    [runner, hoveredProvince, hud.ticks],
  );

  const buildOptions = useMemo(
    () => (runner ? buildOptionsFor(runner.sim, VIEWER_OWNER, placingKind === null ? -1 : hoverCell) : []),
    [runner, placingKind, hoverCell, hud.ticks],
  );

  const colonise = useMemo(
    () => (runner && selectedVillagers.length > 0 ? coloniseView(runner.sim, selectedVillagers[0]) : null),
    [runner, selectedVillagers, hud.ticks],
  );

  const selectedBuildingView = useMemo(() => {
    if (!runner || selectedBuilding === null) return null;
    const building = runner.sim.buildings.get(selectedBuilding);
    return building ? buildingView(runner.sim, building) : null;
  }, [runner, selectedBuilding, hud.ticks]);

  const trainOptions = useMemo(() => {
    if (!runner || selectedBuilding === null) return [];
    const building = runner.sim.buildings.get(selectedBuilding);
    return building && building.owner === VIEWER_OWNER ? trainOptionsFor(runner.sim, building) : [];
  }, [runner, selectedBuilding, hud.ticks]);

  const hover = useMemo(() => {
    if (!grid || hoverCell < 0) return null;
    const value = grid.value(hoverCell);
    const owner = grid.owner(hoverCell);
    const province = owner > 0 ? grid.provinces[owner - 1] : null;
    const flags = [
      cellFord(value) ? 'ford' : null,
      cellPass(value) ? 'pass' : null,
      cellBeach(value) ? 'beach' : null,
    ].filter(Boolean) as string[];
    return {
      col: grid.colOf(hoverCell),
      row: grid.rowOf(hoverCell),
      province: province ? province.name : 'unclaimed',
      biome: BIOME_NAMES[grid.biome(hoverCell)] ?? 'unknown',
      tier: grid.tier(hoverCell),
      passable: grid.isPassable(hoverCell),
      flags,
    };
  }, [grid, hoverCell]);

  const seconds = (hud.ticks / 15).toFixed(1);

  return (
    <div className="flex h-screen flex-col bg-bf-dark text-bf-text">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bf-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">
            Warfront <span className="text-bf-muted">· tactical view</span>
          </h1>
          <p className="text-[11px] text-bf-muted">
            Experimental RTS mode, admin-only. One seat on real terrain — economy, colonisation and tribal raids.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {grid ? (
            <span className="text-bf-muted">
              {grid.width} × {grid.height} · {grid.cellKm} km cells
            </span>
          ) : null}
          {runner ? (
            <span className="text-bf-muted">
              tick {hud.ticks} · {seconds}s · {selected.size}/{hud.units} selected
            </span>
          ) : null}
          {camera ? <span className="text-bf-muted">{camera.scale.toFixed(2)} px/cell</span> : null}
          <Link to="/admin" className="rounded border border-bf-border px-2 py-1 hover:border-bf-gold hover:text-bf-gold">
            Back to Admin
          </Link>
        </div>
      </header>

      {state.kind === 'ready' ? <WarfrontResourceBar resources={resources} /> : null}

      <main className="flex min-h-0 flex-1">
        {state.kind === 'loading' ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-bf-muted">Loading terrain…</div>
        ) : null}

        {state.kind === 'disabled' ? (
          <div className="flex h-full w-full items-center justify-center px-6">
            <div className="max-w-md rounded-xl border border-bf-border bg-cc-panel/50 p-5 text-center">
              <p className="text-sm font-semibold">Warfront is switched off</p>
              <p className="mt-2 text-xs leading-relaxed text-bf-muted">
                The terrain endpoint answers only while <span className="font-mono">warfront_enabled</span> is on. Turn
                it on under Admin → Config → Feature flags, or set{' '}
                <span className="font-mono">WARFRONT_ENABLED=true</span>.
              </p>
              <Link
                to="/admin"
                className="mt-4 inline-block rounded border border-bf-gold/60 bg-bf-gold/10 px-3 py-1.5 text-xs text-bf-gold hover:bg-bf-gold/20"
              >
                Open Admin → Config
              </Link>
            </div>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className="flex h-full w-full items-center justify-center px-6">
            <div className="max-w-md rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {state.message}
            </div>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <div className="relative min-w-0 flex-1">
              <WarfrontTerrainCanvas
                grid={state.grid}
                runner={state.runner}
                selectedIds={selected}
                selectedBuildingId={selectedBuilding}
                placing={placingKind !== null}
                focus={focus}
                onSelectPoint={onSelectPoint}
                onSelectRect={onSelectRect}
                onOrder={onOrder}
                onCameraChange={onCameraChange}
                onHoverCell={onHoverCell}
                onFrame={onFrame}
              />

              {alerts.length > 0 ? (
                <div className="absolute right-3 top-3 w-64 space-y-1">
                  {alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => jumpTo(alert.cell)}
                      className={`block w-full rounded border px-2 py-1 text-left text-[11px] ${
                        ALERT_TONE[alert.kind] ?? 'border-bf-gold/50 bg-bf-dark/90 text-bf-gold hover:bg-bf-gold/10'
                      }`}
                    >
                      {URGENT_ALERTS.has(alert.kind) ? '⚑ ' : ''}
                      {alert.message}
                      <span className="ml-1 text-bf-muted">jump</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      alertsRef.current.clear();
                      setAlerts([]);
                    }}
                    className="block w-full rounded border border-bf-border bg-bf-dark/80 px-2 py-1 text-[10px] text-bf-muted hover:border-bf-gold"
                  >
                    Clear alerts
                  </button>
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-bf-border bg-bf-dark/85 px-3 py-2 text-[11px] leading-relaxed text-bf-muted">
                <div>
                  <span className="text-bf-text">Left</span> select, drag to box, click a building to assign ·{' '}
                  <span className="text-bf-text">Right</span> move
                </div>
                <div>
                  <span className="text-bf-text">Middle-drag</span> or <span className="text-bf-text">WASD</span> pan ·{' '}
                  <span className="text-bf-text">Wheel</span> zoom · <span className="text-bf-text">Esc</span> cancel
                </div>
                <div>
                  <span className="text-bf-text">Ctrl+1–9</span> set group · <span className="text-bf-text">1–9</span>{' '}
                  recall · <span className="text-bf-text">Space</span> jump to alert
                  {groupSlots.length > 0 ? (
                    <span className="text-bf-gold"> · groups {groupSlots.map((slot) => slot + 1).join(', ')}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <WarfrontProvincePanel
              province={hoveredProvince}
              cell={hover}
              unitsHere={unitsHere}
              holding={holding}
              buildings={provinceBuildings}
              viewerOwner={VIEWER_OWNER}
              selectedBuildingId={selectedBuilding}
              onSelectBuilding={setSelectedBuilding}
              onJump={jumpTo}
            />
          </>
        ) : null}
      </main>

      {state.kind === 'ready' ? (
        <WarfrontCommandBar
          villagerCount={selectedVillagers.length}
          buildOptions={buildOptions}
          placingKind={placingKind}
          onPickBuild={setPlacingKind}
          colonise={colonise}
          onColonise={onColonise}
          building={selectedBuildingView}
          trainOptions={trainOptions}
          onTrain={onTrain}
          onAssignSelected={() => {
            if (selectedBuilding !== null) assignTo(selectedBuilding, selectedVillagers);
          }}
        />
      ) : null}
    </div>
  );
}
