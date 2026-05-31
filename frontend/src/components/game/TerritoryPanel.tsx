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
import { REGION_CSS_COLORS } from '../../constants/regionColors';
import {
  getTerritoryPanelAbilities,
  TERRITORY_ABILITY_UI,
} from '../../utils/techAbilities';
import {
  getFactionTerritoryAbilities,
  FACTION_ABILITY_UI,
} from '../../utils/factionAbilities';
import {
  getGalaxyTerritoryLoreDetail,
  getGalaxyWorldLore,
} from '../../constants/galaxyLore';

interface TerritoryPanelProps {
  mapTerritories: Array<{
    territory_id: string;
    name: string;
    region_id: string;
    /** Galaxy maps: which world this territory belongs to (sol / verdan / rust / nexus_station). */
    world_id?: string;
  }>;
  mapRegions?: Array<{ region_id: string; name: string; bonus: number }>;
  onAttack: (fromId: string, toId: string) => void;
  onDraft: (territoryId: string, units: number) => void;
  onBuild?: (buildingType: string) => void;
  onNavalMove?: (fromId: string, toId: string, count: number) => void;
  onNavalAttack?: (fromId: string, toId: string) => void;
  onInfluence?: (targetId: string) => void;
  onProposeTruce?: (targetPlayerId: string) => void;
  onUseAbility?: (abilityId: string, targetId?: string) => void;
  techTree?: Array<{ tech_id: string; unlocks_ability?: string }>;
  /**
   * Optional copy shown when the selected territory is offworld (Moon / non-Sol
   * galaxy world) and the active player has not yet satisfied the orbit-access
   * gate. Backend remains authoritative; this is purely a UX hint that prevents
   * players from blindly clicking actions the server will reject.
   */
  orbitAccessHint?: string | null;
  /** Stable socket viewer id from `game:joined` — fixes draft UI when auth.user loads late */
  resolvedViewerPlayerId?: string | null;
  onClose: () => void;
}

