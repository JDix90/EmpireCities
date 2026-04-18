import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { GameLobbySnapshot } from '../../types/gameLobbyApi';

interface FactionInfo {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  home_region_ids?: string[];
}



interface FactionSelectionPanelProps {
  lobby: GameLobbySnapshot;
  eraId: string;
}


// ...existing code up to the first export default function...

export default function FactionSelectionPanel({ lobby, eraId }: FactionSelectionPanelProps) {
  const { user } = useAuthStore();
  const [factions, setFactions] = useState<FactionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null); // player_id being submitted

  // Host is the first non-AI player
  const host = lobby.players.find(p => !p.is_ai);
  const isHost = user?.user_id && host && host.user_id === user.user_id;

  useEffect(() => {
    setLoading(true);
    api.get(`/eras/${eraId}/factions`).then(res => {
      setFactions(res.data.factions ?? []);
    }).finally(() => setLoading(false));
  }, [eraId]);

  // Map of player_id to selected faction_id
  const playerFactions: Record<string, string | null> = {};
  lobby.players.forEach(p => {
    playerFactions[p.user_id || `ai_${p.player_index}`] = (p as any).faction_id || null;
  });

  // Set of all picked faction_ids
  const takenFactions = new Set(Object.values(playerFactions).filter(Boolean));

  const handleSelect = async (playerKey: string, factionId: string) => {
    setSubmitting(playerKey);
    try {
      await api.post(`/lobby/faction-select`, {
        game_id: lobby.game_id,
        player_id: playerKey.startsWith('ai_') ? null : playerKey,
        ai_index: playerKey.startsWith('ai_') ? Number(playerKey.replace('ai_', '')) : undefined,
        faction_id: factionId,
      });
    } catch (err) {
      // TODO: Show error toast
    } finally {
      setSubmitting(null);
    }
  };

  if (!lobby.settings_json?.factions_enabled) return null;

  return (
    <div className="card mb-6 animate-fade-in">
      <h3 className="font-display text-xl text-cc-gold mb-4">Faction Selection</h3>
      {loading ? (
        <p className="text-cc-muted">Loading factions…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-cc-muted border-b border-cc-border">
              <th className="text-left py-2">Player</th>
              <th className="text-left py-2">Faction</th>
            </tr>
          </thead>
          <tbody>
            {lobby.players.map((p) => {
              const playerKey = p.user_id || `ai_${p.player_index}`;
              const isMe = user?.user_id && p.user_id === user.user_id;
              const isAI = p.is_ai;
              const canPick = (isMe && !isAI) || (isHost && isAI);
              return (
                <tr key={playerKey} className="border-b border-cc-border last:border-0">
                  <td className="py-2 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: p.player_color }} />
                      {p.username || (isAI ? `AI Bot ${p.player_index}` : '—')}
                      {isMe && !isAI && <span className="ml-1 text-cc-gold text-xs">(you)</span>}
                      {isAI && isHost && <span className="ml-1 text-cc-muted text-xs">(host sets)</span>}
                    </span>
                  </td>
                  <td className="py-2">
                    {canPick ? (
                      <select
                        className="input"
                        value={playerFactions[playerKey] || ''}
                        disabled={!!submitting}
                        onChange={e => handleSelect(playerKey, e.target.value)}
                      >
                        <option value="">Pick faction…</option>
                        {factions.map(f => (
                          <option
                            key={f.faction_id}
                            value={f.faction_id}
                            disabled={takenFactions.has(f.faction_id) && playerFactions[playerKey] !== f.faction_id}
                          >
                            {f.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>
                        {(() => {
                          const f = factions.find(f => f.faction_id === playerFactions[playerKey]);
                          return f ? f.name : <span className="text-cc-muted">—</span>;
                        })()}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
