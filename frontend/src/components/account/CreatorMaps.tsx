import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Map, Star, Users } from 'lucide-react';
import { api } from '../../services/api';
import MapPreview from '../lobby/MapPreview';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { useMapEditorEnabled } from '../../store/featureFlagsStore';

export interface CreatorMapRow {
  map_id: string;
  name: string;
  description: string;
  era_theme: string;
  territory_count: number;
  region_count: number;
  play_count: number;
  rating: number;
  rating_count: number;
}

interface CreatorMapsProps {
  userId: string;
  /** The profile's owner is looking: an empty shelf points to the editor. */
  isOwn: boolean;
}

/** A player's published maps, on their profile (GET /maps/by-creator/:userId). */
export default function CreatorMaps({ userId, isOwn }: CreatorMapsProps) {
  const navigate = useNavigate();
  const editorEnabled = useMapEditorEnabled();
  const [maps, setMaps] = useState<CreatorMapRow[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMaps(null);
    api.get<{ maps: CreatorMapRow[] }>(`/maps/by-creator/${userId}`)
      .then((res) => {
        // A server without this endpoint yet answers with something else; show nothing rather than crash the profile.
        if (!cancelled) setMaps(Array.isArray(res.data?.maps) ? res.data.maps : []);
      })
      .catch(() => {
        if (!cancelled) setMaps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (maps === null) return null;
  if (maps.length === 0) {
    if (!isOwn || !editorEnabled) return null;
    return (
      <div className="card" data-testid="creator-maps">
        <h3 className="font-display text-lg text-bf-gold mb-2 flex items-center gap-2">
          <Map className="w-5 h-5" aria-hidden /> Published maps
        </h3>
        <p className="text-sm text-bf-muted">
          Nothing published yet. Build a map in the{' '}
          <Link to="/editor" className="text-bf-gold hover:text-white">Map Editor</Link>
          {' '}and submit it for review; approved maps appear here and in the Map Hub.
        </p>
      </div>
    );
  }

  const plays = maps.reduce((s, m) => s + m.play_count, 0);

  return (
    <div className="card" data-testid="creator-maps">
      <h3 className="font-display text-lg text-bf-gold mb-1 flex items-center gap-2">
        <Map className="w-5 h-5" aria-hidden /> Published maps
      </h3>
      <p className="text-xs text-bf-muted mb-4">
        {maps.length} map{maps.length === 1 ? '' : 's'} · {plays} play{plays === 1 ? '' : 's'} in all
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {maps.map((m) => (
          <div key={m.map_id} className="p-3 bg-bf-dark rounded-lg border border-bf-border">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-bf-text font-medium truncate" title={m.name}>{m.name}</p>
              {m.era_theme && m.era_theme !== 'custom' && ERA_LABELS[m.era_theme] && (
                <span className="text-[11px] text-bf-muted shrink-0">{ERA_LABELS[m.era_theme]}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-bf-muted mt-1">
              <span>{m.territory_count} territories</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden />{m.play_count}</span>
              {m.rating_count > 0 && (
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-bf-gold" aria-hidden />{m.rating.toFixed(1)}</span>
              )}
            </div>
            {preview === m.map_id && (
              <div className="mt-2 rounded-lg overflow-hidden">
                <MapPreview mapId={m.map_id} width={300} height={160} showChrome={false} />
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => navigate(`/lobby?map=${m.map_id}`)} className="btn-primary text-xs py-1 flex-1">Play</button>
              <Link to={`/maps/${m.map_id}`} className="btn-secondary text-xs py-1 px-2.5">Details</Link>
              <button
                type="button"
                onClick={() => setPreview((p) => (p === m.map_id ? null : m.map_id))}
                className="btn-secondary text-xs py-1 px-2"
                aria-label={preview === m.map_id ? 'Hide preview' : 'Preview the board'}
                aria-pressed={preview === m.map_id}
              >
                <Eye className="w-3.5 h-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
