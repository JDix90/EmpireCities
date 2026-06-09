/**
 * Pre-game lobby map preview — defaults to an interactive 3D globe snippet
 * with a 2D schematic fallback toggle for slower devices.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { Globe, Loader2, Map as MapIcon } from 'lucide-react';
import clsx from 'clsx';
import { fetchMapById, GameMap, ERA_METADATA } from '../../services/mapService';
import { GlobeMapLazy, preloadGlobeChunks } from '../../utils/globeLoader';
import MapPreview from './MapPreview';

type PreviewView = 'globe' | '2d';

interface LobbyMapPreviewProps {
  mapId: string;
  height?: number;
  className?: string;
  /** Default to globe; users can switch to 2D via the corner toggle. */
  defaultView?: PreviewView;
}

export default function LobbyMapPreview({
  mapId,
  height = 240,
  className = '',
  defaultView = 'globe',
}: LobbyMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<GameMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PreviewView>(defaultView);
  const [size, setSize] = useState({ w: 720, h: height });
  const [globeMounted, setGlobeMounted] = useState(false);

  useEffect(() => {
    preloadGlobeChunks();
  }, []);

  useEffect(() => {
    setLoading(true);
    setMap(null);
    fetchMapById(mapId)
      .then((m) => {
        setMap(m);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mapId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(280, el.clientWidth), h: height });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Defer WebGL mount until the preview container is on screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || view !== 'globe') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setGlobeMounted(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [view, mapId]);

  useEffect(() => {
    setGlobeMounted(false);
  }, [mapId]);

  if (loading) {
    return (
      <div
        ref={containerRef}
        className={clsx('flex items-center justify-center bg-bf-dark rounded-xl', className)}
        style={{ height }}
      >
        <Loader2 className="animate-spin text-bf-muted" size={24} />
      </div>
    );
  }

  if (!map) {
    return (
      <div
        ref={containerRef}
        className={clsx('flex items-center justify-center bg-bf-dark rounded-xl text-bf-muted text-sm', className)}
        style={{ height }}
      >
        Preview unavailable
      </div>
    );
  }

  const meta = ERA_METADATA[map.era_theme] || ERA_METADATA.ww2;
  const activeWorldId =
    map.map_kind === 'galaxy'
      ? (map.worlds?.[0]?.world_id ?? 'sol')
      : 'earth';

  return (
    <div
      ref={containerRef}
      className={clsx('relative rounded-xl overflow-hidden', className)}
      style={{ height, backgroundColor: meta.bgColor }}
    >
      <div
        className="absolute top-2 left-2 z-20 text-xs font-bold px-2 py-1 rounded pointer-events-none"
        style={{ backgroundColor: `${meta.color}33`, color: meta.color }}
      >
        {meta.label} · {meta.year}
      </div>

      <div className="absolute top-2 right-2 z-20 flex rounded-lg border border-bf-border/80 bg-black/55 overflow-hidden">
        <button
          type="button"
          onClick={() => setView('globe')}
          className={clsx(
            'flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide transition-colors',
            view === 'globe' ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text',
          )}
          aria-pressed={view === 'globe'}
          aria-label="Globe preview"
        >
          <Globe className="w-3 h-3" />
          Globe
        </button>
        <button
          type="button"
          onClick={() => setView('2d')}
          className={clsx(
            'flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide transition-colors border-l border-bf-border/60',
            view === '2d' ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text',
          )}
          aria-pressed={view === '2d'}
          aria-label="2D map preview"
        >
          <MapIcon className="w-3 h-3" />
          2D
        </button>
      </div>

      <div className="absolute bottom-2 right-2 z-20 text-[10px] text-bf-muted pointer-events-none">
        {map.territories.length} territories
      </div>

      {view === '2d' ? (
        <MapPreview
          mapId={mapId}
          mapData={map}
          width={size.w}
          height={height}
          className="absolute inset-0 rounded-none"
          showChrome={false}
        />
      ) : !globeMounted ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bf-dark">
          <Loader2 className="animate-spin text-bf-muted" size={22} />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-bf-dark">
              <Loader2 className="animate-spin text-bf-muted" size={22} />
            </div>
          }
        >
          <div className="absolute inset-0">
            <GlobeMapLazy
              mapData={map}
              onTerritoryClick={() => {}}
              width={size.w}
              height={height}
              reducedEffects
              autoSpin
              previewMode
              ambientEnabled={false}
              connectionHintMode="off"
              activeWorldId={activeWorldId}
            />
          </div>
        </Suspense>
      )}

      {view === 'globe' && (
        <p className="absolute bottom-2 left-2 z-20 text-[10px] text-bf-muted/90 pointer-events-none max-w-[55%]">
          Drag to explore · spin enabled
        </p>
      )}
    </div>
  );
}
