/**
 * ChronoConquest — Era Selector Component
 * Displays the 5 built-in historical era maps as selectable cards.
 * Fetches live territory counts and descriptions from the API.
 */

import { useState, useEffect } from 'react';
import { Globe, Users, Map, Star } from 'lucide-react';
import { fetchEraMaps, MapSummary, ERA_METADATA } from '../../services/mapService';

interface EraSelectorProps {
  selectedEra: string;
  onSelect: (eraId: string, mapId: string) => void;
}

export default function EraSelector({ selectedEra, onSelect }: EraSelectorProps) {
  const [eraMaps, setEraMaps]   = useState<MapSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    fetchEraMaps()
      .then(maps => {
        setEraMaps(maps);
        setLoading(false);
      })
      .catch(() => {
        // Fallback to static data if API unavailable
        setEraMaps(FALLBACK_ERA_SUMMARIES);
        setLoading(false);
        setError('Using cached era data');
      });
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="h-32 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="text-yellow-400 text-xs mb-2">{error}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {eraMaps.map(map => {
          const meta      = ERA_METADATA[map.era_theme] || ERA_METADATA['ww2'];
          const isSelected = selectedEra === map.era_theme;

          return (
            <button
              key={map.map_id}
              onClick={() => onSelect(map.era_theme, map.map_id)}
              className={`
                relative p-4 rounded-lg border-2 text-left transition-all duration-200
                hover:scale-[1.02] hover:shadow-lg
                ${isSelected
                  ? 'border-yellow-400 bg-gray-700 shadow-yellow-400/20 shadow-lg'
                  : 'border-gray-600 bg-gray-800 hover:border-gray-400'
                }
              `}
            >
              {/* Era year badge */}
              <div
                className="absolute top-2 right-2 text-xs font-mono px-2 py-0.5 rounded"
                style={{ backgroundColor: meta.color + '33', color: meta.color }}
              >
                {meta.year}
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-yellow-400" />
              )}

              {/* Era name */}
              <h3 className="font-bold text-white mt-1 mb-1 pr-16" style={{ color: isSelected ? meta.color : 'white' }}>
                {meta.label}
              </h3>

              {/* Description */}
              <p className="text-gray-400 text-xs leading-relaxed mb-3 line-clamp-2">
                {meta.description}
              </p>

              {/* Stats row */}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Map size={11} />
                  {map.territory_count} territories
                </span>
                <span className="flex items-center gap-1">
                  <Globe size={11} />
                  {map.region_count} regions
                </span>
                {map.play_count > 0 && (
                  <span className="flex items-center gap-1">
                    <Users size={11} />
                    {map.play_count.toLocaleString()} plays
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Fallback static data (used if API is unavailable) ────────────────────────
const FALLBACK_ERA_SUMMARIES: MapSummary[] = [
  { map_id: 'era_ancient',   name: 'Ancient World (200 AD)',     description: '', era_theme: 'ancient',   territory_count: 28, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
  { map_id: 'era_medieval',  name: 'Medieval World (1200 AD)',   description: '', era_theme: 'medieval',  territory_count: 29, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
  { map_id: 'era_discovery', name: 'Age of Discovery (1600 AD)', description: '', era_theme: 'discovery', territory_count: 34, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
  { map_id: 'era_ww2',       name: 'World War II (1939–1945)',   description: '', era_theme: 'ww2',       territory_count: 35, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
  { map_id: 'era_coldwar',   name: 'Cold War (1947–1991)',       description: '', era_theme: 'coldwar',   territory_count: 44, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
  { map_id: 'era_modern',    name: 'The Modern Day',             description: '', era_theme: 'modern',    territory_count: 43, region_count: 8, is_public: true, play_count: 0, avg_rating: 0, creator_id: 'system' },
];
