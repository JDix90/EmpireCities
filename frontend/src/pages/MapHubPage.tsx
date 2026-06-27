import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Star, Globe, Plus, Map, Users, Zap, Compass, Search, Landmark, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchEraMaps, MapSummary, ERA_METADATA, GameMap, selectCanonicalEraMaps } from '../services/mapService';
import MapPreview from '../components/lobby/MapPreview';
import { REGIONAL_MAPS, fetchRegionalMap, regionalCategory } from '../data/regionalMaps';
import { getCustomMapImmersion } from '../data/customMapImmersion';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { useMapEditorEnabled } from '../store/featureFlagsStore';

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

type HubTab = 'all' | 'eras' | 'regional' | 'community';

/** A short curated row shown on the All tab to help players pick a starting map. */
const FEATURED: Array<{ kind: 'era'; era_theme: string } | { kind: 'regional'; map_id: string }> = [
  { kind: 'era', era_theme: 'modern' },
  { kind: 'regional', map_id: 'community_charlemagne_814' },
  { kind: 'era', era_theme: 'ww2' },
  { kind: 'regional', map_id: 'community_balkanized_usa' },
];

function formatCommunityUploader(creatorId: string): string {
  if (creatorId === 'jmd') return 'JMD';
  if (creatorId.length <= 3) return creatorId.toUpperCase();
  return creatorId;
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export default function MapHubPage() {
  const navigate = useNavigate();
  const mapEditorEnabled = useMapEditorEnabled();

  // Hub navigation
  const [tab, setTab] = useState<HubTab>('all');
  const [search, setSearch] = useState('');

  // Era maps (built-in)
  const [eraMaps, setEraMaps]       = useState<MapSummary[]>([]);
  const [eraLoading, setEraLoading] = useState(true);
  const [previewMap, setPreviewMap] = useState<string | null>(null);

  // Regional maps (static, shipped with client)
  const [regionalPreview, setRegionalPreview] = useState<string | null>(null);
  const [regionalMapData, setRegionalMapData] = useState<Record<string, GameMap>>({});

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

  const eraCards = useMemo(
    () => selectCanonicalEraMaps(eraMaps, new Set(REGIONAL_MAPS.map((m) => m.map_id))),
    [eraMaps],
  );

  const visibleEraCards = useMemo(
    () => eraCards.filter((m) => {
      const meta = ERA_METADATA[m.era_theme] || ERA_METADATA['ww2'];
      return matches(search, meta.label, meta.description, m.era_theme);
    }),
    [eraCards, search],
  );

  const regionalGroups = useMemo(() => {
    const visible = REGIONAL_MAPS.filter((rm) => matches(search, rm.name, rm.description, rm.year));
    return {
      theater: visible.filter((rm) => regionalCategory(rm.map_id) === 'theater'),
      alt: visible.filter((rm) => regionalCategory(rm.map_id) === 'alt'),
    };
  }, [search]);

  const visibleCommunity = useMemo(
    () => maps.filter((m) => matches(search, m.name, m.description)),
    [maps, search],
  );

  const handleRate = async (mapId: string, rating: number) => {
    try {
      await api.post(`/maps/${mapId}/rate`, { rating });
      toast.success('Rating submitted!');
      setMaps((prev) => prev.map((m) => m.map_id === mapId ? { ...m, rating } : m));
    } catch {
      toast.error('Failed to submit rating');
    }
  };

  const showEras      = tab === 'all' || tab === 'eras';
  const showRegional  = tab === 'all' || tab === 'regional';
  const showCommunity = tab === 'all' || tab === 'community';

  const TABS: { id: HubTab; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'eras', label: 'Eras', count: eraCards.length },
    { id: 'regional', label: 'Regional', count: REGIONAL_MAPS.length },
    { id: 'community', label: 'Community', count: maps.length },
  ];

  // ── Card renderers ──────────────────────────────────────────────────────────
  const renderEraCard = (map: MapSummary) => {
    const meta = ERA_METADATA[map.era_theme] || ERA_METADATA['ww2'];
    return (
      <div
        key={map.map_id}
        className="card hover:border-bf-gold transition-all group cursor-pointer"
        onClick={() => setPreviewMap(previewMap === map.map_id ? null : map.map_id)}
      >
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-display text-base text-bf-gold group-hover:text-white transition-colors">
              {meta.label}
            </h3>
            <span className="text-xs font-mono" style={{ color: meta.color }}>{meta.year}</span>
          </div>
          <span className="badge bg-bf-dark text-bf-muted border border-bf-border text-xs">Official</span>
        </div>
        <p className="text-bf-muted text-xs mb-3 line-clamp-2">{meta.description}</p>
        <div className="flex items-center gap-3 text-xs text-bf-muted mb-3">
          <span className="flex items-center gap-1"><Map className="w-3 h-3" />{map.territory_count} territories</span>
          <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{map.region_count} regions</span>
          {map.play_count > 0 && (
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{map.play_count.toLocaleString()}</span>
          )}
        </div>
        {previewMap === map.map_id && (
          <div className="mb-3 rounded-lg overflow-hidden">
            <MapPreview mapId={map.map_id} width={320} height={180} />
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/lobby?era=${map.era_theme}&map=${map.map_id}`); }}
          className="btn-primary w-full text-sm py-1.5"
        >
          Play This Era
        </button>
      </div>
    );
  };

  const renderRegionalCard = (rm: typeof REGIONAL_MAPS[number]) => (
    <div
      key={rm.map_id}
      className="card hover:border-bf-gold transition-all group cursor-pointer"
      onClick={async () => {
        const opening = regionalPreview === rm.map_id ? null : rm.map_id;
        setRegionalPreview(opening);
        if (opening && !regionalMapData[opening]) {
          try {
            const data = await fetchRegionalMap(opening);
            setRegionalMapData((prev) => ({ ...prev, [opening]: data }));
          } catch { /* preview will show "unavailable" */ }
        }
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{rm.icon}</span>
          <div>
            <h3 className="font-display text-base text-bf-gold group-hover:text-white transition-colors">{rm.name}</h3>
            <span className="text-xs font-mono" style={{ color: rm.color }}>{rm.year}</span>
          </div>
        </div>
        <span className="badge bg-bf-dark text-bf-muted border border-bf-border text-xs">Regional</span>
      </div>
      <p className="text-bf-muted text-xs mb-3 line-clamp-2">{rm.description}</p>
      {(() => {
        const imm = getCustomMapImmersion(rm.map_id);
        if (!imm) return null;
        return (
          <details className="mb-3 text-xs rounded-md border border-bf-border/80 bg-bf-dark/50 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer text-bf-gold/90 hover:text-bf-gold select-none">
              Theater guide &amp; suggested rules
            </summary>
            <p className="text-bf-muted mt-2 leading-relaxed">{imm.backdrop}</p>
            <p className="text-bf-text mt-1.5 font-medium">{imm.tagline}</p>
            <p className="text-bf-muted mt-1">
              Suggested rules era:{' '}
              <span className="text-bf-gold">{ERA_LABELS[imm.recommended_rules_era] ?? imm.recommended_rules_era}</span>
            </p>
            <ul className="mt-2 space-y-1 text-[11px] text-bf-muted list-disc pl-4">
              <li>Economy: {imm.advanced.economy_buildings.lore}</li>
              <li>Naval: {imm.advanced.naval_warfare.lore}</li>
              <li>Events: {imm.advanced.historical_events.lore}</li>
            </ul>
          </details>
        );
      })()}
      <div className="flex items-center gap-3 text-xs text-bf-muted mb-3">
        <span className="flex items-center gap-1"><Map className="w-3 h-3" />{rm.territory_count} territories</span>
        <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{rm.region_count} regions</span>
      </div>
      {regionalPreview === rm.map_id && (
        <div className="mb-3 rounded-lg overflow-hidden">
          <MapPreview mapId={rm.map_id} mapData={regionalMapData[rm.map_id] ?? null} width={320} height={180} />
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); navigate(`/lobby?map=${rm.map_id}`); }}
        className="btn-primary w-full text-sm py-1.5"
      >
        Play This Map
      </button>
    </div>
  );

  const renderCommunityCard = (map: PublicMap) => (
    <div key={map.map_id} className="card hover:border-bf-gold transition-colors group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-display text-lg text-bf-gold group-hover:text-white transition-colors truncate">{map.name}</h3>
          {map.era_theme && (
            <span className="badge bg-bf-dark text-bf-muted border border-bf-border text-xs mt-1 capitalize">
              {map.era_theme === 'custom' ? 'Regional' : map.era_theme}
            </span>
          )}
        </div>
      </div>
      {map.description && <p className="text-bf-muted text-sm mb-3 line-clamp-2">{map.description}</p>}
      <p className="text-xs text-bf-muted/90 mb-3">
        Uploaded by <span className="text-bf-text">{formatCommunityUploader(map.creator_id)}</span>
      </p>
      <div className="flex items-center justify-between text-xs text-bf-muted mb-4">
        <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-bf-gold" />{map.rating.toFixed(1)} ({map.rating_count})</span>
        <span>{map.play_count} plays</span>
      </div>
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRate(map.map_id, star)}
            className={`text-lg transition-colors ${star <= map.rating ? 'text-bf-gold' : 'text-bf-border hover:text-bf-gold'}`}
          >★</button>
        ))}
      </div>
      <button onClick={() => navigate(`/lobby?map=${map.map_id}`)} className="btn-secondary w-full text-sm py-1.5">
        Play This Map
      </button>
    </div>
  );

  const SectionHeader = ({ icon: Icon, title, note }: { icon: typeof Zap; title: string; note?: string }) => (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-5 h-5 text-bf-gold" />
      <h2 className="font-display text-lg text-bf-gold">{title}</h2>
      {note && <span className="text-bf-muted text-sm ml-1">{note}</span>}
    </div>
  );

  return (
    <SubpageShell
      title="MAP HUB"
      icon={Globe}
      maxWidth="6xl"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      headerRight={mapEditorEnabled ? (
        <Link to="/editor" className="btn-primary text-sm flex items-center gap-2 py-1.5">
          <Plus className="w-4 h-4" aria-hidden /> Create Map
        </Link>
      ) : undefined}
    >
      {/* ── Sticky nav: category tabs + search ───────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-3 mb-6 bg-bf-dark/90 backdrop-blur border-b border-bf-border/60">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-bf-border bg-bf-dark/60 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-bf-gold text-bf-dark' : 'text-bf-muted hover:text-bf-text'
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={`ml-1.5 text-xs ${tab === t.id ? 'text-bf-dark/70' : 'text-bf-muted/70'}`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 text-bf-muted absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search maps…"
              className="input text-sm py-1.5 pl-8 w-full"
            />
          </div>
        </div>
      </div>

      {/* ── Featured (All tab only, no active search) ────────────────────── */}
      {tab === 'all' && !search && !eraLoading && (
        <section className="mb-12">
          <SectionHeader icon={Star} title="Featured" note="— a few to get you started" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURED.map((f) => {
              if (f.kind === 'era') {
                const m = eraCards.find((e) => e.era_theme === f.era_theme);
                return m ? renderEraCard(m) : null;
              }
              const rm = REGIONAL_MAPS.find((r) => r.map_id === f.map_id);
              return rm ? renderRegionalCard(rm) : null;
            })}
          </div>
        </section>
      )}

      {/* ── Built-in Era Maps ────────────────────────────────────────────── */}
      {showEras && (
        <section className="mb-12">
          <SectionHeader icon={Zap} title="Historical Era Maps" note="— Official built-in maps, in chronological order" />
          {eraLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-40 bg-gray-800 rounded-lg animate-pulse" />)}
            </div>
          ) : visibleEraCards.length === 0 ? (
            <p className="text-bf-muted text-sm">No era maps match “{search}”.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleEraCards.map(renderEraCard)}
            </div>
          )}
        </section>
      )}

      {/* ── Regional Maps (two sub-groups) ───────────────────────────────── */}
      {showRegional && (
        <section className="mb-12">
          <SectionHeader icon={Compass} title="Regional Maps" note="— Curated theaters & alternate histories" />

          {regionalGroups.theater.length === 0 && regionalGroups.alt.length === 0 ? (
            <p className="text-bf-muted text-sm">No regional maps match “{search}”.</p>
          ) : (
            <>
              {regionalGroups.theater.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-3 ml-7">
                    <Landmark className="w-4 h-4 text-bf-muted" />
                    <h3 className="font-display text-sm text-bf-text">Historical Theaters</h3>
                    <span className="text-bf-muted/70 text-xs">— set in a real historical period</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    {regionalGroups.theater.map(renderRegionalCard)}
                  </div>
                </>
              )}
              {regionalGroups.alt.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-3 ml-7">
                    <Sparkles className="w-4 h-4 text-bf-muted" />
                    <h3 className="font-display text-sm text-bf-text">Alternate Histories</h3>
                    <span className="text-bf-muted/70 text-xs">— counterfactual “what-if” scenarios</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {regionalGroups.alt.map(renderRegionalCard)}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Community Maps ───────────────────────────────────────────────── */}
      {showCommunity && (
        <section>
          <SectionHeader icon={Users} title="Community Maps" />
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
                <option value="modern">Modern</option>
                <option value="acw">American Civil War</option>
                <option value="custom">Community / Regional</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="text-bf-muted text-center py-12">Loading maps...</p>
          ) : visibleCommunity.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-bf-muted mb-4">
                {search
                  ? `No community maps match “${search}”.`
                  : mapEditorEnabled
                    ? 'No community maps yet. Be the first to create one!'
                    : 'No community maps published yet.'}
              </p>
              {mapEditorEnabled && !search && <Link to="/editor" className="btn-primary">Create a Map</Link>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleCommunity.map(renderCommunityCard)}
            </div>
          )}
        </section>
      )}
    </SubpageShell>
  );
}
