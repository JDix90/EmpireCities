import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TerrainGrid } from '@borderfall/warfront-sim';
import { BIOME_NAMES, cellBeach, cellFord, cellPass } from '@borderfall/warfront-sim';
import WarfrontTerrainCanvas from '../components/warfront/WarfrontTerrainCanvas';
import type { Camera } from '../warfront/camera';
import { fetchWarfrontTerrain } from '../services/warfrontApi';

/**
 * Warfront tactical view — Slice A step 2, the renderer.
 *
 * Admin-only. The route is wrapped `<PrivateRoute><AdminRoute>` in App.tsx and BOTH
 * endpoints this page calls are admin-guarded server-side; the terrain endpoint also
 * 404s while `warfront_enabled` is off, which is the "flag is off" state below. See the
 * isolation rule in CLAUDE.md: nothing here may affect the live Borderfall game.
 *
 * Nothing is playable yet. Units, selection and orders arrive next; the province panel
 * and alerts after that.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; grid: TerrainGrid };

export default function WarfrontPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hoverCell, setHoverCell] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const grid = await fetchWarfrontTerrain();
        if (!cancelled) setState({ kind: 'ready', grid });
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

  const onCameraChange = useCallback((next: Camera) => setCamera(next), []);
  const onHoverCell = useCallback((cell: number) => setHoverCell(cell), []);

  const grid = state.kind === 'ready' ? state.grid : null;

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

  return (
    <div className="flex h-screen flex-col bg-bf-dark text-bf-text">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bf-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">
            Warfront <span className="text-bf-muted">· tactical view</span>
          </h1>
          <p className="text-[11px] text-bf-muted">
            Experimental RTS mode, admin-only. Terrain renderer only — no units or orders yet.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {grid ? (
            <span className="text-bf-muted">
              {grid.width} × {grid.height} cells · {grid.cellKm} km · {grid.provinces.length} provinces
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

        {grid ? (
          <>
            <WarfrontTerrainCanvas grid={grid} onCameraChange={onCameraChange} onHoverCell={onHoverCell} />
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
                <span className="text-bf-muted">Drag to pan · wheel to zoom · hover a cell</span>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
