import { useState, useEffect, useCallback, useMemo } from 'react';
import { ThumbsUp, ThumbsDown, Plus, X, Clock, Map as MapIcon, Settings2 } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { getSocket } from '../../services/socket';
import type { GameLobbySettingsJson } from '../../types/gameLobbyApi';
import { useAuthStore } from '../../store/authStore';
import {
  LOBBY_ERAS,
  isEraSelectableInLobby,
  isLobbyMapChangeAllowed,
  isSameMapSelection,
} from '../../constants/lobbyMapOptions';
import {
  LOBBY_THEATER_OPTIONS,
  buildMapMetaFromGameMap,
  evaluateEraMapCompatibility,
  formatRulesAndTheaterDisplay,
  recommendedRulesEraForTheater,
} from '../../utils/lobbyEraMapCompatibility';
import { fetchMapById, type GameMap } from '../../services/mapService';
import LobbyEraMapWarnings from '../lobby/LobbyEraMapWarnings';

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
  currentSettings: GameLobbySettingsJson | null;
  currentEraId: string;
  currentMapId: string;
  playerCount?: number;
}

function ProposalCard({
  proposal,
  onVote,
}: {
  proposal: Proposal;
  onVote: (proposalId: string, approve: boolean) => void;
}) {
  return (
    <div className="p-3 bg-bf-dark rounded-lg border border-bf-border text-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <span className="text-bf-muted text-xs">{proposal.proposerName} proposes:</span>
          <p className="text-bf-text font-medium truncate">
            {proposal.label} → <span className="text-bf-gold">{proposal.displayValue}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-bf-muted shrink-0">
          <Clock className="w-3 h-3" />
          {proposal.yesVotes}/{proposal.threshold}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-bf-border rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500/80 rounded-full transition-all"
            style={{ width: `${(proposal.yesVotes / proposal.playerCount) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => onVote(proposal.id, true)}
          aria-label={`Vote yes (${proposal.yesVotes} so far)`}
          className={clsx(
            'flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] min-w-[44px] rounded border transition-colors',
            proposal.myVote === true
              ? 'bg-green-500/20 border-green-500/40 text-green-400'
              : 'border-bf-border text-bf-muted hover:text-green-400 hover:border-green-500/30',
          )}
        >
          <ThumbsUp className="w-3.5 h-3.5" /> {proposal.yesVotes}
        </button>
        <button
          type="button"
          onClick={() => onVote(proposal.id, false)}
          aria-label={`Vote no (${proposal.noVotes} so far)`}
          className={clsx(
            'flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] min-w-[44px] rounded border transition-colors',
            proposal.myVote === false
              ? 'bg-red-500/20 border-red-500/40 text-red-400'
              : 'border-bf-border text-bf-muted hover:text-red-400 hover:border-red-500/30',
          )}
        >
          <ThumbsDown className="w-3.5 h-3.5" /> {proposal.noVotes}
        </button>
      </div>
    </div>
  );
}

export default function LobbyProposals({
  gameId,
  currentSettings,
  currentEraId,
  currentMapId,
  playerCount = 0,
}: LobbyProposalsProps) {
  const { user } = useAuthStore();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [showMapForm, setShowMapForm] = useState(false);
  const [showRulesForm, setShowRulesForm] = useState(false);
  const [selectedRulesEra, setSelectedRulesEra] = useState(currentEraId);
  const [selectedTheaterMapId, setSelectedTheaterMapId] = useState(currentMapId);
  const [theaterMapDoc, setTheaterMapDoc] = useState<GameMap | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<string>('');
  const [selectedValue, setSelectedValue] = useState<string>('');

  const mapChangeAllowed = isLobbyMapChangeAllowed(currentSettings);

  const currentMapLabel = useMemo(
    () => formatRulesAndTheaterDisplay(currentEraId, currentMapId),
    [currentEraId, currentMapId],
  );

  useEffect(() => {
    if (!showMapForm) return;
    setSelectedRulesEra(currentEraId);
    setSelectedTheaterMapId(currentMapId);
  }, [showMapForm, currentEraId, currentMapId]);

  useEffect(() => {
    if (!selectedTheaterMapId) return;
    let cancelled = false;
    fetchMapById(selectedTheaterMapId)
      .then((map) => { if (!cancelled) setTheaterMapDoc(map); })
      .catch(() => { if (!cancelled) setTheaterMapDoc(null); });
    return () => { cancelled = true; };
  }, [selectedTheaterMapId]);

  const pendingMapProposal = proposals.find((p) => p.setting === 'map_change');
  const pendingRuleProposals = proposals.filter((p) => p.setting !== 'map_change');

  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (data: Proposal[]) => setProposals(data);
    const onError = (payload: { message?: string }) => {
      if (payload?.message) toast.error(payload.message);
    };
    socket.on('game:lobby_proposal_update', onUpdate);
    socket.on('error', onError);
    return () => {
      socket.off('game:lobby_proposal_update', onUpdate);
      socket.off('error', onError);
    };
  }, [gameId]);

  const vote = useCallback((proposalId: string, approve: boolean) => {
    getSocket().emit('game:lobby_vote', { gameId, proposalId, approve });
  }, [gameId]);

  const previewSelection = useMemo(
    () => ({ era_id: selectedRulesEra, map_id: selectedTheaterMapId }),
    [selectedRulesEra, selectedTheaterMapId],
  );

  const previewCompatibility = useMemo(() => {
    const settings = (currentSettings ?? {}) as Record<string, unknown>;
    return evaluateEraMapCompatibility({
      era_id: previewSelection.era_id,
      map_id: previewSelection.map_id,
      settings,
      is_admin: user?.is_admin === true,
      player_count: playerCount,
      map_meta: theaterMapDoc ? buildMapMetaFromGameMap(theaterMapDoc) : null,
    });
  }, [previewSelection, currentSettings, user?.is_admin, playerCount, theaterMapDoc]);

  const proposeMapChange = useCallback(() => {
    if (!isEraSelectableInLobby(previewSelection.era_id, user)) {
      toast.error('Galactic Age is coming soon.');
      return;
    }
    if (previewCompatibility.hardBlock) {
      toast.error(previewCompatibility.hardBlock);
      return;
    }
    if (isSameMapSelection({ era_id: currentEraId, map_id: currentMapId }, previewSelection)) {
      toast.error('That pairing is already active.');
      return;
    }

    getSocket().emit('game:lobby_propose', {
      gameId,
      setting: 'map_change',
      value: previewSelection,
    });
    setShowMapForm(false);
    toast.success('Pairing change proposed — waiting for votes.');
  }, [gameId, previewSelection, previewCompatibility.hardBlock, currentEraId, currentMapId, user]);

  const proposeRuleChange = useCallback(() => {
    if (!selectedSetting || selectedValue === '') return;
    const settingDef = PROPOSABLE_SETTINGS.find((s) => s.key === selectedSetting);
    if (!settingDef) return;
    const option = settingDef.options.find((o) => String(o.value) === selectedValue);
    if (!option) return;

    getSocket().emit('game:lobby_propose', {
      gameId,
      setting: selectedSetting,
      value: option.value,
    });
    setShowRulesForm(false);
    setSelectedSetting('');
    setSelectedValue('');
  }, [gameId, selectedSetting, selectedValue]);

  const settingDef = PROPOSABLE_SETTINGS.find((s) => s.key === selectedSetting);

  const previewLabel = formatRulesAndTheaterDisplay(previewSelection.era_id, previewSelection.map_id);
  const previewIsCurrent = isSameMapSelection(
    { era_id: currentEraId, map_id: currentMapId },
    previewSelection,
  );

  return (
    <div className="space-y-4">
      {proposals.length > 0 && (
        <div className="space-y-2">
          {pendingMapProposal && (
            <ProposalCard proposal={pendingMapProposal} onVote={vote} />
          )}
          {pendingRuleProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onVote={vote} />
          ))}
        </div>
      )}

      {mapChangeAllowed && (
        <div className="rounded-lg border border-bf-border bg-bf-dark/40 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-bf-gold" />
              <div>
                <p className="text-xs font-medium text-bf-text">Rules &amp; Theater</p>
                <p className="text-[11px] text-bf-muted">Currently: {currentMapLabel}</p>
              </div>
            </div>
            {!showMapForm && !pendingMapProposal && (
              <button
                type="button"
                onClick={() => {
                  setShowMapForm(true);
                  setShowRulesForm(false);
                }}
                className="text-xs px-2.5 py-1.5 rounded border border-dashed border-bf-border text-bf-muted hover:text-bf-gold hover:border-bf-gold/30 transition-colors"
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Propose change
              </button>
            )}
          </div>

          {showMapForm && !pendingMapProposal && (
            <div className="space-y-3 pt-1 border-t border-bf-border/60">
              <div className="flex items-center justify-between">
                <span className="text-xs text-bf-gold font-medium uppercase tracking-wide">New pairing proposal</span>
                <button
                  type="button"
                  onClick={() => setShowMapForm(false)}
                  aria-label="Cancel map proposal"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-bf-muted hover:text-bf-text"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-bf-muted mb-1 block">
                  Rules era
                </label>
                <select
                  value={selectedRulesEra}
                  onChange={(e) => setSelectedRulesEra(e.target.value)}
                  className="w-full bg-bf-surface border border-bf-border rounded px-2 py-1.5 text-sm text-bf-text"
                >
                  {LOBBY_ERAS.map((era) => (
                    <option
                      key={era.id}
                      value={era.id}
                      disabled={!isEraSelectableInLobby(era.id, user)}
                    >
                      {era.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-bf-muted mb-1 block">
                  Theater map
                </label>
                <select
                  value={selectedTheaterMapId}
                  onChange={(e) => {
                    const mapId = e.target.value;
                    setSelectedTheaterMapId(mapId);
                    const suggested = recommendedRulesEraForTheater(mapId);
                    if (suggested && suggested !== selectedRulesEra) {
                      setSelectedRulesEra(suggested);
                    }
                  }}
                  className="w-full bg-bf-surface border border-bf-border rounded px-2 py-1.5 text-sm text-bf-text"
                >
                  {LOBBY_THEATER_OPTIONS.map((opt) => (
                    <option key={opt.map_id} value={opt.map_id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <LobbyEraMapWarnings
                hardBlock={previewCompatibility.hardBlock}
                warnings={previewCompatibility.warnings}
              />

              <p className="text-xs text-bf-muted">
                Proposed: <span className="text-bf-gold">{previewLabel}</span>
                {previewIsCurrent && <span className="text-amber-400 ml-1">(current)</span>}
              </p>

              <button
                type="button"
                onClick={proposeMapChange}
                disabled={previewIsCurrent || !!previewCompatibility.hardBlock}
                className="btn-primary w-full text-sm py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit pairing proposal
              </button>
              <p className="text-[11px] text-bf-muted leading-relaxed">
                Majority of players must approve. Faction picks reset if the map changes.
                {currentSettings?.era_advancement_enabled === true
                  ? ' Era Advancement turns off if you leave the Ancient era.'
                  : null}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-bf-border bg-bf-dark/40 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-bf-gold" />
            <p className="text-xs font-medium text-bf-text">Rule settings</p>
          </div>
          {!showRulesForm && (
            <button
              type="button"
              onClick={() => {
                setShowRulesForm(true);
                setShowMapForm(false);
              }}
              className="text-xs px-2.5 py-1.5 rounded border border-dashed border-bf-border text-bf-muted hover:text-bf-gold hover:border-bf-gold/30 transition-colors"
            >
              <Plus className="w-3 h-3 inline mr-1" />
              Propose change
            </button>
          )}
        </div>

        {showRulesForm && (
          <div className="space-y-3 pt-1 border-t border-bf-border/60">
            <div className="flex items-center justify-between">
              <span className="text-xs text-bf-gold font-medium uppercase tracking-wide">New rule proposal</span>
              <button
                type="button"
                onClick={() => {
                  setShowRulesForm(false);
                  setSelectedSetting('');
                  setSelectedValue('');
                }}
                aria-label="Cancel rule proposal"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-bf-muted hover:text-bf-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={selectedSetting}
              onChange={(e) => {
                setSelectedSetting(e.target.value);
                setSelectedValue('');
              }}
              className="w-full bg-bf-surface border border-bf-border rounded px-2 py-1.5 text-sm text-bf-text"
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
                className="w-full bg-bf-surface border border-bf-border rounded px-2 py-1.5 text-sm text-bf-text"
              >
                <option value="">Select a value…</option>
                {settingDef.options
                  .filter((o) => {
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
              onClick={proposeRuleChange}
              disabled={!selectedSetting || selectedValue === ''}
              className="btn-primary w-full text-sm py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit rule proposal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
