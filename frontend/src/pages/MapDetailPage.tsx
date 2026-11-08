import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Globe, Link2, Map, Pencil, Star, Users } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import BrandWordmark from '../components/ui/BrandWordmark';
import MapPreview from '../components/lobby/MapPreview';
import TestPlayButton from '../components/editor/TestPlayButton';
import { api } from '../services/api';
import type { GameMap } from '../services/mapService';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import { useAuthStore } from '../store/authStore';
import { useMapEditorEnabled } from '../store/featureFlagsStore';
import { trackUiEvent } from '../utils/uiEvents';

type LoadState = 'loading' | 'ready' | 'missing';

/**
 * A map's own page: the link an author shares and a player opens from a
 * hub card. Preview, author, numbers, a rating, and the ways in — play it,
 * and for its author, edit it or test it against bots.
 */
export default function MapDetailPage() {
  const { mapId = '' } = useParams<{ mapId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const editorEnabled = useMapEditorEnabled();
  const [map, setMap] = useState<GameMap | null>(null);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [rating, setRating] = useState<{ rating: number; rating_count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api.get<{ map: GameMap; creator_name?: string | null }>(`/maps/${mapId}`)
      .then((res) => {
        if (cancelled) return;
        setMap(res.data.map);
        setCreatorName(res.data.creator_name ?? null);
        const count = res.data.map.rating_count ?? 0;
        setRating({ rating: count > 0 ? (res.data.map.rating_sum ?? 0) / count : 0, rating_count: count });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const isAuthor = !!user && !!map && map.creator_id === user.user_id;
  const isBuiltIn = !!map && (map.creator_id === 'system' || mapId.startsWith('era_') || mapId.startsWith('community_'));
  const published = isBuiltIn || map?.moderation_status === 'approved';

  const share = () => {
    const url = `${window.location.origin}/maps/${mapId}`;
    const done = () => toast.success('Link copied');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
    else toast(url);
    trackUiEvent('map_shared', { map_id: mapId, source: 'detail' });
  };

  const rate = async (star: number) => {
    try {
      const res = await api.post<{ rating: number; rating_count: number }>(`/maps/${mapId}/rate`, { rating: star });
      setRating({ rating: res.data.rating, rating_count: res.data.rating_count });
      toast.success('Rating submitted!');
    } catch {
      toast.error('Failed to submit rating');
    }
  };

  const title = map?.name ?? (state === 'missing' ? 'MAP' : '…');

  return (
    <SubpageShell
      title={title}
      icon={Map}
      maxWidth="4xl"
      backHref="/maps"
      backLabel="Map Hub"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
    >
      {state === 'loading' && <p className="text-bf-muted text-sm py-12 text-center">Loading map…</p>}

      {state === 'missing' && (
        <div className="py-16 text-center space-y-3">
          <p className="text-bf-muted">This map is not published yet, or it does not exist.</p>
          <p className="text-bf-muted/70 text-sm">Community maps appear here once a moderator has approved them.</p>
          <Link to="/maps" className="btn-secondary text-sm inline-block">Browse the Map Hub</Link>
        </div>
      )}

      {state === 'ready' && map && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="rounded-lg overflow-hidden border border-bf-border bg-bf-dark w-full overflow-x-auto">
              <MapPreview mapId={map.map_id} mapData={map} width={640} height={360} />
            </div>
            {map.description && <p className="text-bf-text text-sm mt-4 leading-relaxed">{map.description}</p>}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="badge bg-bf-dark text-bf-muted border border-bf-border text-xs">
                  {isBuiltIn ? 'Official' : ERA_LABELS[map.era_theme] ?? 'Community map'}
                </span>
                {!published && (
                  <span className="text-xs px-2.5 py-1 rounded-full border bg-slate-600/20 border-slate-400/40 text-slate-300">
                    {map.moderation_status === 'pending' ? 'In review' : map.moderation_status === 'rejected' ? 'Sent back' : 'Draft'}
                  </span>
                )}
              </div>
              <p className="text-sm text-bf-muted">
                By <span className="text-bf-text">{isBuiltIn ? 'Borderfall' : creatorName ?? 'a community author'}</span>
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-bf-muted pt-1">
                <span className="flex items-center gap-1"><Map className="w-3 h-3" aria-hidden />{map.territories.length} territories</span>
                <span className="flex items-center gap-1"><Globe className="w-3 h-3" aria-hidden />{map.regions.length} regions</span>
                <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden />{map.play_count} plays</span>
                {rating && rating.rating_count > 0 && (
                  <span className="flex items-center gap-1"><Star className="w-3 h-3 text-bf-gold" aria-hidden />{rating.rating.toFixed(1)} ({rating.rating_count})</span>
                )}
              </div>
              {!published && isAuthor && (
                <p className="text-xs text-bf-muted pt-1">Only you can open this page until the map is published.</p>
              )}
            </div>

            <div className="card space-y-2">
              {published && (
                <button onClick={() => navigate(`/lobby?map=${map.map_id}`)} className="btn-primary w-full text-sm py-2">
                  Play This Map
                </button>
              )}
              {isAuthor && !isBuiltIn && (
                <div className="flex gap-2">
                  {editorEnabled && (
                    <button onClick={() => navigate(`/editor/${map.map_id}`)} className="btn-secondary flex-1 text-sm py-1.5 flex items-center justify-center gap-2">
                      <Pencil className="w-4 h-4" aria-hidden /> Edit
                    </button>
                  )}
                  <TestPlayButton
                    mapId={map.map_id}
                    eraTheme={map.era_theme}
                    className="flex-1 [&>button]:w-full [&>button]:justify-center"
                    onStarted={({ era, opponents }) => trackUiEvent('editor_test_play_started', { map_id: map.map_id, era, opponents, source: 'detail' })}
                  />
                </div>
              )}
              <button onClick={share} className="btn-secondary w-full text-sm py-1.5 flex items-center justify-center gap-2">
                <Link2 className="w-4 h-4" aria-hidden /> Copy link
              </button>
            </div>

            {published && !isAuthor && !isBuiltIn && (
              <div className="card">
                <p className="text-xs text-bf-muted mb-2">Rate this map</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => void rate(star)}
                      aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
                      className={`text-2xl transition-colors ${rating && star <= Math.round(rating.rating) ? 'text-bf-gold' : 'text-bf-border hover:text-bf-gold'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </SubpageShell>
  );
}
