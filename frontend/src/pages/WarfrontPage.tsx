import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BIOME_NAMES,
  BUILDING_SPECS,
  NEAREST_PASSABLE_RADIUS,
  Sim,
  UnitKind,
  type MatchResult,
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
import { buildSoloMatch, type SoloSetup } from '../warfront/soloMatch';
import WarfrontMatchSetup from '../components/warfront/WarfrontMatchSetup';
import WarfrontResult from '../components/warfront/WarfrontResult';
import { fetchWarfrontTerrain } from '../services/warfrontApi';

/**
 * Warfront tactical view — Slice A steps 2–4: a solo match against the lab's bots.
 *
 * Admin-only. The route is wrapped `<PrivateRoute><AdminRoute>` in App.tsx and the
 * endpoint it calls is admin-guarded server-side; the terrain endpoint also 404s while
 * `warfront_enabled` is off, which is the "flag is off" state below. See the isolation
 * rule in CLAUDE.md: nothing here may affect the live Borderfall game.
 *
 * What works now: the whole economy loop. A seat, villagers you assign to buildings
 * rather than order about (rule II), buildings the terrain decides you may raise (rule
 * IV), provinces colonised at a rising price (rule I) and lost with their seat (rule
 * III), tribes that raid you from minute two (rule VI), and up to three opponents played
 * by the lab's policies. The simulation also has the sea, attrition and camps (rules V,
 * VII), but this page gives the player no port, lighthouse, embark or camp controls yet;
 * the truce and doctrines do not exist.
 */

/** The seat the local player takes. The rest are played by the lab's own policies. */
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
  /** Terrain is in; the player is choosing who to play against. */
  | { kind: 'setup'; grid: TerrainGrid; stats: ProvinceStats[] }
  | {
      kind: 'ready';
      grid: TerrainGrid;
      runner: SimRunner;
      originCell: number;
      stats: ProvinceStats[];
      seatNames: Record<number, string>;
    };

const ALERT_TONE: Record<string, string> = {
  raid: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  loss: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  seat: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
  hunger: 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20',
};

/** One header figure: what it is, what it reads, and its unit. */
function Readout({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded border border-bf-border/70 bg-bf-dark/50 px-2 py-1 leading-tight">
      <div className="text-[8px] uppercase tracking-wider text-bf-muted">{label}</div>
      <div className="font-mono text-[11px] text-bf-text">{value}</div>
      <div className="text-[8px] text-bf-muted">{note}</div>
    </div>
  );
}

