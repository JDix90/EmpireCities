import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, X, Anchor, Flag } from 'lucide-react';
import clsx from 'clsx';
import { computeDraftPool } from '../../utils/draftPool';
import BuildingPanel from './BuildingPanel';
import { ERA_WONDERS } from '../../constants/eraWonders';
import { isMobileViewport } from '../../utils/device';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';

interface TerritoryPanelProps {
  mapTerritories: Array<{
    territory_id: string;
    name: string;
    region_id: string;
  }>;
  onAttack: (fromId: string, toId: string) => void;
  onDraft: (territoryId: string, units: number) => void;
  onFortify: (fromId: string, toId: string, units: number) => void;
  onBuild?: (buildingType: string) => void;
  onNavalMove?: (fromId: string, toId: string, count: number) => void;
  onNavalAttack?: (fromId: string, toId: string) => void;
  onInfluence?: (targetId: string) => void;
  onProposeTruce?: (targetPlayerId: string) => void;
  onAtomBomb?: (targetId: string) => void;
  onClose: () => void;
}

export default function TerritoryPanel({
  mapTerritories,
  onAttack,
  onDraft,
  onFortify,
  onBuild,
  onNavalMove,
  onNavalAttack,
  onInfluence,
  onProposeTruce,
  onAtomBomb,
  onClose,
  onClaimTerritory,
}: TerritoryPanelProps & { onClaimTerritory?: (territoryId: string) => void }) {
  const { gameState, draftUnitsRemaining } = useGameStore();
  const { selectedTerritory, attackSource, setAttackSource, setFortifyUnits, navalSource, setNavalSource } = useUiStore();
  const { user } = useAuthStore();
  const [draftAmount, setDraftAmount] = React.useState(1);
  const [fortifyAmount, setFortifyAmount] = React.useState(1);
  const [navalMoveCount, setNavalMoveCount] = React.useState(1);

  const draftPool = gameState
    ? computeDraftPool(gameState, user?.user_id, user?.username, draftUnitsRemaining)
    : 0;
  React.useEffect(() => {
    setDraftAmount((a) => (draftPool <= 0 ? 1 : Math.min(draftPool, Math.max(1, a))));
  }, [draftPool]);

  if (!selectedTerritory || !gameState) return null;

  const tState = gameState.territories[selectedTerritory];
  const mapTerritory = mapTerritories.find((t) => t.territory_id === selectedTerritory);
  if (!tState || !mapTerritory) return null;

  const owner = gameState.players.find((p) => p.player_id === tState.owner_id);
  const myPlayer = gameState.players.find(
    (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
  );
  const myPlayerId = myPlayer?.player_id;
  const isMyTurn = gameState.players[gameState.current_player_index]?.player_id === myPlayerId;
  const isUnowned = tState.owner_id == null || tState.owner_id === '' || tState.owner_id === 'neutral';
  const isMine = !!myPlayerId && tState.owner_id === myPlayerId;
  const isEnemy = !!myPlayerId && !isUnowned && tState.owner_id !== myPlayerId;
  const isMobile = isMobileViewport();
  const { sheetRef, handleProps } = useSwipeToDismiss({ onDismiss: onClose });

  return (
    <div
      ref={isMobile ? sheetRef : undefined}
      className={clsx(
      'bg-cc-surface animate-fade-in',
      isMobile
        ? 'fixed bottom-16 inset-x-0 max-h-[60vh] mobile-bottom-sheet overflow-y-auto rounded-t-2xl border-t border-cc-border z-30 animate-slide-up'
        : 'absolute bottom-4 left-4 w-72 border border-cc-border rounded-xl shadow-2xl',
    )}>
      {/* Drag handle — mobile only (swipe-to-dismiss) */}
      {isMobile && (
        <div {...handleProps} className="sticky top-0 flex justify-center py-2.5 bg-cc-surface z-10 cursor-grab">
          <div className="w-8 h-1 rounded-full bg-cc-border" />
        </div>
      )}
      {/* Content */}
      <div className={isMobile ? 'px-4 pb-4' : 'p-4'}>
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

      {/* Fleet Count (naval warfare) */}
      {tState.naval_units != null && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-cc-dark rounded-lg">
          <Anchor className="w-5 h-5 text-blue-400" />
          <span className="text-2xl font-bold text-cc-text">{tState.naval_units}</span>
          <span className="text-cc-muted text-sm">fleets</span>
        </div>
      )}

      {/* Stability Bar */}
      {gameState.settings.stability_enabled && tState.stability != null && (
        <div className="mb-4 p-3 bg-cc-dark rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-cc-muted">Stability</span>
            <span className="text-xs font-mono text-cc-text">{tState.stability}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', {
                'bg-green-500': tState.stability >= 80,
                'bg-yellow-500': tState.stability >= 50 && tState.stability < 80,
                'bg-orange-500': tState.stability >= 30 && tState.stability < 50,
                'bg-red-500': tState.stability < 30,
              })}
              style={{ width: `${tState.stability}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      {/* Territory Selection Claim */}
      {gameState.phase === 'territory_select' && isUnowned && onClaimTerritory && (
        <div className="p-3 border-t border-cc-border">
          <button
            className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            onClick={() => onClaimTerritory(selectedTerritory)}
          >
            <Flag className="w-4 h-4" /> Claim Territory
          </button>
        </div>
      )}

      {isMyTurn && (
        <div className="space-y-4">
          {/* Draft (always at top if available) */}
          {isMine && gameState.phase === 'draft' && draftPool > 0 && (
            <div>
              <label className="label text-xs">Place Reinforcements ({draftPool} remaining)</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setDraftAmount((a) => Math.max(1, a - 1))}
                >−</button>
                <span className="w-8 text-center font-mono text-cc-text">{draftAmount}</span>
                <button
                  type="button"
                  className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setDraftAmount((a) => Math.min(draftPool, a + 1))}
                >+</button>
                <button
                  className="btn-primary text-sm py-1.5 px-4 flex-1"
                  onClick={() => onDraft(selectedTerritory, draftAmount)}
                >
                  Place
                </button>
              </div>
            </div>
          )}

          {/* Combat Section */}
          {gameState.phase === 'attack' && (
            <div>
              <div className="text-xs font-bold text-cc-muted uppercase mb-2 tracking-wide">⚔ Combat</div>
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
              {/* Atom Bomb (WW2 era — once per game) */}
              {isEnemy && !attackSource && onAtomBomb && gameState.phase === 'attack' && isMyTurn && (() => {
                const myPlayer = gameState.players.find((p) => p.player_id === myPlayerId);
                const alreadyUsed = myPlayer?.used_game_abilities?.includes('atom_bomb');
                return (
                  <button
                    disabled={!!alreadyUsed}
                    className={clsx(
                      'w-full text-sm flex items-center justify-center gap-2 py-2 rounded-lg mt-2 transition-colors',
                      alreadyUsed
                        ? 'border border-gray-700 bg-gray-900/30 text-gray-600 cursor-not-allowed'
                        : 'border border-red-600/70 bg-red-950/50 text-red-300 hover:bg-red-900/50 hover:border-red-500',
                    )}
                    onClick={() => {
                      if (!alreadyUsed) { onAtomBomb(selectedTerritory); onClose(); }
                    }}
                  >
                    ☢️ Atom Bomb
                    <span className={clsx('text-xs', alreadyUsed ? 'text-gray-600' : 'text-red-400/70')}>
                      {alreadyUsed ? '(used)' : '(once per game)'}
                    </span>
                  </button>
                );
              })()}
            </div>
          )}

          {/* Diplomacy Section */}
          {gameState.phase === 'attack' && (
            (gameState.era_modifiers?.influence_spread || gameState.era_modifiers?.carbonari_network || gameState.settings.diplomacy_enabled) && (
              <div className="mt-2 bg-cc-dark/30 border border-cc-border/50 rounded-lg p-2.5">
                <div className="text-xs font-bold text-purple-300 uppercase mb-2 tracking-wide">🤝 Diplomacy</div>
                {/* Influence Spread / Carbonari Network */}
                {(isEnemy || isUnowned) && !attackSource && onInfluence &&
                 (gameState.era_modifiers?.influence_spread || gameState.era_modifiers?.carbonari_network) && (() => {
                  const cooldown = (gameState as any).influence_cooldown_remaining ?? 0;
                  const myPlayer = gameState.players.find((p) => p.player_id === myPlayerId);
                  const garibaldiUsed = (myPlayer?.ability_uses?.['riso_garibaldi'] ?? 0) >= 1;
                  const isGaribaldiTarget =
                    !!gameState.era_modifiers?.carbonari_network &&
                    myPlayer?.unlocked_techs?.includes('riso_garibaldi') &&
                    isUnowned &&
                    !garibaldiUsed;
                  if (cooldown > 0 && !isGaribaldiTarget) {
                    return (
                      <p className="text-xs text-purple-400/50 text-center py-1">
                        📡 Influence on cooldown ({cooldown} turn{cooldown > 1 ? 's' : ''})
                      </p>
                    );
                  }
                  if (!isGaribaldiTarget && tState.unit_count > 3) {
                    return (
                      <p className="text-xs text-purple-400/50 text-center py-1">
                        📡 Territory too well-defended (max 3 units)
                      </p>
                    );
                  }
                  return (
                    <button
                      className="w-full text-sm flex items-center justify-center gap-2 py-2 rounded-lg
                                 border border-purple-600/50 bg-purple-900/30 text-purple-200
                                 hover:bg-purple-800/40 hover:border-purple-500 transition-colors"
                      onClick={() => { onInfluence(selectedTerritory); onClose(); }}
                    >
                      📡 Seize via Influence{' '}
                      <span className="text-purple-400 text-xs">
                        {isGaribaldiTarget ? '(free — Garibaldi)' : '(costs 3 units)'}
                      </span>
                    </button>
                  );
                })()}
                {/* Propose Truce */}
                {isEnemy && !attackSource && onProposeTruce && gameState.settings.diplomacy_enabled && tState.owner_id && (() => {
                  const myPlayer = gameState.players.find((p) => p.player_id === myPlayerId);
                  const truceEntry = myPlayer && owner ? gameState.diplomacy?.find(
                    (e) =>
                      (e.player_index_a === myPlayer.player_index && e.player_index_b === owner.player_index) ||
                      (e.player_index_a === owner.player_index && e.player_index_b === myPlayer.player_index),
                  ) : undefined;
                  if (truceEntry?.status === 'truce') {
                    return (
                      <p className="text-xs text-green-400/70 text-center py-1">
                        🤝 Truce with {owner?.username} ({truceEntry.truce_turns_remaining} turns left)
                      </p>
                    );
                  }
                  return (
                    <button
                      className="w-full text-sm flex items-center justify-center gap-2 py-2 rounded-lg
                                 border border-green-600/40 bg-green-900/20 text-green-300
                                 hover:bg-green-800/30 hover:border-green-500/60 transition-colors"
                      onClick={() => { onProposeTruce(tState.owner_id!); onClose(); }}
                    >
                      🤝 Propose Truce <span className="text-green-400/60 text-xs">(3 turns)</span>
                    </button>
                  );
                })()}
              </div>
            )
          )}

          {/* Fortify Section */}
          {isMine && gameState.phase === 'fortify' && tState.unit_count > 1 && (
            <div>
              <div className="text-xs font-bold text-cc-muted uppercase mb-2 tracking-wide">→ Fortify</div>
              <label className="label text-xs">Move Units to Adjacent Territory</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setFortifyAmount((a) => Math.max(1, a - 1))}
                >−</button>
                <span className="w-8 text-center font-mono text-cc-text">{fortifyAmount}</span>
                <button
                  type="button"
                  className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setFortifyAmount((a) => Math.min(tState.unit_count - 1, a + 1))}
                >+</button>
                <button
                  className="btn-secondary text-sm py-1.5 px-3 flex-1"
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

          {/* Naval Section (collapsible) */}
          {gameState.settings.naval_enabled && tState.naval_units != null && (
            <details className="mt-2" open={!!navalSource}>
              <summary className="text-xs font-bold text-blue-300 uppercase mb-2 tracking-wide cursor-pointer select-none">
                ⚓ Naval ({tState.naval_units} fleet{tState.naval_units !== 1 ? 's' : ''})
              </summary>
              <div className="space-y-2 mt-2">
                {/* Select this territory as fleet source */}
                {isMine && tState.naval_units > 0 && !navalSource &&
                 (gameState.phase === 'attack' || gameState.phase === 'fortify') && (
                  <button
                    className="btn-secondary w-full text-sm flex items-center justify-center gap-2"
                    onClick={() => setNavalSource(selectedTerritory)}
                  >
                    <Anchor className="w-4 h-4" />
                    Select as Fleet Source ({tState.naval_units} fleet{tState.naval_units !== 1 ? 's' : ''})
                  </button>
                )}
                {/* This territory IS the active fleet source */}
                {navalSource === selectedTerritory && (
                  <div>
                    <p className="text-blue-300 text-xs mb-2">
                      Fleet source selected. Now click a destination territory.
                    </p>
                    <button
                      className="btn-secondary w-full text-sm"
                      onClick={() => setNavalSource(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {/* Move fleets to a friendly coastal territory */}
                {navalSource && navalSource !== selectedTerritory && isMine && onNavalMove &&
                 (gameState.phase === 'attack' || gameState.phase === 'fortify') && (
                  <div>
                    <label className="label text-xs">
                      Move fleets here (source: {gameState.territories[navalSource]?.naval_units ?? 0} available)
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                        onClick={() => setNavalMoveCount((a) => Math.max(1, a - 1))}
                      >−</button>
                      <span className="w-8 text-center font-mono text-cc-text">{navalMoveCount}</span>
                      <button
                        type="button"
                        className="w-10 h-10 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                        onClick={() => setNavalMoveCount((a) => Math.min(gameState.territories[navalSource]?.naval_units ?? 1, a + 1))}
                      >+</button>
                      <button
                        className="btn-secondary text-sm py-1.5 px-3 flex-1"
                        onClick={() => {
                          onNavalMove(navalSource, selectedTerritory, navalMoveCount);
                          setNavalSource(null);
                        }}
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )}
                {/* Naval attack: standalone fleet strike on enemy coastal territory */}
                {navalSource && navalSource !== selectedTerritory && isEnemy &&
                 gameState.phase === 'attack' && onNavalAttack && (
                  <button
                    className="btn-danger w-full text-sm flex items-center justify-center gap-2"
                    onClick={() => {
                      onNavalAttack(navalSource, selectedTerritory);
                      setNavalSource(null);
                    }}
                  >
                    <Anchor className="w-4 h-4" /> Fleet Attack
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Economy buildings */}
      {gameState.settings.economy_enabled && onBuild && (() => {
        // Compute era wonder state for this game
        const wonderMeta = gameState.era ? ERA_WONDERS[gameState.era] : undefined;
        let eraWonderProp: Parameters<typeof BuildingPanel>[0]['eraWonder'] = undefined;
        if (wonderMeta) {
          let alreadyBuilt = false;
          let builderName: string | undefined;
          for (const [tid, tState2] of Object.entries(gameState.territories)) {
            if (tState2.buildings?.includes(wonderMeta.wonder_id)) {
              alreadyBuilt = true;
              if (tid !== selectedTerritory) {
                builderName = gameState.players.find(
                  (p) => p.player_id === tState2.owner_id
                )?.username;
              }
              break;
            }
          }
          eraWonderProp = {
            id: wonderMeta.wonder_id,
            name: wonderMeta.name,
            description: wonderMeta.description,
            cost: wonderMeta.cost,
            alreadyBuilt,
            builderName,
          };
        }
        return (
          <BuildingPanel
            territoryId={selectedTerritory}
            buildings={tState.buildings ?? []}
            playerResources={gameState.players.find((p) => p.player_id === myPlayerId)?.special_resource ?? 0}
            isMine={isMine}
            isMyTurn={isMyTurn}
            phase={gameState.phase}
            onBuild={onBuild}
            isCoastal={tState.naval_units != null}
            eraWonder={eraWonderProp}
          />
        );
      })()}
      </div>
    </div>
  );
}
