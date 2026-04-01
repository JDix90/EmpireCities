import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Star, Globe, Plus, Map, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchEraMaps, MapSummary, ERA_METADATA } from '../services/mapService';
import MapPreview from '../components/lobby/MapPreview';

interface PublicMap {
  map_id: string;
  name: string;
  description: string;
  era_theme?: string;
  rating: number;
  rating_count: number;
  play_count: number;
  creator_id: string;
  created_at: string;
}

export default function MapHubPage() {
  const navigate = useNavigate();

  // Era maps (built-in)
  const [eraMaps, setEraMaps]       = useState<MapSummary[]>([]);
  const [eraLoading, setEraLoading] = useState(true);
  const [previewMap, setPreviewMap] = useState<string | null>(null);

  // Community maps
  const [maps, setMaps]       = useState<PublicMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort]       = useState<'rating' | 'plays' | 'new'>('rating');
  const [eraFilter, setEraFilter] = useState('');

  // Load era maps
  useEffect(() => {
    fetchEraMaps()
      .then(maps => { setEraMaps(maps); setEraLoading(false); })
      .catch(() => setEraLoading(false));
  }, []);

  // Load community maps
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ sort });
    if (eraFilter) params.set('era', eraFilter);
    api.get(`/maps/public?${params.toString()}`)
      .then((res) => setMaps(res.data.maps))
      .catch(() => toast.error('Failed to load maps'))
      .finally(() => setLoading(false));
  }, [sort, eraFilter]);

  const handleRate = async (mapId: string, rating: number) => {
    try {
      await api.post(`/maps/${mapId}/rate`, { rating });
      toast.success('Rating submitted!');
      setMaps((prev) => prev.map((m) => m.map_id === mapId ? { ...m, rating } : m));
    } catch {
      toast.error('Failed to submit rating');
    }
  };

  return (
    <div className="min-h-screen bg-cc-dark">
      <nav className="border-b border-cc-border px-6 py-4 flex items-center justify-between pt-safe px-safe">
        <div className="flex items-center gap-4">
          <Link to="/lobby" className="font-display text-xl text-cc-gold tracking-widest hover:text-white transition-colors">
            CHRONOCONQUEST
          </Link>
          <span className="text-cc-border">|</span>
          <h1 className="font-display text-lg text-cc-muted flex items-center gap-2">
            <Globe className="w-5 h-5" /> Map Hub
          </h1>
        </div>
        <Link to="/editor" className="btn-primary text-sm flex items-center gap-2 py-1.5">
          <Plus className="w-4 h-4" /> Create Map
        </Link>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* ── Built-in Era Maps ─────────────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-cc-gold" />
            <h2 className="font-display text-lg text-cc-gold">Historical Era Maps</h2>
            <span className="text-cc-muted text-sm ml-1">— Official built-in maps</span>
          </div>

          {eraLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => (
                <div key={i} className="h-40 bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {eraMaps.map(map => {
                const meta = ERA_METADATA[map.era_theme] || ERA_METADATA['ww2'];
                return (
                  <div
                    key={map.map_id}
                    className="card hover:border-cc-gold transition-all group cursor-pointer"
                    onClick={() => setPreviewMap(previewMap === map.map_id ? null : map.map_id)}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-display text-base text-cc-gold group-hover:text-white transition-colors">
                          {meta.label}
                        </h3>
                        <span className="text-xs font-mono" style={{ color: meta.color }}>
                          {meta.year}
                        </span>
                      </div>
                      <span className="badge bg-cc-dark text-cc-muted border border-cc-border text-xs">
                        Official
                      </span>
                    </div>

                    <p className="text-cc-muted text-xs mb-3 line-clamp-2">{meta.description}</p>

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs text-cc-muted mb-3">
                      <span className="flex items-center gap-1">
                        <Map className="w-3 h-3" />
                        {map.territory_count} territories
                      </span>
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {map.region_count} regions
                      </span>
                      {map.play_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {map.play_count.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Map Preview (expandable) */}
                    {previewMap === map.map_id && (
                      <div className="mb-3 rounded-lg overflow-hidden">
                        <MapPreview mapId={map.map_id} width={320} height={180} />
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/lobby?era=${map.era_theme}&map=${map.map_id}`);
                      }}
                      className="btn-primary w-full text-sm py-1.5"
                    >
                      Play This Era
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Community Maps ────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-cc-gold" />
            <h2 className="font-display text-lg text-cc-gold">Community Maps</h2>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-6 flex-wrap">
            <div>
              <label className="label text-xs">Sort By</label>
              <select className="input text-sm py-1.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="rating">Top Rated</option>
                <option value="plays">Most Played</option>
                <option value="new">Newest</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">Era Theme</label>
              <select className="input text-sm py-1.5" value={eraFilter} onChange={(e) => setEraFilter(e.target.value)}>
                <option value="">All Eras</option>
                <option value="ancient">Ancient</option>
                <option value="medieval">Medieval</option>
                <option value="discovery">Age of Discovery</option>
                <option value="ww2">World War II</option>
                <option value="coldwar">Cold War</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {/* Map Grid */}
          {loading ? (
            <p className="text-cc-muted text-center py-12">Loading maps...</p>
          ) : maps.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-cc-muted mb-4">No community maps yet. Be the first to create one!</p>
              <Link to="/editor" className="btn-primary">Create a Map</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {maps.map((map) => (
                <div key={map.map_id} className="card hover:border-cc-gold transition-colors group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-display text-lg text-cc-gold group-hover:text-white transition-colors truncate">
                        {map.name}
                      </h3>
                      {map.era_theme && (
                        <span className="badge bg-cc-dark text-cc-muted border border-cc-border text-xs mt-1 capitalize">
                          {map.era_theme}
                        </span>
                      )}
                    </div>
                  </div>

                  {map.description && (
                    <p className="text-cc-muted text-sm mb-3 line-clamp-2">{map.description}</p>
                  )}

                  <div className="flex items-center justify-between text-xs text-cc-muted mb-4">
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-cc-gold" />
                      {map.rating.toFixed(1)} ({map.rating_count})
                    </span>
                    <span>{map.play_count} plays</span>
                  </div>

                  {/* Star Rating */}
                  <div className="flex gap-1 mb-4">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => handleRate(map.map_id, star)}
                        className={`text-lg transition-colors ${star <= map.rating ? 'text-cc-gold' : 'text-cc-border hover:text-cc-gold'}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => navigate(`/lobby?map=${map.map_id}`)}
                    className="btn-secondary w-full text-sm py-1.5"
                  >
                    Play This Map
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