/** A keycap. The control hints were a run-on sentence with the keys hidden inside it. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-bf-border bg-bf-surface px-1 py-px font-mono text-[10px] text-bf-text">
      {children}
    </kbd>
  );
}

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
  /** Set once the match ends, which is also what stops the simulation advancing. */
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const grid = await fetchWarfrontTerrain();
        // Computed once: the panel needs per-province counts, and recomputing them on
        // every pointer move would rescan ~600k cells.
        const stats = computeProvinceStats(grid);
        // The match itself waits for the player to choose opponents.
        if (!cancelled) setState({ kind: 'setup', grid, stats });
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

  /**
   * Opens a match against the chosen policies.
   *
   * A fixed seed makes a match reproducible from one reload to the next — including which
   * tribe raids first, and what the opponents do, because their orders go through the
   * same command path a human's do and so land in the replay with everything else.
   */
  const startMatch = useCallback(
    (setup: SoloSetup) => {
      if (state.kind !== 'setup' && state.kind !== 'ready') return;
      const grid = state.grid;
      const solo = buildSoloMatch(grid, 20260913, setup);
      const runner = new SimRunner(new Sim({ seed: 20260913, scenario: solo.scenario, terrain: grid }));
      // The opposing policies decide here, on the same cadence and at the same point in
      // the tick the headless lab uses. Same driver, same answers.
      runner.beforeTick = (sim, nextTick) => solo.driver.beforeTick(sim, nextTick);

      alertsRef.current.clear();
      watchRef.current = new MatchWatch();
      pendingBuildRef.current = null;
      groupsRef.current = new ControlGroups();
      setAlerts([]);
      setSelected(new Set());
      setSelectedBuilding(null);
      setPlacingKind(null);
      setGroupSlots([]);
      setHud({ ticks: 0, units: 0 });
      setResult(null);
      setState({
        kind: 'ready',
        grid,
        runner,
        originCell: solo.playerSeatCell,
        stats: state.stats,
        seatNames: solo.seatNames,
      });
      setFocus({ cell: solo.playerSeatCell, nonce: ++focusNonceRef.current });
    },
    [state],
  );

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

      // Your own units only. With a live opponent on the map an unfiltered pick would
      // hand you their army — and the simulation does not check who issued a command, so
      // the order would be carried out.
      const hit = unitAtPoint(currentUnits(), wx, wy, PICK_RADIUS_CELLS, VIEWER_OWNER);
      if (hit !== null) setSelectedBuilding(null);
      setSelected((prev) => applySelection(prev, hit == null ? [] : [hit], additive));
    },
    [runner, grid, placingKind, selectedVillagers, assignTo, currentUnits],
  );

  const onSelectRect = useCallback(
    (rect: WorldRect, additive: boolean) => {
      setSelectedBuilding(null);
      setSelected((prev) => applySelection(prev, unitsInRect(currentUnits(), rect, VIEWER_OWNER), additive));
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

      // The match is over when the format says so — a majority, the last seat standing,
      // or the clock. Clearing beforeTick stops the opponents thinking; the runner is
      // left alone so the plane keeps drawing the final position behind the standings.
      const current = runner.sim.result;
      if (current.over) {
        runner.beforeTick = null;
        setResult((prev) => prev ?? current);
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
    if (state.kind === 'ready' || state.kind === 'setup') for (const entry of state.stats) map.set(entry.index, entry);
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bf-border px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-[15px] font-semibold tracking-wide text-bf-gold">Warfront</h1>
          <span className="rounded border border-bf-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-bf-muted">
            Tactical view
          </span>
          <p className="hidden text-[11px] text-bf-muted lg:block">
            Experimental RTS mode, admin-only — economy, colonisation and tribal raids on real terrain.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {runner ? (
            <Readout label="Clock" value={`${seconds}s`} note={`tick ${hud.ticks}`} />
          ) : null}
          {runner ? (
            <Readout label="Selected" value={`${selected.size}/${hud.units}`} note="units" />
          ) : null}
          {camera ? (
            <Readout label="Zoom" value={`${camera.scale.toFixed(2)}`} note="px/cell" />
          ) : null}
          {grid ? (
            <Readout label="Grid" value={`${grid.width}×${grid.height}`} note={`${grid.cellKm} km cells`} />
          ) : null}
          <Link
            to="/admin"
            className="ml-1 rounded border border-bf-border px-2 py-1.5 text-[11px] hover:border-bf-gold hover:text-bf-gold"
          >
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

        {state.kind === 'setup' ? <WarfrontMatchSetup onStart={startMatch} /> : null}

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

              <div className="pointer-events-none absolute bottom-3 left-3 max-w-[22rem] rounded-lg border border-bf-border bg-bf-dark/90 px-3 py-2 text-[11px] leading-[1.7] text-bf-muted">
                <div className="mb-1 text-[9px] uppercase tracking-wider text-bf-muted/70">Controls</div>
                <div>
                  <Key>Left</Key> select · drag to box · click a building to assign
                </div>
                <div>
                  <Key>Right</Key> move · <Key>Middle</Key>/<Key>WASD</Key> pan · <Key>Wheel</Key> zoom ·{' '}
                  <Key>Esc</Key> cancel
                </div>
                <div>
                  <Key>Ctrl</Key>+<Key>1–9</Key> set group · <Key>1–9</Key> recall · <Key>Space</Key> jump to alert
                  {groupSlots.length > 0 ? (
                    <span className="text-bf-gold"> · groups {groupSlots.map((slot) => slot + 1).join(', ')}</span>
                  ) : null}
                </div>
              </div>

              {result ? (
                <WarfrontResult
                  result={result}
                  seatNames={state.seatNames}
                  playerSeat={VIEWER_OWNER}
                  onRestart={() => setState({ kind: 'setup', grid: state.grid, stats: state.stats })}
                />
              ) : null}
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
