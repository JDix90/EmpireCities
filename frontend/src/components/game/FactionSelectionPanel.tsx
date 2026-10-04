import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { GameLobbySnapshot } from '../../types/gameLobbyApi';
import FactionLoreModal, { type FactionLoreInfo } from './FactionLoreModal';
import { AiBadge } from '../ui/AiBadge';
import { AiStyleBadge } from '../ui/AiStyleBadge';
import { lobbyBotName, lobbyCommanders } from '../../utils/aiCommanders';
import { galaxySchismPickNote, galaxyTeamPickNote, seatsPerFaction } from '../../utils/lobbyEraMapCompatibility';

interface FactionInfo {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  color?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  stability_recovery_bonus?: number;
  ability_description?: string;
  home_region_ids?: string[];
}



interface FactionSelectionPanelProps {
  lobby: GameLobbySnapshot;
  eraId: string;
}

export default function FactionSelectionPanel({ lobby, eraId }: FactionSelectionPanelProps) {
  const { user } = useAuthStore();
  const [factions, setFactions] = useState<FactionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [loreFaction, setLoreFaction] = useState<FactionLoreInfo | null>(null);

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
    playerFactions[p.user_id || `ai_${p.player_index}`] = p.faction_id || null;
  });

  // Faction id -> seats holding it. A faction is taken once it has all the
  // seats it may: one, or two in a Galactic Age lobby of five seats or more.
  const holders = new Map<string, number>();
  for (const f of Object.values(playerFactions)) if (f) holders.set(f, (holders.get(f) ?? 0) + 1);
  const perFaction = seatsPerFaction(lobby.era_id, lobby.map_id, lobby.settings_json);
  const isTaken = (factionId: string, playerKey: string) =>
    playerFactions[playerKey] !== factionId && (holders.get(factionId) ?? 0) >= perFaction;

  const handleSelect = async (playerKey: string, factionId: string) => {
    setSubmitting(playerKey);
    try {
      await api.post(`/lobby/faction-select`, {
        game_id: lobby.game_id,
        player_id: playerKey.startsWith('ai_') ? null : playerKey,
        ai_index: playerKey.startsWith('ai_') ? Number(playerKey.replace('ai_', '')) : undefined,
        faction_id: factionId,
      });
    } catch {
      // TODO: Show error toast
    } finally {
      setSubmitting(null);
    }
  };

  if (!lobby.settings_json?.factions_enabled) return null;

  // A team lobby (Galactic Age 2v2, Allied houses): picking a faction picks a side.
  const teamNote = galaxyTeamPickNote(
    lobby.era_id,
    lobby.map_id,
    lobby.settings_json,
    (id) => factions.find((f) => f.faction_id === id)?.name ?? id,
  );
  // A free-for-all Schism lobby: picking a faction twice splits its world.
  const schismNote = galaxySchismPickNote(lobby.era_id, lobby.map_id, lobby.settings_json);

  return (
    <div className="card mb-6 animate-fade-in">
      <h3 className="font-display text-xl text-bf-gold mb-4">Faction Selection</h3>
      {teamNote && (
        <p className="text-xs text-bf-muted -mt-2 mb-3" data-testid="faction-team-note">{teamNote}</p>
      )}
      {schismNote && (
        <p className="text-xs text-bf-muted -mt-2 mb-3" data-testid="faction-schism-note">{schismNote}</p>
      )}
      {loading ? (
        <p className="text-bf-muted">Loading factions…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-bf-muted border-b border-bf-border">
              <th className="text-left py-2">Player</th>
              <th className="text-left py-2">Faction</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {lobby.players.map((p) => {
              const playerKey = p.user_id || `ai_${p.player_index}`;
              const commander = p.is_ai ? lobbyCommanders(lobby)?.[p.player_index] ?? null : null;
              const isMe = user?.user_id && p.user_id === user.user_id;
              const isAI = p.is_ai;
              const canPick = (isMe && !isAI) || (isHost && isAI);
              return (
                <tr key={playerKey} className="border-b border-bf-border last:border-0">
                  <td className="py-2 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: p.player_color }} />
                      {isAI ? lobbyBotName(p.player_index, lobbyCommanders(lobby)) : (p.username || '—')}
                      {isMe && !isAI && <span className="ml-1 text-bf-gold text-xs">(you)</span>}
                      {commander?.style && <AiStyleBadge style={commander.style} size="xs" showLabel={false} />}
                      {isAI && <AiBadge difficulty={p.ai_difficulty} size="xs" />}
                      {isAI && isHost && <span className="ml-1 text-bf-muted text-xs">(host sets)</span>}
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
                            disabled={isTaken(f.faction_id, playerKey)}
                          >
                            {f.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>
                        {(() => {
                          const f = factions.find(f => f.faction_id === playerFactions[playerKey]);
                          return f ? f.name : <span className="text-bf-muted">—</span>;
                        })()}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-2">
                    {(() => {
                      const selectedId = playerFactions[playerKey];
                      const f = selectedId ? factions.find(ff => ff.faction_id === selectedId) : null;
                      if (!f) return null;
                      return (
                        <button
                          onClick={() => setLoreFaction(f as FactionLoreInfo)}
                          className="p-1 text-bf-muted hover:text-bf-gold transition-colors"
                          title="Read faction lore"
                        >
                          <BookOpen className="w-4 h-4" />
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {loreFaction && <FactionLoreModal faction={loreFaction} onClose={() => setLoreFaction(null)} />}
    </div>
  );
}
