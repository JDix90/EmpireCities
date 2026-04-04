import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, X } from 'lucide-react';
import clsx from 'clsx';
import { computeDraftPool } from '../../utils/draftPool';

interface TerritoryPanelProps {
  mapTerritories: Array<{
    territory_id: string;
    name: string;
    region_id: string;
  }>;
  onAttack: (fromId: string, toId: string) => void;
  onDraft: (territoryId: string, units: number) => void;
  onFortify: (fromId: string, toId: string, units: number) => void;
  onClose: () => void;
}

export default function TerritoryPanel({
  mapTerritories,
  onAttack,
  onDraft,
  onFortify,
  onClose,
}: TerritoryPanelProps) {
  const { gameState, draftUnitsRemaining } = useGameStore();
  const { selectedTerritory, attackSource, setAttackSource, setFortifyUnits } = useUiStore();
  const { user } = useAuthStore();
  const [draftAmount, setDraftAmount] = React.useState(1);
  const [fortifyAmount, setFortifyAmount] = React.useState(1);

  const draftPool = gameState
    ? computeDraftPool(gameState, user?.user_id, draftUnitsRemaining)
    : 0;
  React.useEffect(() => {
    setDraftAmount((a) => (draftPool <= 0 ? 1 : Math.min(draftPool, Math.max(1, a))));
  }, [draftPool]);

  if (!selectedTerritory || !gameState) return null;

  const tState = gameState.territories[selectedTerritory];
  const mapTerritory = mapTerritories.find((t) => t.territory_id === selectedTerritory);
  if (!tState || !mapTerritory) return null;

  const owner = gameState.players.find((p) => p.player_id === tState.owner_id);
  const isMyTurn = gameState.players[gameState.current_player_index]?.player_id === user?.user_id;
  const isMine = tState.owner_id === user?.user_id;
  const isEnemy = tState.owner_id && tState.owner_id !== user?.user_id;

  return (
    <div className="absolute bottom-4 left-4 w-72 bg-cc-surface border border-cc-border rounded-xl shadow-2xl p-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display text-lg text-cc-gold">{mapTerritory.name}</h3>
          <p className="text-xs text-cc-muted mt-0.5">
            {owner ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: owner.color }} />
                {owner.username}
              </span>
            ) : 'Unowned'}
          </p>
        </div>
        <button onClick={onClose} className="text-cc-muted hover:text-cc-text transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Unit Count */}
      <div className="flex items-center gap-2 mb-4 p-3 bg-cc-dark rounded-lg">
        <Shield className="w-5 h-5 text-cc-muted" />
        <span className="text-2xl font-bold text-cc-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
        <span className="text-cc-muted text-sm">units</span>
      </div>

      {/* Actions */}
      {isMyTurn && (
        <div className="space-y-3">
          {/* Draft */}
          {isMine && gameState.phase === 'draft' && draftPool > 0 && (
            <div>
              <label className="label text-xs">Place Reinforcements ({draftPool} remaining)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input text-sm py-1.5 flex-1"
                  min={1}
                  max={draftPool}
                  value={draftAmount}
                  onChange={(e) => setDraftAmount(Math.min(draftPool, Math.max(1, Number(e.target.value))))}
                />
                <button
                  className="btn-primary text-sm py-1.5 px-4"
                  onClick={() => onDraft(selectedTerritory, draftAmount)}
                >
                  Place
                </button>
              </div>
            </div>
          )}

          {/* Attack */}
          {gameState.phase === 'attack' && (
            <>
              {isMine && tState.unit_count >= 2 && !attackSource && (
                <button
                  className="btn-primary w-full text-sm flex items-center justify-center gap-2"
                  onClick={() => setAttackSource(selectedTerritory)}
                >
                  <Sword className="w-4 h-4" /> Select as Attacker
                </button>
              )}
              {attackSource && isEnemy && attackSource !== selectedTerritory && (
                <button
                  className="btn-danger w-full text-sm flex items-center justify-center gap-2"
                  onClick={() => onAttack(attackSource, selectedTerritory)}
                >
                  <Sword className="w-4 h-4" /> Attack from {attackSource.slice(0, 8)}...
                </button>
              )}
              {attackSource === selectedTerritory && (
                <div>
                  <p className="text-cc-gold text-xs mb-2">Attacking from this territory. Select an enemy territory to attack.</p>
                  <button
                    className="btn-secondary w-full text-sm"
                    onClick={() => setAttackSource(null)}
                  >
                    Cancel Attack
                  </button>
                </div>
              )}
            </>
          )}

          {/* Fortify */}
          {isMine && gameState.phase === 'fortify' && tState.unit_count > 1 && (
            <div>
              <label className="label text-xs">Move Units to Adjacent Territory</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input text-sm py-1.5 flex-1"
                  min={1}
                  max={tState.unit_count - 1}
                  value={fortifyAmount}
                  onChange={(e) => setFortifyAmount(Math.min(tState.unit_count - 1, Math.max(1, Number(e.target.value))))}
                />
                <button
                  className="btn-secondary text-sm py-1.5 px-3"
                  onClick={() => {
                    setFortifyUnits(fortifyAmount);
                    setAttackSource(selectedTerritory);
                  }}
                >
                  Move
                </button>
              </div>
              <p className="text-xs text-cc-muted mt-1">Then click the destination territory.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
