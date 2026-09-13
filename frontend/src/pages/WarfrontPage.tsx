import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sim, type TerrainGrid } from '@borderfall/warfront-sim';
import { BIOME_NAMES, cellBeach, cellFord, cellPass } from '@borderfall/warfront-sim';
import WarfrontTerrainCanvas from '../components/warfront/WarfrontTerrainCanvas';
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
import { buildSandboxScenario } from '../warfront/sandboxScenario';
import { fetchWarfrontTerrain } from '../services/warfrontApi';

/**
 * Warfront tactical view — Slice A step 2.
 *
 * Admin-only. The route is wrapped `<PrivateRoute><AdminRoute>` in App.tsx and the
 * endpoint it calls is admin-guarded server-side; the terrain endpoint also 404s while
 * `warfront_enabled` is off, which is the "flag is off" state below. See the isolation
 * rule in CLAUDE.md: nothing here may affect the live Borderfall game.
 *
 * What works: a deterministic simulation running at 15 ticks/s over the real western
 * twenty, units you can select and order across terrain that actually blocks them. What
 * does not exist yet: economy, buildings, combat, bots — step 3 onward. The starting
 * units come from a throwaway deterministic scenario, not a real match setup.
 */

/** Seat province the sandbox squad musters in — Gaul, the widest land frontier. */
const SANDBOX_PROVINCE = 'lugdunensis';
const SANDBOX_UNITS = 8;
/** Click tolerance when picking a single unit, in cells. */
const PICK_RADIUS_CELLS = 3;
/** Spacing between units in a group order, in cells. */
const FORMATION_SPACING_CELLS = 2;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; grid: TerrainGrid; runner: SimRunner; focusCell: number };

export default function WarfrontPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hoverCell, setHoverCell] = useState(-1);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [hud, setHud] = useState({ ticks: 0, units: 0 });
  const groupsRef = useRef(new ControlGroups());
  const [groupSlots, setGroupSlots] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const grid = await fetchWarfrontTerrain();
        const { scenario, originCell } = buildSandboxScenario(grid, {
          territoryId: SANDBOX_PROVINCE,
          count: SANDBOX_UNITS,
        });
        // A fixed seed: this view is a sandbox, and a stable seed makes what you see
        // reproducible from one reload to the next.
        const runner = new SimRunner(new Sim({ seed: 20260913, scenario, terrain: grid }));
        if (!cancelled) setState({ kind: 'ready', grid, runner, focusCell: originCell });
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

  const onSelectPoint = useCallback(
    (wx: number, wy: number, additive: boolean) => {
      const units = currentUnits();
      const hit = unitAtPoint(units, wx, wy, PICK_RADIUS_CELLS);
      setSelected((prev) => applySelection(prev, hit == null ? [] : [hit], additive));
    },
    [currentUnits],
  );

  const onSelectRect = useCallback(
    (rect: WorldRect, additive: boolean) => {
      setSelected((prev) => applySelection(prev, unitsInRect(currentUnits(), rect), additive));
    },
    [currentUnits],
  );

  const onOrder = useCallback(
    (wx: number, wy: number) => {
      if (!runner || !grid || selected.size === 0) return;
      // Stable order so the same click always assigns the same unit to the same slot.
      const ids = [...selected].sort((a, b) => a - b);
      const targets = formationTargets(ids.length, wx, wy, FORMATION_SPACING_CELLS);
      ids.forEach((id, i) => {
        const t = moveTarget(grid, targets[i].x, targets[i].y);
        runner.sim.issue({ type: 'move', unit: id, x: t.x, y: t.y });
      });
    },
    [runner, grid, selected],
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
        setSelected(new Set());
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
  }, [runner, selected]);

  // Never let a selection outlive its units (nothing removes units yet, but combat will).
  useEffect(() => {
    if (!runner) return;
    setSelected((prev) => {
      const pruned = pruneSelection(prev, runner.positions());
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [runner, hud.units]);

  const onCameraChange = useCallback((next: Camera) => setCamera(next), []);
  const onHoverCell = useCallback((cell: number) => setHoverCell(cell), []);
  const onFrame = useCallback((info: { ticks: number; units: number }) => setHud(info), []);

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
            Experimental RTS mode, admin-only. Sandbox units on real terrain — no economy, buildings or combat yet.
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

      <main className="relative min-h-0 flex-1">
        {state.kind === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-bf-muted">Loading terrain…</div>
        ) : null}

        {state.kind === 'disabled' ? (
          <div className="flex h-full items-center justify-center px-6">
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
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-md rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {state.message}
            </div>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <WarfrontTerrainCanvas
              grid={state.grid}
              runner={state.runner}
              selectedIds={selected}
              focusCell={state.focusCell}
              onSelectPoint={onSelectPoint}
              onSelectRect={onSelectRect}
              onOrder={onOrder}
              onCameraChange={onCameraChange}
              onHoverCell={onHoverCell}
              onFrame={onFrame}
            />
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-bf-border bg-bf-dark/85 px-3 py-2 text-[11px] leading-relaxed">
              {hover ? (
                <>
                  <div className="font-semibold text-bf-text">{hover.province}</div>
                  <div className="text-bf-muted">
                    cell {hover.col},{hover.row} · {hover.biome} · tier {hover.tier} ·{' '}
                    {hover.passable ? 'passable' : 'blocked'}
                  </div>
                  {hover.flags.length > 0 ? <div className="text-bf-gold">{hover.flags.join(' · ')}</div> : null}
                </>
              ) : (
                <span className="text-bf-muted">Hover a cell for terrain</span>
              )}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-bf-border bg-bf-dark/85 px-3 py-2 text-[11px] leading-relaxed text-bf-muted">
              <div>
                <span className="text-bf-text">Left</span> select, drag to box · <span className="text-bf-text">Right</span>{' '}
                move · <span className="text-bf-text">Shift</span> add
              </div>
              <div>
                <span className="text-bf-text">Middle-drag</span> or <span className="text-bf-text">WASD</span> pan ·{' '}
                <span className="text-bf-text">Wheel</span> zoom · <span className="text-bf-text">Esc</span> clear
              </div>
              <div>
                <span className="text-bf-text">Ctrl+1–9</span> set group · <span className="text-bf-text">1–9</span> recall
                {groupSlots.length > 0 ? (
                  <span className="text-bf-gold"> · groups {groupSlots.map((s) => s + 1).join(', ')}</span>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
