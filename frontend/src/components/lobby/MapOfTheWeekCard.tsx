import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crown, Eye, Globe, Map, Star, Users } from 'lucide-react';
import { api } from '../../services/api';
import MapPreview from './MapPreview';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';

export interface FeaturedMap {
  map_id: string;
  name: string;
  description: string;
  era_theme: string;
  territory_count: number;
  region_count: number;
  play_count: number;
  rating: number;
  rating_count: number;
  creator_id: string;
  creator_name: string | null;
}

export interface FeaturedPayload {
  week: string;
  map: FeaturedMap | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_FEATURED: FeaturedPayload = { week: '', map: null };

/**
 * The week's community map, as the server picks it (GET /maps/featured).
 * With the showcase switched off (`enabled` false) nothing is asked for and
 * there is no map, so every surface reading it stays quiet.
 */
export function useFeaturedMap(enabled = true): FeaturedPayload | null {
  const [payload, setPayload] = useState<FeaturedPayload | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api.get<FeaturedPayload>('/maps/featured')
      .then((res) => {
        if (!cancelled) setPayload(res.data);
      })
      .catch(() => {
        if (!cancelled) setPayload({ week: '', map: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? payload : NO_FEATURED;
}

/**
 * The hub's hero: one approved community map, the same for everyone all
 * week, drawn from the best-rated so a maker's work gets its turn in front.
 */
export default function MapOfTheWeekCard({ featured }: { featured: FeaturedPayload | null }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(false);
  const map = featured?.map;
  if (!map) return null;
  const week = featured?.week?.split('-W')[1];

  return (
    <section className="mb-12" data-testid="map-of-the-week">
      <div className="card border-bf-gold/50 bg-gradient-to-br from-bf-gold/10 to-transparent">
        <div className="flex flex-col md:flex-row gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-bf-gold" aria-hidden />
              <span className="text-xs uppercase tracking-wider text-bf-gold">Map of the week{week ? ` · week ${Number(week)}` : ''}</span>
            </div>
            <h2 className="font-display text-2xl text-bf-gold truncate">{map.name}</h2>
            <p className="text-sm text-bf-muted mt-1">
              by{' '}
              {UUID_RE.test(map.creator_id) ? (
                <Link to={`/profile/${map.creator_id}`} className="text-bf-text hover:text-bf-gold">{map.creator_name ?? 'a community author'}</Link>
              ) : (
                <span className="text-bf-text">{map.creator_name ?? 'a community author'}</span>
              )}
              <span>{map.era_theme && map.era_theme !== 'custom' && ERA_LABELS[map.era_theme] ? ` · ${ERA_LABELS[map.era_theme]}` : ''}</span>
            </p>
            {map.description && <p className="text-bf-text text-sm mt-3 line-clamp-3">{map.description}</p>}
            <div className="flex flex-wrap items-center gap-3 text-xs text-bf-muted mt-3">
              <span className="flex items-center gap-1"><Map className="w-3 h-3" aria-hidden />{map.territory_count} territories</span>
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden />{map.region_count} regions</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden />{map.play_count} plays</span>
              {map.rating_count > 0 && (
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-bf-gold" aria-hidden />{map.rating.toFixed(1)} ({map.rating_count})</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => navigate(`/lobby?map=${map.map_id}`)} className="btn-primary text-sm py-1.5 px-5">
                Play This Map
              </button>
              <Link to={`/maps/${map.map_id}`} className="btn-secondary text-sm py-1.5 px-3">Details</Link>
              <button
                type="button"
                onClick={() => setPreview((v) => !v)}
                className="btn-secondary text-sm py-1.5 px-2.5 md:hidden"
                aria-label={preview ? 'Hide preview' : 'Preview the board'}
                aria-pressed={preview}
              >
                <Eye className="w-4 h-4" aria-hidden />
              </button>
            </div>
          </div>
          <div className={`${preview ? 'block' : 'hidden'} md:block rounded-lg overflow-hidden shrink-0`}>
            <MapPreview mapId={map.map_id} width={360} height={200} />
          </div>
        </div>
      </div>
    </section>
  );
}
