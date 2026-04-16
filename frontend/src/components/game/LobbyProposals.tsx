import { useState, useEffect, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Plus, X, Clock } from 'lucide-react';
import clsx from 'clsx';
import { getSocket } from '../../services/socket';
import type { GameLobbySettingsJson } from '../../types/gameLobbyApi';

interface Proposal {
  id: string;
  proposer: string;
  proposerName: string;
  setting: string;
  label: string;
  displayValue: string;
  yesVotes: number;
  noVotes: number;
  playerCount: number;
  threshold: number;
  myVote: boolean | null;
  createdAt: number;
}

interface SettingOption {
  key: string;
  label: string;
  options: { value: unknown; display: string }[];
}

const PROPOSABLE_SETTINGS: SettingOption[] = [
  {
    key: 'fog_of_war',
    label: 'Fog of War',
    options: [
      { value: true, display: 'On' },
      { value: false, display: 'Off' },
    ],
  },
  {
    key: 'turn_timer_seconds',
    label: 'Turn Timer',
    options: [
      { value: 60, display: '1:00' },
      { value: 120, display: '2:00' },
      { value: 180, display: '3:00' },
      { value: 300, display: '5:00' },
      { value: 600, display: '10:00' },
      { value: 0, display: 'No limit' },
    ],
  },
  {
    key: 'diplomacy_enabled',
    label: 'Diplomacy',
    options: [
      { value: true, display: 'On' },
      { value: false, display: 'Off' },
    ],
  },
  {
    key: 'initial_unit_count',
    label: 'Starting Units',
    options: [
      { value: 1, display: '1' },
      { value: 3, display: '3' },
      { value: 5, display: '5' },
    ],
  },
  {
    key: 'factions_enabled',
    label: 'Factions',
    options: [
      { value: true, display: 'On' },
      { value: false, display: 'Off' },
    ],
  },
  {
    key: 'naval_enabled',
    label: 'Naval',
    options: [
      { value: true, display: 'On' },
      { value: false, display: 'Off' },
    ],
  },
];

interface LobbyProposalsProps {
  gameId: string;
  isHost: boolean;
  currentSettings: GameLobbySettingsJson | null;
}

export default function LobbyProposals({ gameId, isHost, currentSettings }: LobbyProposalsProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedSetting, setSelectedSetting] = useState<string>('');
  const [selectedValue, setSelectedValue] = useState<string>('');

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (data: Proposal[]) => setProposals(data);
    socket.on('game:lobby_proposal_update', onUpdate);
    return () => { socket.off('game:lobby_proposal_update', onUpdate); };
  }, [gameId]);

  const propose = useCallback(() => {
    if (!selectedSetting || selectedValue === '') return;
    const settingDef = PROPOSABLE_SETTINGS.find((s) => s.key === selectedSetting);
    if (!settingDef) return;
    const option = settingDef.options.find((o) => String(o.value) === selectedValue);
    if (!option) return;

    const socket = getSocket();
    socket.emit('game:lobby_propose', {
      gameId,
      setting: selectedSetting,
      value: option.value,
      label: settingDef.label,
      displayValue: option.display,
    });
    setShowForm(false);
    setSelectedSetting('');
    setSelectedValue('');
  }, [gameId, selectedSetting, selectedValue]);

  const vote = useCallback((proposalId: string, approve: boolean) => {
    const socket = getSocket();
    socket.emit('game:lobby_vote', { gameId, proposalId, approve });
  }, [gameId]);

  const settingDef = PROPOSABLE_SETTINGS.find((s) => s.key === selectedSetting);

  return (
    <div className="space-y-3">
      {/* Active proposals */}
      {proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => (
            <div
              key={p.id}
              className="p-3 bg-cc-dark rounded-lg border border-cc-border text-sm"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <span className="text-cc-muted text-xs">{p.proposerName} proposes:</span>
                  <p className="text-cc-text font-medium truncate">
                    {p.label} → <span className="text-cc-gold">{p.displayValue}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs text-cc-muted shrink-0">
                  <Clock className="w-3 h-3" />
                  {p.yesVotes}/{p.threshold}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-cc-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500/80 rounded-full transition-all"
                    style={{ width: `${(p.yesVotes / p.playerCount) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => vote(p.id, true)}
                  className={clsx(
                    'flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors',
                    p.myVote === true
                      ? 'bg-green-500/20 border-green-500/40 text-green-400'
                      : 'border-cc-border text-cc-muted hover:text-green-400 hover:border-green-500/30',
                  )}
                >
                  <ThumbsUp className="w-3 h-3" /> {p.yesVotes}
                </button>
                <button
                  type="button"
                  onClick={() => vote(p.id, false)}
                  className={clsx(
                    'flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors',
                    p.myVote === false
                      ? 'bg-red-500/20 border-red-500/40 text-red-400'
                      : 'border-cc-border text-cc-muted hover:text-red-400 hover:border-red-500/30',
                  )}
                >
                  <ThumbsDown className="w-3 h-3" /> {p.noVotes}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Propose new setting */}
      {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-cc-muted hover:text-cc-text py-2 border border-dashed border-cc-border rounded-lg hover:border-cc-gold/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Propose setting change
            </button>
          ) : (
            <div className="p-3 bg-cc-dark rounded-lg border border-cc-gold/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-cc-gold font-medium uppercase tracking-wide">New Proposal</span>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setSelectedSetting(''); setSelectedValue(''); }}
                  className="text-cc-muted hover:text-cc-text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <select
                value={selectedSetting}
                onChange={(e) => { setSelectedSetting(e.target.value); setSelectedValue(''); }}
                className="w-full bg-cc-surface border border-cc-border rounded px-2 py-1.5 text-sm text-cc-text"
              >
                <option value="">Select a setting…</option>
                {PROPOSABLE_SETTINGS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              {settingDef && (
                <select
                  value={selectedValue}
                  onChange={(e) => setSelectedValue(e.target.value)}
                  className="w-full bg-cc-surface border border-cc-border rounded px-2 py-1.5 text-sm text-cc-text"
                >
                  <option value="">Select a value…</option>
                  {settingDef.options
                    .filter((o) => {
                      // Don't show the current value as an option
                      const current = currentSettings?.[selectedSetting];
                      return String(o.value) !== String(current);
                    })
                    .map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>{o.display}</option>
                    ))}
                </select>
              )}
              <button
                type="button"
                onClick={propose}
                disabled={!selectedSetting || selectedValue === ''}
                className="btn-primary w-full text-sm py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit Proposal
              </button>
            </div>
          )}


    </div>
  );
}
