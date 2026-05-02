import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import FactionLoreModal, { type FactionLoreInfo } from '../components/game/FactionLoreModal';

const ERA_IDS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'space_age', 'galaxy_age'] as const;

export default function CodexPage() {
  const [eraFactions, setEraFactions] = useState<Record<string, FactionLoreInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FactionLoreInfo | null>(null);

  useEffect(() => {
    Promise.all(
      ERA_IDS.map((id) =>
        api
          .get<{ factions: FactionLoreInfo[] }>(`/eras/${id}/factions`)
          .then((r) => [id, r.data.factions ?? []] as const)
          .catch(() => [id, []] as const),
      ),
    )
      .then((pairs) => setEraFactions(Object.fromEntries(pairs)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl text-cc-gold mb-2">Faction Codex</h1>
      <p className="text-cc-muted text-sm mb-8">Browse all factions across every era.</p>

      {loading && <p className="text-cc-muted">Loading factions…</p>}

      {ERA_IDS.map((eraId) => {
        const factions = eraFactions[eraId] ?? [];
        if (!loading && factions.length === 0) return null;
        return (
          <section key={eraId} className="mb-10">
            <h2 className="font-display text-xl text-cc-text mb-4">
              {ERA_LABELS[eraId] ?? eraId}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {factions.map((f) => (
                <button
                  key={f.faction_id}
                  onClick={() => setSelected(f)}
                  className="text-left p-3 rounded-lg bg-cc-surface border border-cc-border
                             hover:border-cc-gold/40 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {f.color && (
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                    )}
                    <p className="font-medium text-cc-text text-sm truncate">{f.name}</p>
                  </div>
                  <p className="text-cc-muted text-xs line-clamp-2">{f.description}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {selected && <FactionLoreModal faction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