export default function TerritoryPanel({
  mapTerritories,
  mapRegions,
  onAttack,
  onDraft,
  onBuild,
  onNavalMove,
  onNavalAttack,
  onInfluence,
  onProposeTruce,
  onUseAbility,
  techTree = [],
  orbitAccessHint,
  resolvedViewerPlayerId,
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
    ? computeDraftPool(
        gameState,
        user?.user_id,
        user?.username,
        draftUnitsRemaining,
        resolvedViewerPlayerId ?? null,
      )
    : 0;
  React.useEffect(() => {
    setDraftAmount((a) => (draftPool <= 0 ? 1 : Math.min(draftPool, Math.max(1, a))));
  }, [draftPool]);

  if (!selectedTerritory || !gameState) return null;

  const tState = gameState.territories[selectedTerritory];
  const mapTerritory = mapTerritories.find((t) => t.territory_id === selectedTerritory);
  if (!tState || !mapTerritory) return null;

  const owner = gameState.players.find((p) => p.player_id === tState.owner_id);
  const myPlayer = resolvedViewerPlayerId
    ? gameState.players.find((p) => p.player_id === resolvedViewerPlayerId)
    : gameState.players.find(
        (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
      );
  const myPlayerId = myPlayer?.player_id;
  const isMyTurn =
    !!myPlayerId &&
    gameState.players[gameState.current_player_index]?.player_id === myPlayerId;
  const isUnowned = tState.owner_id == null || tState.owner_id === '' || tState.owner_id === 'neutral';
  const isMine = !!myPlayerId && tState.owner_id === myPlayerId;
  const isEnemy = !!myPlayerId && !isUnowned && tState.owner_id !== myPlayerId;
  const isMobile = isMobileViewport();
  // Once the player has locked in an attacker on mobile, the panel should stay
  // compact whether they're viewing the attacker territory itself or sizing up
  // an enemy target. We strip non-essential info (region progress, stability,
  // fleet card, building panel) so the action button stays above the fold.
  const isAttackConfirmMode =
    isMobile &&
    !!attackSource &&
    gameState.phase === 'attack' &&
    (isEnemy || attackSource === selectedTerritory);
  const isViewingOwnAttacker = isAttackConfirmMode && attackSource === selectedTerritory;
  /** Keep Place reinforcements above the fold + clear of the nav bar (see `mobile-sheet-above-nav`). */
  const isMobileDraftPlacementMode =
    isMobile &&
    isMyTurn &&
    isMine &&
    gameState.phase === 'draft' &&
    draftPool > 0;
  const { sheetRef, handleProps } = useSwipeToDismiss({ onDismiss: onClose });

  // Pre-compute the truce relationship with this territory's owner so both the Combat and
  // Diplomacy sections can share the result without redundant lookups.
  const activeTruceEntry = myPlayer && owner
    ? gameState.diplomacy?.find(
        (e) =>
          (e.player_index_a === myPlayer.player_index && e.player_index_b === owner.player_index) ||
          (e.player_index_a === owner.player_index && e.player_index_b === myPlayer.player_index),
      )
    : undefined;
  const hasActiveTruce =
    activeTruceEntry?.status === 'truce' && (activeTruceEntry.truce_turns_remaining ?? 0) > 0;

  return (
    <div
      ref={isMobile ? sheetRef : undefined}
      className={clsx(
      'bg-cc-surface animate-fade-in',
      isMobile
        ? 'fixed mobile-sheet-above-nav inset-x-0 max-h-[60vh] mobile-bottom-sheet overflow-y-auto rounded-t-2xl border-t border-cc-border z-40 animate-slide-up'
        : 'absolute bottom-4 left-4 w-72 border border-cc-border rounded-xl shadow-2xl',
    )}>
      {/* Drag handle — mobile only (swipe-to-dismiss) */}
      {isMobile && (
        <div {...handleProps} className="sticky top-0 flex justify-center py-2.5 bg-cc-surface z-10 cursor-grab">
          <div className="w-8 h-1 rounded-full bg-cc-border" />
        </div>
      )}
      {/* Content */}
      <div className={isMobile ? 'px-4 pb-4 pb-safe' : 'p-4'}>
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
        <button
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-cc-muted hover:text-cc-text transition-colors -mr-2 -mt-1 shrink-0"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile draft: surface reinforcements first so Place is never buried under lore/stats. */}
      {isMobileDraftPlacementMode && orbitAccessHint && (
        <div
          role="status"
          className="mb-3 px-3 py-2 rounded-lg border border-amber-700/40 bg-amber-950/40 text-amber-200 text-xs leading-snug"
        >
          🌌 {orbitAccessHint}
        </div>
      )}
      {isMobileDraftPlacementMode && (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 p-3 bg-cc-dark rounded-lg">
            <Shield className="w-5 h-5 text-cc-muted shrink-0" />
            <span className="text-2xl font-bold text-cc-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
            <span className="text-cc-muted text-sm">units on this territory</span>
          </div>
          <div>
            <label className="label text-xs">Place reinforcements ({draftPool} remaining)</label>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-lg bg-cc-dark border border-cc-border text-cc-text text-lg font-bold hover:bg-cc-border transition-colors touch-manipulation shrink-0"
                  onClick={() => setDraftAmount((a) => Math.max(1, a - 1))}
                >
                  −
                </button>
                <span className="w-10 text-center font-mono text-lg text-cc-text">{draftAmount}</span>
                <button
                  type="button"
                  className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-lg bg-cc-dark border border-cc-border text-cc-text text-lg font-bold hover:bg-cc-border transition-colors touch-manipulation shrink-0"
                  onClick={() => setDraftAmount((a) => Math.min(draftPool, a + 1))}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="btn-primary w-full min-h-[48px] py-3 text-base touch-manipulation font-semibold"
                onClick={() => onDraft(selectedTerritory, draftAmount)}
              >
                Place {draftAmount} {draftAmount === 1 ? 'unit' : 'units'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Galaxy lore — shown above the region badge for galaxy_age maps. Mirrors the
          per-territory flavor strings in `constants/galaxyLore.ts` so non-galaxy maps
          render nothing here (lookup returns null). */}
      {!isAttackConfirmMode && !isMobileDraftPlacementMode && (() => {
        const territoryLore = getGalaxyTerritoryLoreDetail(mapTerritory.territory_id);
        const worldLore = getGalaxyWorldLore(mapTerritory.world_id);
        if (!territoryLore && !worldLore) return null;
        return (
          <div className="mb-3 px-3 py-2 rounded-lg border border-cc-border bg-[rgba(20,16,40,0.55)] text-xs leading-relaxed">
            {worldLore && (
              <>
                <div className="text-[10px] uppercase tracking-wider font-display text-cc-muted/80">
                  <span className="text-cc-gold">{worldLore.display_name}</span>
                  <span className="text-cc-muted"> · {worldLore.tagline}</span>
                </div>
                {worldLore.stakes && (
                  <p className="mt-1 text-[11px] text-cc-muted/90 leading-snug">{worldLore.stakes}</p>
                )}
              </>
            )}
            {territoryLore && (
              <div className="mt-2 space-y-1.5 border-t border-cc-border/40 pt-2">
                <p className="text-[11px] text-cc-text/88 leading-snug">
                  <span className="font-display text-cc-gold/90 not-italic mr-1">Frontier</span>
                  {territoryLore.frontier}
                </p>
                <p className="text-[11px] text-cc-text/85 leading-snug italic">
                  <span className="font-display text-cc-muted not-italic mr-1">Hold</span>
                  {territoryLore.hold}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Region Badge — hidden in attack-confirm mode to keep the panel compact */}
      {!isAttackConfirmMode && !isMobileDraftPlacementMode && (() => {
        if (!mapRegions || !mapTerritory.region_id || mapTerritory.region_id === 'sea_routes') return null;
        const regionDef = mapRegions.find((r) => r.region_id === mapTerritory.region_id);
        if (!regionDef) return null;
        const regionIdx = mapRegions.indexOf(regionDef);
        const regionColor = REGION_CSS_COLORS[regionIdx % REGION_CSS_COLORS.length];
        const regionTerritories = mapTerritories.filter((t) => t.region_id === mapTerritory.region_id);
        const totalInRegion = regionTerritories.length;
        const ownedInRegion = myPlayerId
          ? regionTerritories.filter((t) => gameState.territories[t.territory_id]?.owner_id === myPlayerId).length
          : 0;
        const controlsRegion = !!myPlayerId && totalInRegion > 0 && ownedInRegion === totalInRegion;
        return (
          <div className="mb-3 px-3 py-2 rounded-lg bg-cc-dark border border-cc-border text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: regionColor }} />
                <span className="font-semibold text-cc-text truncate">{regionDef.name}</span>
              </div>
              <span className="font-mono text-cc-gold font-semibold shrink-0 ml-2">+{regionDef.bonus}</span>
            </div>
            {myPlayerId && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${totalInRegion > 0 ? (ownedInRegion / totalInRegion) * 100 : 0}%`,
                      backgroundColor: controlsRegion ? '#ffd700' : regionColor,
                    }}
                  />
                </div>
                <span className={clsx('font-mono tabular-nums shrink-0', controlsRegion ? 'text-cc-gold' : 'text-cc-muted')}>
                  {ownedInRegion}/{totalInRegion}{controlsRegion && ' ✓'}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Unit Count — full detail; skipped in mobile draft placement (shown above). */}
      {!isMobileDraftPlacementMode && (
        isAttackConfirmMode ? (
        /* Compact inline unit display for attack-confirm mode */
        <div className="flex items-center gap-2 mb-3 px-1">
          <Shield className={clsx('w-4 h-4 shrink-0', isViewingOwnAttacker ? 'text-cc-gold' : 'text-cc-muted')} />
          <span className="text-xl font-bold text-cc-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
          <span className="text-cc-muted text-sm">
            {isViewingOwnAttacker ? 'units ready to attack' : 'defending units'}
          </span>
          {tState.naval_units != null && tState.naval_units > 0 && (
            <span className="ml-2 text-xs text-blue-300">· {tState.naval_units} fleet{tState.naval_units !== 1 ? 's' : ''}</span>
          )}
        </div>
      ) : (
        <>
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
              {tState.population != null && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-cc-muted">Population</span>
                  <span className="text-xs font-mono text-cc-text">{tState.population} / 10</span>
                </div>
              )}
              {tState.stability < 30 && (
                <p className="text-xs text-red-400 mt-1">⚠ Low stability — deploy cap reduced</p>
              )}
              {tState.stability <= 10 && (
                <p className="text-xs text-red-300 mt-0.5">⚠ Rebellion risk — territory may revolt</p>
              )}
            </div>
          )}
        </>
      ))}

      {orbitAccessHint && !isMobileDraftPlacementMode && (
        <div
          role="status"
          className="mx-3 mb-2 px-3 py-2 rounded-lg border border-amber-700/40 bg-amber-950/40 text-amber-200 text-xs leading-snug"
        >
          🌌 {orbitAccessHint}
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
          {isMine && gameState.phase === 'draft' && draftPool > 0 && !isMobileDraftPlacementMode && (
            <div>
              <label className="label text-xs">Place Reinforcements ({draftPool} remaining)</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setDraftAmount((a) => Math.max(1, a - 1))}
                >−</button>
                <span className="w-8 text-center font-mono text-cc-text">{draftAmount}</span>
                <button
                  type="button"
                  className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setDraftAmount((a) => Math.min(draftPool, a + 1))}
                >+</button>
                <button
                  type="button"
                  className="btn-primary text-sm py-1.5 px-4 flex-1 touch-manipulation min-h-[44px]"
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
                hasActiveTruce ? (
                  <button
                    className="btn-warning w-full text-sm flex items-center justify-center gap-2"
                    onClick={() => onAttack(attackSource, selectedTerritory)}
                  >
                    ⚠ Break Truce &amp; Attack
                  </button>
                ) : (
                  <button
                    className="btn-danger w-full text-sm flex items-center justify-center gap-2"
                    onClick={() => onAttack(attackSource, selectedTerritory)}
                  >
                    <Sword className="w-4 h-4" /> Attack from {attackSource.slice(0, 8)}...
                  </button>
                )
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
            </div>
          )}

          {/* Tech / faction ability buttons — phase-gated per each ability's own def.phase */}
          {onUseAbility && !attackSource && myPlayer && (() => {
            const techAbilities = getTerritoryPanelAbilities(gameState, myPlayer, techTree, {
              isEnemy,
              isMine,
            });
            const factionAbilities = getFactionTerritoryAbilities(gameState, myPlayer, {
              isEnemy,
              isMine,
            });
            const allAbilities = [...techAbilities, ...factionAbilities];
            if (allAbilities.length === 0) return null;
            return allAbilities.map((abilityId) => {
              const def = TERRITORY_ABILITY_UI[abilityId] ?? FACTION_ABILITY_UI[abilityId];
              if (!def) return null;
              const styleClass =
                def.style === 'danger'
                  ? 'border border-red-600/70 bg-red-950/50 text-red-300 hover:bg-red-900/50 hover:border-red-500'
                  : def.style === 'warning'
                    ? 'border border-amber-600/70 bg-amber-950/50 text-amber-300 hover:bg-amber-900/50 hover:border-amber-500'
                    : def.style === 'success'
                      ? 'border border-emerald-600/70 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-500'
                      : 'border border-blue-600/70 bg-blue-950/50 text-blue-300 hover:bg-blue-900/50 hover:border-blue-500';
              const needsTarget = def.enemyTarget !== null;
              const targetId = needsTarget ? selectedTerritory : undefined;
              return (
                <button
                  key={abilityId}
                  data-testid={`ability-btn-${abilityId}`}
                  className={clsx(
                    'w-full text-sm flex flex-col items-center justify-center gap-0.5 py-2 px-3 rounded-lg mt-2 transition-colors',
                    styleClass,
                  )}
                  onClick={() => {
                    onUseAbility(abilityId, targetId);
                    onClose();
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {def.emoji} {def.label}
                    <span className="text-xs opacity-70">
                      {def.scope === 'game' ? '(once per game)' : '(once per turn)'}
                    </span>
                  </span>
                  {'hint' in def && def.hint && (
                    <span className="text-[10px] opacity-60">{def.hint}</span>
                  )}
                </button>
              );
            });
          })()}

          {/* Diplomacy Section — shown for any enemy/unowned territory on your turn */}
          {(isEnemy || isUnowned) &&
           (gameState.era_modifiers?.influence_spread || gameState.era_modifiers?.carbonari_network || gameState.settings.diplomacy_enabled) && (
            <div className="mt-2 bg-cc-dark/30 border border-cc-border/50 rounded-lg p-2.5">
              <div className="text-xs font-bold text-purple-300 uppercase mb-2 tracking-wide">🤝 Diplomacy</div>

              {/* Outside attack phase: show a contextual hint so the section is never an empty puzzle */}
              {gameState.phase !== 'attack' ? (
                <p className="text-xs text-cc-muted/60 text-center py-1">
                  Available during your attack phase
                </p>
              ) : attackSource ? (
                /* Attack source is already locked in — diplomacy actions require a clean selection */
                <p className="text-xs text-cc-muted/60 text-center py-1">
                  Deselect your attacker to use diplomacy
                </p>
              ) : (
                <>
                  {/* Influence Spread / Carbonari Network */}
                  {(isEnemy || isUnowned) && onInfluence &&
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
                  {isEnemy && onProposeTruce && gameState.settings.diplomacy_enabled && tState.owner_id && (() => {
                    // activeTruceEntry and hasActiveTruce are computed at component scope above

                    if (hasActiveTruce && activeTruceEntry) {
                      return (
                        <p className="text-xs text-green-400/70 text-center py-1">
                          🤝 Truce with {owner?.username} ({activeTruceEntry.truce_turns_remaining} round{activeTruceEntry.truce_turns_remaining !== 1 ? 's' : ''} left)
                        </p>
                      );
                    }

                    // AI players never accept — surface this before the player wastes a click
                    if (owner?.is_ai) {
                      return (
                        <p className="text-xs text-cc-muted/50 text-center py-1">
                          🤖 AI players do not accept truces
                        </p>
                      );
                    }

                    // A proposal is already waiting for the target to respond
                    const pendingTruce = gameState.pending_truces?.find(
                      (pt) =>
                        (pt.proposer_id === myPlayerId && pt.target_id === tState.owner_id) ||
                        (pt.proposer_id === tState.owner_id && pt.target_id === myPlayerId),
                    );
                    if (pendingTruce) {
                      return (
                        <p className="text-xs text-yellow-400/70 text-center py-1">
                          🕐 Truce offer pending — awaiting {owner?.username}
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
                        🤝 Propose Truce <span className="text-green-400/60 text-xs">(3 rounds)</span>
                      </button>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Fortify Section */}
          {isMine && gameState.phase === 'fortify' && tState.unit_count > 1 && (
            <div>
              <div className="text-xs font-bold text-cc-muted uppercase mb-2 tracking-wide">→ Fortify</div>
              <label className="label text-xs">Move Units to Adjacent Territory</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                  onClick={() => setFortifyAmount((a) => Math.max(1, a - 1))}
                >−</button>
                <span className="w-8 text-center font-mono text-cc-text">{fortifyAmount}</span>
                <button
                  type="button"
                  className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
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
                        className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
                        onClick={() => setNavalMoveCount((a) => Math.max(1, a - 1))}
                      >−</button>
                      <span className="w-8 text-center font-mono text-cc-text">{navalMoveCount}</span>
                      <button
                        type="button"
                        className="w-11 h-11 rounded-lg bg-cc-dark border border-cc-border text-cc-text font-bold hover:bg-cc-border transition-colors shrink-0"
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

      {/* Economy buildings — hidden during attack-confirm to keep the attack flow distraction-free */}
      {!isAttackConfirmMode && !isMobileDraftPlacementMode && gameState.settings.economy_enabled && onBuild && (() => {
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
