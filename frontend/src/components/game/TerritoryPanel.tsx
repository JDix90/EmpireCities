import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, X, Anchor, Flag, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { computeDraftPool } from '../../utils/draftPool';
import { canOfferBlitz } from '../../utils/blitzEligibility';
import { plural } from '../../utils/plural';
import { useAttackBlitzEnabled } from '../../store/featureFlagsStore';
import { getFastCombatPreference } from '../../utils/userPreferences';
import { isFogHidden } from '../../utils/fogVisibility';
import BuildingPanel from './BuildingPanel';
import { ERA_WONDERS } from '../../constants/eraWonders';
import { resolvePlayerTechEraId } from '../../utils/eraAdvancement';
import { isMobileViewport } from '../../utils/device';
import { useBottomSheetSnap, type SheetSnap } from '../../hooks/useBottomSheetSnap';
import { getRegionCssColors } from '../../constants/accessibleColors';
import { getPlayerTerritoryAbilities, isAttackSelfBuffAbility } from '../../utils/playerAbilities';
import { getAbilityUiDef } from '../../utils/abilityActivationFeedback';
import {
  getGalaxyTerritoryLoreDetail,
  getGalaxyWorldLore,
} from '../../constants/galaxyLore';
import NeighborTerritoryPicker from './NeighborTerritoryPicker';
import {
  listNeighborTargets,
  listDirectAttackSources,
  canAttackFrom,
  listBorderingOwned,
  MIN_ATTACK_UNITS,
  type MapConnection,
} from '../../utils/mapAdjacencyTargets';
import { effectiveContinentBonus } from '../../utils/continentBonus';
import { inferWorldId } from '@borderfall/shared';
import {
  EMERGENCY_SEAL_ABILITY_ID,
  describeLaneDice,
  describeLaneSeal,
  convoysFor,
  describeConvoy,
  describeLaneKind,
  describeLaneState,
  describeWorldModifiers,
  describeWorldRules,
  gatewayLanesFor,
  laneAttackDiceCap,
  laneSealFor,
  laneStateFor,
  laneTouchesSealWorld,
  vaultViews,
  worldDisplayName,
} from '../../utils/galaxyLanes';
import { countOwnedLunarTerritories } from '../../utils/orbitAccess';
import { dropAssaultsTargeting } from '../../utils/dropAssaults';

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
  /** "Blitz until captured" (game:attack_blitz). Absent = affordance hidden. */
  onBlitzAttack?: (fromId: string, toId: string) => void;
  onDraft: (territoryId: string, units: number) => void;
  /** Undo the last placement this turn. Absent = affordance hidden. */
  onDraftUndo?: () => void;
  /**
   * True when the LAST placement this turn landed on the selected territory,
   * i.e. when `onDraftUndo` would revert units the player can see right here.
   * The undo only ever reverses the most recent placement, so offering it on
   * every territory during a multi-territory draft made a stray tap on the
   * wrong panel silently pull units back out of somewhere else. When false the
   * button is not rendered at all (the HUD keeps its global "Undo last
   * placement" as the deliberate path).
   */
  canDraftUndo?: boolean;
  onBuild?: (buildingType: string) => void;
  onNavalMove?: (fromId: string, toId: string, count: number) => void;
  onNavalAttack?: (fromId: string, toId: string) => void;
  onInfluence?: (targetId: string) => void;
  onProposeTruce?: (targetPlayerId: string) => void;
  onUseAbility?: (abilityId: string, targetId?: string) => void;
  techTree?: Array<{ tech_id: string; name?: string; unlocks_ability?: string; unlocks_building?: string }>;
  /** Open the tech tree — a building locked behind an unresearched tech links to it. */
  onOpenTechTree?: () => void;
  /**
   * Optional copy shown when the selected territory is offworld (Moon / non-Sol
   * galaxy world) and the active player has not yet satisfied the orbit-access
   * gate. Backend remains authoritative; this is purely a UX hint that prevents
   * players from blindly clicking actions the server will reject.
   */
  orbitAccessHint?: string | null;
  /** Galaxy: whether the viewing player can currently traverse hyperspace lanes. */
  orbitAccessAllowed?: boolean;
  /** Reason hyperspace travel is blocked — shown on locked cross-world targets. */
  orbitAccessReason?: string | null;
  /** Stable socket viewer id from `game:joined` — fixes draft UI when auth.user loads late */
  resolvedViewerPlayerId?: string | null;
  mapConnections?: MapConnection[];
  /** Galaxy maps: authored world names, for the gateway badge's far-world label. */
  mapWorlds?: Array<{ world_id: string; display_name: string }>;
  /**
   * Seal an orbit lane leaving this gateway. Absent = affordance hidden.
   *
   * One prop, both mechanics: the Space Age Orbital Blockade (Moon Race, Phase
   * 4) has no strategic view to seal from, so without a panel affordance it
   * would be a mechanic only bots could use; the Galactic Age fires its
   * Emergency Seal from here too (Void Custodians, or the Vault holder).
   */
  onSealLane?: (fromId: string, toId: string) => void;
  /** The viewer holds the Vault: their seal closes ANY lane, not only Nexus's. */
  sealAnyLane?: boolean;
  denseMap?: boolean;
  onFortifyTo?: (fromId: string, toId: string) => void;
  onClose: () => void;
  sheetSnap?: SheetSnap;
  onSheetSnapChange?: (snap: SheetSnap) => void;
}

/**
 * Reinforcement placement: the most repeated action in the game.
 *
 * It used to be a single-step −/n/+ counter plus a Place button, so putting
 * four units on one territory cost five taps and every placement started back
 * at 1. These place on the first tap instead, with Undo (server-backed,
 * `game:draft_undo`) as the safety net rather than a pre-commit counter.
 */
/**
 * A −/value/+ dial with +5 and "all" shortcuts, clamped to `max`.
 *
 * Shared by draft placement and fortify so the two read the same and cannot
 * drift. Draft keeps its original `draft-*` test ids through `testIdPrefix`.
 * The caller owns the value, because fortify's amount has to survive the
 * destination picker re-rendering beneath it.
 */
export function AmountDial({
  max,
  value,
  onChange,
  testIdPrefix,
  size = 'md',
  allLabel,
}: {
  max: number;
  value: number;
  onChange: (n: number) => void;
  testIdPrefix: string;
  size?: 'md' | 'lg';
  allLabel: string;
}) {
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(1, max));
  const shown = clamp(value);
  const big = size === 'lg';
  const btn = clsx(
    'rounded-lg border border-bf-border bg-bf-dark text-bf-text font-semibold',
    'hover:bg-bf-border transition-colors touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed',
    big ? 'min-h-[48px] px-3 text-base' : 'min-h-[44px] px-3 text-sm',
  );
  const stepBtn = clsx(btn, big ? 'min-w-[48px]' : 'min-w-[44px]');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={stepBtn}
        data-testid={`${testIdPrefix}-amount-dec`}
        aria-label="One fewer unit"
        disabled={shown <= 1}
        onClick={() => onChange(clamp(shown - 1))}
      >
        −
      </button>
      <span
        className={clsx(
          'tabular-nums text-center font-bold text-bf-gold',
          big ? 'min-w-[3rem] text-2xl' : 'min-w-[2.5rem] text-xl',
        )}
        data-testid={`${testIdPrefix}-amount`}
        aria-live="polite"
        aria-label={`${shown} of ${max} units selected`}
      >
        {shown}
      </span>
      <button
        type="button"
        className={stepBtn}
        data-testid={`${testIdPrefix}-amount-inc`}
        aria-label="One more unit"
        disabled={shown >= max}
        onClick={() => onChange(clamp(shown + 1))}
      >
        +
      </button>
      {/* A long dial is its own kind of tedium: skip five at a time when
          there are at least that many to move. */}
      {max >= 5 && (
        <button
          type="button"
          className={btn}
          data-testid={`${testIdPrefix}-amount-plus5`}
          aria-label="Five more units"
          disabled={shown >= max}
          onClick={() => onChange(clamp(shown + 5))}
        >
          +5
        </button>
      )}
      <button
        type="button"
        className={btn}
        data-testid={`${testIdPrefix}-amount-all`}
        disabled={shown >= max}
        onClick={() => onChange(max)}
      >
        {allLabel}
      </button>
    </div>
  );
}

/**
 * Reinforcement placement: dial an amount, place it once.
 *
 * This used to be +1 / +5 / Place all, where every button committed
 * immediately — so putting three units somewhere meant three clicks and three
 * server round trips, each one re-rendering the panel under the player's
 * cursor. Any amount that wasn't 1, 5 or the whole pool was pure repetition,
 * which is most of them.
 *
 * The stepper holds a pending amount instead and `onPlace` fires once. One
 * unit is still a single press of the primary button (the amount starts at 1),
 * "All" is two, and everything in between is finally reachable without
 * hammering +1. Undo is unchanged — it reverts the last committed placement,
 * not the dial.
 */
export function QuickPlace({
  pool,
  size = 'md',
  onPlace,
  onUndo,
  canUndo,
}: {
  pool: number;
  size?: 'md' | 'lg';
  onPlace: (units: number) => void;
  onUndo?: () => void;
  canUndo?: boolean;
}) {
  const [amount, setAmount] = useState(1);
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(1, pool));
  // The pool shrinks as placements land and changes with the selected
  // territory; never leave the dial showing more than the player still holds.
  useEffect(() => {
    setAmount((a) => Math.min(a, Math.max(1, pool)));
  }, [pool]);

  const big = size === 'lg';
  const btn = clsx(
    'rounded-lg border border-bf-border bg-bf-dark text-bf-text font-semibold',
    'hover:bg-bf-border transition-colors touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed',
    big ? 'min-h-[48px] px-3 text-base' : 'min-h-[44px] px-3 text-sm',
  );
  const shown = clamp(amount);

  return (
    <div className="space-y-2">
      <AmountDial
        max={pool}
        value={amount}
        onChange={setAmount}
        testIdPrefix="draft"
        size={size}
        allLabel={`All ${pool}`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={clsx(btn, 'btn-primary flex-1')}
          data-testid="draft-place"
          onClick={() => {
            onPlace(shown);
            setAmount(1);
          }}
        >
          Place {shown}
        </button>
        {onUndo && (
          <button
            type="button"
            className={btn}
            disabled={!canUndo}
            data-testid="draft-undo"
            onClick={onUndo}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}

export default function TerritoryPanel({
  mapTerritories,
  mapRegions,
  onAttack,
  onBlitzAttack,
  onDraft,
  onDraftUndo,
  canDraftUndo,
  onBuild,
  onNavalMove,
  onNavalAttack,
  onInfluence,
  onProposeTruce,
  onUseAbility,
  techTree = [],
  onOpenTechTree,
  orbitAccessHint,
  orbitAccessAllowed = true,
  orbitAccessReason,
  resolvedViewerPlayerId,
  mapConnections = [],
  mapWorlds,
  onSealLane,
  sealAnyLane = false,
  denseMap = false,
  onFortifyTo,
  onClose,
  onClaimTerritory,
  sheetSnap = 'half',
  onSheetSnapChange,
}: TerritoryPanelProps & { onClaimTerritory?: (territoryId: string) => void }) {
  const { gameState, draftUnitsRemaining } = useGameStore();
  const attackBlitzFlag = useAttackBlitzEnabled();
  const {
    selectedTerritory,
    attackSource,
    setAttackSource,
    setSelectedTerritory,
    setFortifyUnits,
    navalSource,
    setNavalSource,
  } = useUiStore();
  const { user } = useAuthStore();
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
  // Fog-of-war: server sends unit_count -1 (and strips buildings/fleets/stability)
  // for territories this player hasn't revealed. Don't render scouting intel for them.
  const fogHidden = isFogHidden(tState);
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
  const isMobileActionMode =
    isMobile &&
    isMyTurn &&
    (gameState.phase === 'attack' || gameState.phase === 'fortify');
  const isMobileCompactInfo = isMobileActionMode || isMobileDraftPlacementMode;
  const useCompactUnitRow = isMobileActionMode || isAttackConfirmMode;

  const handleSnapChange = onSheetSnapChange ?? (() => {});
  const { sheetRef, handleProps, expandSnap, snapClassName } = useBottomSheetSnap({
    snap: sheetSnap,
    onSnapChange: handleSnapChange,
    onDismiss: onClose,
  });

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

  const territoryNameById = React.useMemo(
    () => new Map(mapTerritories.map((t) => [t.territory_id, t.name])),
    [mapTerritories],
  );

  /** territory_id → destination world display name, for labelling hyperspace targets. */
  const worldNameByTerritoryId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const t of mapTerritories) {
      const lore = getGalaxyWorldLore(inferWorldId(t));
      if (lore) m.set(t.territory_id, lore.display_name);
    }
    return m;
  }, [mapTerritories]);

  const attackNeighborSourceId = attackSource ?? (isMine && gameState.phase === 'attack' ? selectedTerritory : null);
  const attackNeighbors = React.useMemo(() => {
    if (!isMyTurn || gameState.phase !== 'attack' || !attackNeighborSourceId || !myPlayerId) return [];
    // Ownership AND the one-must-stay-behind minimum. Adjacency alone would list
    // neighbours for a drained stack, and now that the rows fire the attack
    // rather than merely navigating, every one would be a guaranteed error toast.
    if (!canAttackFrom(gameState, attackNeighborSourceId, myPlayerId)) return [];
    return listNeighborTargets(gameState, mapConnections, attackNeighborSourceId, territoryNameById, {
      attackSource: attackNeighborSourceId,
      worldNameOf: (id) => worldNameByTerritoryId.get(id),
    });
  }, [
    isMyTurn,
    gameState,
    attackNeighborSourceId,
    mapConnections,
    territoryNameById,
    worldNameByTerritoryId,
    myPlayerId,
  ]);

  /** Galaxy corridors: stamp each cross-world attack row with the dice it rolls. */
  const attackNeighborsWithLaneDice = React.useMemo(() => {
    const cap = laneAttackDiceCap(gameState, myPlayerId);
    if (cap == null) return attackNeighbors;
    return attackNeighbors.map((n) => (n.isOrbit ? { ...n, laneDice: cap } : n));
  }, [attackNeighbors, gameState, myPlayerId]);

  /**
   * Can the armed attacker actually strike the territory being viewed? Reuses the
   * same legality the neighbour picker runs on (adjacency, plus sea/orbit and
   * fleet rules), so the panel can't offer an attack the server will reject.
   */
  const canAttackSelectedFromSource = React.useMemo(
    () => attackNeighbors.some((n) => n.territoryId === selectedTerritory),
    [attackNeighbors, selectedTerritory],
  );

  /**
   * Which of my territories could strike the enemy I'm currently looking at, so
   * landing on an enemy panel with nothing armed offers the attack instead of
   * dead-ending. `attackSource` set means an attacker is already chosen and the
   * regular attack button below covers it.
   */
  const directAttackSources = React.useMemo(
    () =>
      isMyTurn && (isEnemy || isUnowned) && !attackSource
        ? listDirectAttackSources(gameState, mapConnections, selectedTerritory, myPlayerId, territoryNameById, {
            worldNameOf: (id) => worldNameByTerritoryId.get(id),
          })
        : [],
    [
      isMyTurn,
      gameState,
      isEnemy,
      isUnowned,
      myPlayerId,
      attackSource,
      selectedTerritory,
      mapConnections,
      territoryNameById,
      worldNameByTerritoryId,
    ],
  );

  /**
   * My territories touching this one, however thin. Only used to explain why no
   * attack is on offer — "nothing borders it" and "what borders it is too thin"
   * need different advice, and an empty Combat section gives neither.
   */
  const borderingOwned = React.useMemo(
    () =>
      gameState.phase === 'attack'
        ? listBorderingOwned(gameState, mapConnections, selectedTerritory, myPlayerId)
        : [],
    [gameState, mapConnections, selectedTerritory, myPlayerId],
  );

  // "Blitz until captured": same legality as the single attack, minus the
  // cases the server refuses to auto-repeat (sea lanes, truces, dailies).
  const attackConnectionType = attackSource
    ? mapConnections?.find(
        (c) =>
          (c.from === attackSource && c.to === selectedTerritory) ||
          (c.from === selectedTerritory && c.to === attackSource),
      )?.type
    : undefined;
  const blitzOffered =
    !!onBlitzAttack &&
    canOfferBlitz({
      flagEnabled: attackBlitzFlag,
      hasActiveTruce,
      connectionType: attackConnectionType,
      isDailyChallenge:
        typeof gameState.settings?.daily_challenge_date === 'string' &&
        gameState.settings.daily_challenge_date.length > 0,
    });
  const blitzIsPrimary = blitzOffered && getFastCombatPreference();

  /** Does at least one direct-attack source support blitz? Drives column alignment. */
  const blitzOfferedForAnySource =
    !!onBlitzAttack &&
    directAttackSources.some((src) =>
      canOfferBlitz({
        flagEnabled: attackBlitzFlag,
        hasActiveTruce,
        connectionType: src.connectionType,
        isDailyChallenge:
          typeof gameState.settings?.daily_challenge_date === 'string' &&
          gameState.settings.daily_challenge_date.length > 0,
      }),
    );

  const fortifyNeighborSourceId =
    gameState.phase === 'fortify' && attackSource && gameState.territories[attackSource]?.owner_id === myPlayerId
      ? attackSource
      : gameState.phase === 'fortify' && isMine && (tState.unit_count > 1)
        ? selectedTerritory
        : null;
  // Units the fortify source can spare — it must leave one behind. The picker's
  // source is not always the selected territory, so both fortify controls size
  // themselves from this rather than from tState.
  const fortifyMax = Math.max(
    1,
    (fortifyNeighborSourceId
      ? gameState.territories[fortifyNeighborSourceId]?.unit_count ?? 1
      : tState.unit_count) - 1,
  );
  // Switching source mid-phase must not leave the dial promising more than the
  // new source holds; GamePage clamps the emit too, but a stale number on
  // screen is its own bug.
  React.useEffect(() => {
    setFortifyAmount((a) => Math.min(a, fortifyMax));
  }, [fortifyMax]);
  const fortifyNeighbors = React.useMemo(() => {
    if (!isMyTurn || !fortifyNeighborSourceId || !myPlayerId) return [];
    return listNeighborTargets(gameState, mapConnections, fortifyNeighborSourceId, territoryNameById, {
      attackSource: fortifyNeighborSourceId,
      worldNameOf: (id) => worldNameByTerritoryId.get(id),
    });
  }, [isMyTurn, gameState, fortifyNeighborSourceId, mapConnections, territoryNameById, worldNameByTerritoryId, myPlayerId]);

  return (
    <div
      ref={isMobile ? sheetRef : undefined}
      className={clsx(
      'bg-bf-surface animate-fade-in',
      isMobile
        ? clsx(
            'fixed mobile-sheet-above-nav inset-x-0 overflow-y-auto rounded-t-2xl border-t border-bf-border z-40 animate-slide-up',
            snapClassName,
          )
        // Capped to the map pane (it is positioned inside it) and scrolls
        // internally: a territory with buildings, abilities, a neighbor picker
        // and lore used to grow straight past the top of the viewport, leaving
        // the header and close button unreachable.
        : 'absolute bottom-4 left-4 w-72 max-h-[calc(100%-2rem)] overflow-y-auto overscroll-contain border border-bf-border rounded-xl shadow-2xl',
    )}>
      {/* Drag handle — mobile only (swipe / snap) */}
      {isMobile && (
        <div {...handleProps} className="sticky top-0 flex items-center justify-center gap-2 py-2.5 bg-bf-surface z-10 cursor-grab">
          <div className="w-8 h-1 rounded-full bg-bf-border" />
          {sheetSnap !== 'full' && (
            <button
              type="button"
              className="absolute right-3 min-h-[32px] min-w-[32px] flex items-center justify-center text-bf-muted hover:text-bf-text"
              aria-label="Expand panel"
              onClick={(e) => {
                e.stopPropagation();
                expandSnap();
              }}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {/* Content */}
      <div className={isMobile ? 'px-4 pb-safe-4' : 'p-4'}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display text-lg text-bf-gold">{mapTerritory.name}</h3>
          <p className="text-xs text-bf-muted mt-0.5">
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
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-bf-text transition-colors -mr-2 -mt-1 shrink-0"
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
          <div className="flex items-center gap-2 p-3 bg-bf-dark rounded-lg">
            <Shield className="w-5 h-5 text-bf-muted shrink-0" />
            <span className="text-2xl font-bold text-bf-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
            <span className="text-bf-muted text-sm">units on this territory</span>
          </div>
          <div>
            <label className="label text-xs">Place reinforcements ({draftPool} remaining)</label>
            <QuickPlace
              pool={draftPool}
              size="lg"
              onPlace={(n) => onDraft(selectedTerritory, n)}
              onUndo={canDraftUndo ? onDraftUndo : undefined}
              canUndo={canDraftUndo}
            />
          </div>
        </div>
      )}

      {/* Galaxy world card — shown above the region badge for galaxy_age maps: the
          world's lore, what holding it pays (its modifiers, in words), and — on a
          gateway system — every lane leaving it with its state for the viewer.
          Mirrors `constants/galaxyLore.ts`; non-galaxy maps render nothing here. */}
      {!isMobileCompactInfo && (() => {
        const territoryLore = getGalaxyTerritoryLoreDetail(mapTerritory.territory_id);
        const worldLore = getGalaxyWorldLore(mapTerritory.world_id);
        const worldMods = describeWorldModifiers(
          mapTerritory.world_id ? gameState.settings.world_modifiers?.[mapTerritory.world_id] : undefined,
        );
        const regionName = (rid: string) => mapRegions?.find((r) => r.region_id === rid)?.name ?? rid;
        const worldRules = describeWorldRules(
          mapTerritory.world_id ? gameState.settings.world_rules?.[mapTerritory.world_id] : undefined,
          regionName,
        );
        const vaults = mapTerritory.world_id
          ? vaultViews(gameState, mapTerritories, myPlayerId).filter((v) => v.world_id === mapTerritory.world_id)
          : [];
        const playerName = (pid: string) => gameState.players.find((p) => p.player_id === pid)?.username ?? 'a rival';
        if (!territoryLore && !worldLore && worldMods.length === 0 && worldRules.length === 0) return null;
        return (
          <div className="mb-3 px-3 py-2 rounded-lg border border-bf-border bg-[rgba(20,16,40,0.55)] text-xs leading-relaxed">
            {worldLore && (
              <>
                <div className="text-[10px] uppercase tracking-wider font-display text-bf-muted/80">
                  <span className="text-bf-gold">{worldLore.display_name}</span>
                  <span className="text-bf-muted"> · {worldLore.tagline}</span>
                </div>
                {worldLore.stakes && (
                  <p className="mt-1 text-[11px] text-bf-muted/90 leading-snug">{worldLore.stakes}</p>
                )}
              </>
            )}
            {worldRules.length > 0 && (
              <ul className="mt-1.5 space-y-0.5" data-testid="world-rules">
                {worldRules.map((line) => (
                  <li key={line} className="text-[11px] text-amber-200/90 leading-snug">★ {line}</li>
                ))}
                {vaults.map((v) => (
                  <li key={v.region_id} className="text-[11px] text-amber-100 leading-snug" data-testid="vault-status">
                    ◈ Vault: {v.holder_id
                      ? (v.holder_id === myPlayerId ? 'held by you' : `held by ${playerName(v.holder_id)}`)
                      : `unheld · you hold ${v.viewer_held} of ${v.tiles}`}
                  </li>
                ))}
              </ul>
            )}
            {worldMods.length > 0 && (
              <ul className="mt-1.5 space-y-0.5" data-testid="world-modifiers">
                {worldMods.map((line) => (
                  <li key={line} className="text-[11px] text-emerald-200/90 leading-snug">◆ {line}</li>
                ))}
              </ul>
            )}
            {territoryLore && (
              <div className="mt-2 space-y-1.5 border-t border-bf-border/40 pt-2">
                <p className="text-[11px] text-bf-text/88 leading-snug">
                  <span className="font-display text-bf-gold/90 not-italic mr-1">Frontier</span>
                  {territoryLore.frontier}
                </p>
                <p className="text-[11px] text-bf-text/85 leading-snug italic">
                  <span className="font-display text-bf-muted not-italic mr-1">Hold</span>
                  {territoryLore.hold}
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Orbit gateway badge — an Earth-side tile that anchors an orbit lane (Space
          Age launch sites: na_launch_base / euro_spaceport / asia_cosmodrome). Data-
          driven and self-scoping: galaxy world tiles aren't 'earth' and Moon tiles
          aren't Earth-side, so this only lights up for the Space Age launch anchors. */}
      {!isMobileCompactInfo
        && inferWorldId(mapTerritory) === 'earth'
        && mapConnections.some(
          (c) => c.type === 'orbit'
            && (c.from === mapTerritory.territory_id || c.to === mapTerritory.territory_id),
        ) && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-bf-dark border border-bf-border text-xs flex items-center gap-1.5">
          <span aria-hidden>🛰</span>
          <span className="font-semibold text-bf-text">Orbit Gateway</span>
          <span className="text-bf-muted">— launch to the Moon from here</span>
        </div>
      )}

      {/* Galaxy transit — convoys this system has sent or is waiting on. The
          units are already gone from wherever they left, so a garrison that
          looks thin may simply be in the void. */}
      {!isMobileCompactInfo && (() => {
        const convoys = convoysFor(gameState, { touching: mapTerritory.territory_id });
        if (convoys.length === 0) return null;
        const nameOf = (id: string) => territoryNameById.get(id) ?? id;
        const ownerName = (pid: string) => gameState.players.find((p) => p.player_id === pid)?.username ?? 'a rival';
        return (
          <div className="mb-3 px-3 py-2 rounded-lg bg-bf-dark border border-sky-800/50 text-xs" data-testid="transit-card">
            <div className="flex items-center gap-1.5">
              <span aria-hidden>🚚</span>
              <span className="font-semibold text-bf-text">In transit</span>
            </div>
            <ul className="mt-1 space-y-0.5">
              {convoys.map((c) => (
                <li key={c.id} className="text-[11px] leading-snug">
                  <span className={c.to === mapTerritory.territory_id ? 'text-sky-200' : 'text-bf-muted'}>
                    {c.to === mapTerritory.territory_id
                      ? describeConvoy(c, nameOf)
                      : `${c.units} unit${c.units === 1 ? '' : 's'} left here for ${nameOf(c.to)}`}
                  </span>
                  {c.owner_id !== myPlayerId && (
                    <span className="text-bf-muted"> · {ownerName(c.owner_id)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Galaxy gateway card — a system that anchors a hyperspace lane. One row per
          lane: the far world, the lane's state for the viewer (corridor / open /
          closed), any Emergency Seal on it, and the dice a crossing rolls. A Void
          Custodian gets the seal button here as well as on the chart. */}
      {!isMobileCompactInfo && (() => {
        const galaxyMap = { territories: mapTerritories, connections: mapConnections, worlds: mapWorlds };
        const lanes = gatewayLanesFor(galaxyMap, mapTerritory.territory_id);
        if (lanes.length === 0 || inferWorldId(mapTerritory) === 'earth' || inferWorldId(mapTerritory) === 'moon') return null;
        const playerName = (pid: string) => gameState.players.find((p) => p.player_id === pid)?.username ?? 'a rival';
        const dice = describeLaneDice(laneAttackDiceCap(gameState, myPlayerId));
        const sealUsed = (myPlayer?.ability_uses?.[EMERGENCY_SEAL_ABILITY_ID] ?? 0) >= 1;
        const worldName = worldDisplayName(galaxyMap, inferWorldId(mapTerritory));
        return (
          <div className="mb-3 px-3 py-2 rounded-lg bg-bf-dark border border-violet-700/50 text-xs" data-testid="gateway-card">
            <div className="flex items-center gap-1.5">
              <span aria-hidden>🛰</span>
              <span className="font-semibold text-bf-text">Gateway</span>
              <span className="text-bf-muted">— {worldName}'s door onto the lanes</span>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {lanes.map((lane) => {
                const state = laneStateFor(gameState, lane.nearId, lane.farId, myPlayerId);
                const seal = laneSealFor(gameState, lane.nearId, lane.farId);
                const sealLine = describeLaneSeal(seal, playerName, myPlayerId);
                const farOwnerId = gameState.territories[lane.farId]?.owner_id;
                const farOwner = farOwnerId
                  ? farOwnerId === myPlayerId ? 'you' : playerName(farOwnerId)
                  : 'neutral';
                const canSeal = !!onSealLane && isMyTurn && !seal
                  && (sealAnyLane || laneTouchesSealWorld(galaxyMap, lane.nearId, lane.farId));
                const stateColor = seal
                  ? 'text-orange-300'
                  : state === 'corridor' ? 'text-bf-gold' : state === 'open' ? 'text-sky-300' : 'text-bf-muted';
                return (
                  <li key={lane.farId} className="leading-snug" data-lane-state={state} data-lane-sealed={seal ? 'true' : 'false'}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-bf-text">
                        → <span className="font-medium">{lane.farWorldName}</span>
                        <span className="text-bf-muted"> · {lane.farName} ({farOwner})</span>
                      </span>
                      <span className={clsx('shrink-0 font-medium', stateColor)}>
                        {seal ? 'Sealed' : state === 'corridor' ? 'Corridor' : state === 'open' ? 'Open' : 'Closed'}
                      </span>
                    </div>
                    <div className="text-[10px] text-bf-muted">
                      {sealLine ?? describeLaneState(state)}
                      {dice && state !== 'closed' && !seal && lane.kind === 'authored' ? ` · ${dice}` : ''}
                    </div>
                    {describeLaneKind(lane.kind) && (
                      <div className="text-[10px] text-sky-300/80">{describeLaneKind(lane.kind)}</div>
                    )}
                    {canSeal && (
                      <button
                        type="button"
                        disabled={sealUsed}
                        onClick={() => onSealLane!(lane.nearId, lane.farId)}
                        className="mt-1 min-h-[32px] px-2.5 rounded border border-orange-500/60 text-orange-200 text-[11px] hover:bg-orange-900/30 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                        title={sealUsed ? 'Emergency Seal already used this turn' : 'Close this lane to everyone else for one round'}
                      >
                        🔒 {sealUsed ? 'Emergency Seal used this turn' : `Emergency Seal · lane to ${lane.farWorldName}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {/* Region Badge — hidden in attack-confirm mode to keep the panel compact */}
      {!isMobileCompactInfo && (() => {
        if (!mapRegions || !mapTerritory.region_id || mapTerritory.region_id === 'sea_routes') return null;
        const regionDef = mapRegions.find((r) => r.region_id === mapTerritory.region_id);
        if (!regionDef) return null;
        const regionIdx = mapRegions.indexOf(regionDef);
        const regionColors = getRegionCssColors();
        const regionColor = regionColors[regionIdx % regionColors.length];
        const regionTerritories = mapTerritories.filter((t) => t.region_id === mapTerritory.region_id);
        const totalInRegion = regionTerritories.length;
        const ownedInRegion = myPlayerId
          ? regionTerritories.filter((t) => gameState.territories[t.territory_id]?.owner_id === myPlayerId).length
          : 0;
        const controlsRegion = !!myPlayerId && totalInRegion > 0 && ownedInRegion === totalInRegion;
        const playerCount = gameState.players.length;
        const effBonus = effectiveContinentBonus(regionDef.bonus, playerCount);
        const bonusScaled = effBonus !== regionDef.bonus;
        return (
          <div className="mb-3 px-3 py-2 rounded-lg bg-bf-dark border border-bf-border text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: regionColor }} />
                <span className="font-semibold text-bf-text truncate">{regionDef.name}</span>
              </div>
              <span
                className="font-mono text-bf-gold font-semibold shrink-0 ml-2"
                title={bonusScaled ? `Continent bonuses scale with player count: +${effBonus} at ${playerCount} players (+${regionDef.bonus} at 6).` : undefined}
              >
                +{effBonus}
              </span>
            </div>
            {bonusScaled && (
              <p className="text-[10px] text-bf-muted/80 mt-1">
                Scales with players: +{effBonus} at {playerCount} (+{regionDef.bonus} at 6)
              </p>
            )}
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
                <span className={clsx('font-mono tabular-nums shrink-0', controlsRegion ? 'text-bf-gold' : 'text-bf-muted')}>
                  {ownedInRegion}/{totalInRegion}{controlsRegion && ' ✓'}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Unit Count — full detail; skipped in mobile draft placement (shown above). */}
      {!isMobileDraftPlacementMode && (
        useCompactUnitRow ? (
        /* Compact inline unit display for mobile action / attack-confirm */
        <div className="flex items-center gap-2 mb-3 px-1">
          <Shield className={clsx('w-4 h-4 shrink-0', isViewingOwnAttacker ? 'text-bf-gold' : 'text-bf-muted')} />
          <span className="text-xl font-bold text-bf-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
          <span className="text-bf-muted text-sm">
            {isMine && gameState.phase === 'attack'
              ? 'units ready to attack'
              : isMine
                ? 'units'
                : 'defending units'}
          </span>
          {!fogHidden && tState.naval_units != null && tState.naval_units > 0 && (
            <span className="ml-2 text-xs text-blue-300">· {tState.naval_units} fleet{tState.naval_units !== 1 ? 's' : ''}</span>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4 p-3 bg-bf-dark rounded-lg">
            <Shield className="w-5 h-5 text-bf-muted" />
            <span className="text-2xl font-bold text-bf-text">{tState.unit_count === -1 ? '?' : tState.unit_count}</span>
            {/* "1 units" under fog-free view read as a bug. `?` keeps the plural. */}
            <span className="text-bf-muted text-sm">{tState.unit_count === 1 ? 'unit' : 'units'}</span>
          </div>

          {/* Fleet Count (naval warfare) — hidden under fog of war */}
          {!fogHidden && tState.naval_units != null && (
            <div className="flex items-center gap-2 mb-4 p-3 bg-bf-dark rounded-lg">
              <Anchor className="w-5 h-5 text-blue-400" />
              <span className="text-2xl font-bold text-bf-text">{tState.naval_units}</span>
              <span className="text-bf-muted text-sm">{tState.naval_units === 1 ? 'fleet' : 'fleets'}</span>
            </div>
          )}

          {/* Stability Bar — hidden under fog of war */}
          {!fogHidden && gameState.settings.stability_enabled && tState.stability != null && (
            <div className="mb-4 p-3 bg-bf-dark rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-bf-muted">Stability</span>
                <span className="text-xs font-mono text-bf-text">{tState.stability}%</span>
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
                  <span className="text-xs text-bf-muted">Population</span>
                  <span className="text-xs font-mono text-bf-text">{tState.population} / 10</span>
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

      {/* Orbital Blockade: seal an authored orbit lane from an end you hold.
          Launch Pad lanes are deliberately absent — the server refuses them, and
          offering a button that always fails would teach the wrong rule. */}
      {onSealLane && isMine && gameState.settings.space_age_moon_blockade_enabled
        && (gameState.phase === 'attack' || gameState.phase === 'fortify')
        && (() => {
          const lane = mapConnections.find(
            (c) => c.type === 'orbit' && c.source !== 'launch_pad'
              && (c.from === selectedTerritory || c.to === selectedTerritory),
          );
          if (!lane) return null;
          const otherEnd = lane.from === selectedTerritory ? lane.to : lane.from;
          return (
            <button
              data-testid="seal-lane-btn"
              onClick={() => onSealLane(lane.from, lane.to)}
              className="mx-3 mb-2 w-[calc(100%-1.5rem)] py-2 px-3 rounded-lg text-sm transition-colors
                         border border-cyan-600/70 bg-cyan-950/50 text-cyan-200 hover:bg-cyan-900/50
                         flex flex-col items-center gap-0.5"
            >
              <span>🚧 Blockade the lane to {territoryNameById.get(otherEnd) ?? otherEnd}</span>
              <span className="text-[10px] opacity-60">Shuts it to everyone else for 2 turns — 3 He-3</span>
            </button>
          );
        })()}

      {/* Drop Assault marker. Shown to EVERY player, not just the defender: the
          telegraph is the counterplay, and a marker only the attacker can see
          would be no telegraph at all. */}
      {dropAssaultsTargeting(gameState, selectedTerritory).map((assault) => {
        const declarer = gameState.players.find((p) => p.player_id === assault.owner_id);
        const mine = assault.owner_id === myPlayerId;
        return (
          <div
            key={`${assault.owner_id}-${assault.target_id}`}
            role="status"
            data-testid="drop-assault-marker"
            className="mx-3 mb-2 px-3 py-2 rounded-lg border border-red-700/50 bg-red-950/40 text-red-200 text-xs leading-snug"
          >
            💥 {mine
              ? 'Your Drop Assault lands here at the start of your next turn.'
              : `${declarer?.username ?? 'Someone'} has marked this tile — 3 units land here at the start of their next turn.`}
            {!mine && <span className="block opacity-70 mt-0.5">Reinforce it before then.</span>}
          </div>
        );
      })}

      {/* Actions */}
      {/* Territory Selection Claim */}
      {gameState.phase === 'territory_select' && isUnowned && onClaimTerritory && (
        <div className="p-3 border-t border-bf-border">
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
              <QuickPlace
                pool={draftPool}
                onPlace={(n) => onDraft(selectedTerritory, n)}
                onUndo={canDraftUndo ? onDraftUndo : undefined}
                canUndo={canDraftUndo}
              />
            </div>
          )}

          {/* Combat Section */}
          {gameState.phase === 'attack' && attackNeighbors.length > 0 && attackNeighborSourceId && (
            <NeighborTerritoryPicker
              phase="attack"
              sourceName={territoryNameById.get(attackNeighborSourceId) ?? attackNeighborSourceId}
              neighbors={attackNeighborsWithLaneDice}
                denseMap={denseMap}
                compact={isMobileActionMode}
                orbitLocked={!orbitAccessAllowed}
                orbitLockReason={orbitAccessReason ?? undefined}
              onSelect={(territoryId) => setSelectedTerritory(territoryId)}
              onAttack={(toTerritoryId) => onAttack(attackNeighborSourceId, toTerritoryId)}
            />
          )}

          {gameState.phase === 'attack' && (
            <div>
              <div className="text-xs font-bold text-bf-muted uppercase mb-2 tracking-wide">⚔ Combat</div>
              {/*
                Arming a stack is now an alternative route, not the way in. The
                picker above already offers every legal strike from this
                territory in one click, so a full-width `btn-primary` here read
                as the thing to press and sent players down the long path. It
                stays for people who'd rather find the target on the map — and
                only when this stack has somewhere to strike, since arming a
                cornered one leads nowhere.
              */}
              {isMine && tState.unit_count >= 2 && !attackSource && attackNeighbors.length > 0 && (
                <button
                  className="btn-secondary w-full text-xs flex items-center justify-center gap-2"
                  onClick={() => setAttackSource(selectedTerritory)}
                  title="Arm this stack, then click a bordering enemy on the map"
                >
                  <Sword className="w-3.5 h-3.5" /> Or pick the target on the map
                </button>
              )}
              {/* Nothing to offer: say why instead of leaving the section
                  blank, which reads as the UI having failed. */}
              {!attackSource && (isMine || isEnemy) &&
               (isMine ? attackNeighbors.length === 0 : directAttackSources.length === 0) && (
                <p className="text-xs text-bf-muted/80">
                  {isMine
                    ? tState.unit_count >= MIN_ATTACK_UNITS
                      ? 'No enemy borders this territory. Attack from one that does.'
                      : `Needs at least ${MIN_ATTACK_UNITS} units to attack — one has to hold the territory.`
                    : /* Enemy ground: if anything of mine bordered it with enough
                         units, it would be listed above — so these two are the
                         only reasons left. */
                      borderingOwned.length > 0
                        ? `Your territories next to this one are too thin — an attack needs ${MIN_ATTACK_UNITS} units.`
                        : 'None of your territories border this one.'}
                </p>
              )}
              {/*
                Viewing an enemy with nothing armed: offer the strike from here.
                One row per eligible neighbour of mine, strongest first — so the
                common case (a single bordering stack) is a single click, and the
                multi-source case is still one click once you've picked which
                stack to spend. `Select as Attacker` stays available on my own
                territories for repeat attacks; it is no longer the toll for a
                first one.
              */}
              {directAttackSources.length > 0 && (
                <div className="space-y-1.5">
                  {directAttackSources.length > 1 && (
                    <p className="text-[11px] text-bf-muted/90 leading-snug">
                      {directAttackSources.length} of your territories border this one.
                    </p>
                  )}
                  {directAttackSources.map((src, _i, rows) => {
                    const canBlitz =
                      !!onBlitzAttack &&
                      canOfferBlitz({
                        flagEnabled: attackBlitzFlag,
                        hasActiveTruce,
                        connectionType: src.connectionType,
                        isDailyChallenge:
                          typeof gameState.settings?.daily_challenge_date === 'string' &&
                          gameState.settings.daily_challenge_date.length > 0,
                      });
                    return (
                      <div key={src.territoryId} className="flex items-stretch gap-1.5">
                        <button
                          className={clsx(
                            // min-w-0 matters here: a flex ITEM defaults to
                            // min-width:auto, which floors at its content width,
                            // so `truncate` inside could never take effect and a
                            // long label ("Break truce — attack from Sarmatia")
                            // pushed the button out past the panel's edge.
                            'flex-1 min-w-0 text-sm text-left flex items-center gap-2',
                            hasActiveTruce ? 'btn-warning' : 'btn-danger',
                          )}
                          onClick={() => onAttack(src.territoryId, selectedTerritory)}
                        >
                          {hasActiveTruce ? <span aria-hidden>⚠</span> : <Sword className="w-4 h-4 shrink-0" />}
                          {/* Name and strength on separate lines: centred with a
                              "· N" suffix, a long territory name wrapped and left
                              the count orphaned on its own line. */}
                          <span className="min-w-0">
                            <span className="block truncate">
                              {hasActiveTruce ? 'Break truce — attack' : 'Attack'} from {src.name}
                            </span>
                            <span className="block text-[11px] opacity-75">
                              {plural(src.unitCount, 'unit')}
                            </span>
                          </span>
                        </button>
                        {canBlitz ? (
                          <button
                            className="min-w-[44px] rounded-lg bg-bf-gold/15 hover:bg-bf-gold/25
                                       border border-bf-gold/40 text-bf-gold font-medium transition-all"
                            onClick={() => onBlitzAttack!(src.territoryId, selectedTerritory)}
                            aria-label={`Blitz ${selectedTerritory} from ${src.name} until captured`}
                            title="Attack repeatedly until the territory falls or you can no longer attack"
                          >
                            ⚡
                          </button>
                        ) : rows.length > 1 && blitzOfferedForAnySource ? (
                          // Hold the column so a source that can't blitz (a sea
                          // crossing, say) doesn't leave the list looking ragged.
                          <span className="min-w-[44px]" aria-hidden />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Re-pick the attacker without cancelling first: viewing a
                  different own territory while an attacker is already locked. */}
              {isMine && tState.unit_count >= 2 && attackSource && attackSource !== selectedTerritory && (
                <button
                  className="btn-primary w-full text-sm flex items-center justify-center gap-2"
                  onClick={() => setAttackSource(selectedTerritory)}
                >
                  <Sword className="w-4 h-4" /> Attack from here instead
                </button>
              )}
              {attackSource && isEnemy && attackSource !== selectedTerritory && (
                !canAttackSelectedFromSource ? (
                  // The server would reject this with NOT_ADJACENT. Show why rather
                  // than offering a button whose only outcome is an error toast.
                  <div>
                    <button
                      className="btn-danger w-full text-sm flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
                      disabled
                      title={`${territoryNameById.get(attackSource) ?? attackSource} does not border this territory`}
                    >
                      <Sword className="w-4 h-4" /> Attack from {territoryNameById.get(attackSource) ?? attackSource}
                    </button>
                    <p className="text-bf-muted text-xs mt-2">
                      No border from {territoryNameById.get(attackSource) ?? attackSource}. Pick a territory next to it,
                      or attack from here instead.
                    </p>
                  </div>
                ) : hasActiveTruce ? (
                  <button
                    className="btn-warning w-full text-sm flex items-center justify-center gap-2"
                    onClick={() => onAttack(attackSource, selectedTerritory)}
                  >
                    ⚠ Break Truce &amp; Attack
                  </button>
                ) : (
                  // Two ways to fight: one exchange, or press until decided.
                  // The fast-combat preference decides which leads.
                  <div className={clsx('flex gap-2', blitzIsPrimary ? 'flex-col-reverse' : 'flex-col')}>
                    <button
                      className="btn-danger w-full text-sm flex items-center justify-center gap-2"
                      onClick={() => onAttack(attackSource, selectedTerritory)}
                    >
                      <Sword className="w-4 h-4" /> Attack from {territoryNameById.get(attackSource) ?? attackSource}
                    </button>
                    {blitzOffered && (
                      <button
                        className="w-full text-sm flex items-center justify-center gap-2 py-2 rounded-lg
                                   bg-bf-gold/15 hover:bg-bf-gold/25 border border-bf-gold/40 text-bf-gold
                                   font-medium transition-all"
                        onClick={() => onBlitzAttack!(attackSource, selectedTerritory)}
                        title="Attack repeatedly until the territory falls or you can no longer attack"
                      >
                        ⚡ Blitz until captured
                      </button>
                    )}
                  </div>
                )
              )}
              {/* Always offer a clear way out while an attacker is locked in. */}
              {attackSource && (
                attackSource === selectedTerritory ? (
                  <div>
                    <p className="text-bf-gold text-xs mb-2">Attacking from this territory. Select an enemy territory to attack.</p>
                    <button
                      className="btn-secondary w-full text-sm"
                      onClick={() => setAttackSource(null)}
                    >
                      Cancel attack
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-secondary w-full text-sm mt-2"
                    onClick={() => setAttackSource(null)}
                  >
                    Cancel attack (from {territoryNameById.get(attackSource) ?? attackSource})
                  </button>
                )
              )}
            </div>
          )}

          {/* Tech / faction ability buttons — phase-gated per each ability's own def.phase */}
          {onUseAbility && (!attackSource || attackSource === selectedTerritory) && myPlayer && (() => {
            const allAbilities = getPlayerTerritoryAbilities(gameState, myPlayer, techTree, {
              isEnemy,
              isMine,
              isUnowned,
            }, countOwnedLunarTerritories(mapTerritories, gameState, myPlayer.player_id));
            if (allAbilities.length === 0) return null;
            return allAbilities.map((abilityId) => {
              const def = getAbilityUiDef(abilityId);
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
                    if (
                      gameState.phase === 'attack'
                      && isMine
                      && tState.unit_count >= 2
                      && isAttackSelfBuffAbility(abilityId, def)
                    ) {
                      setAttackSource(selectedTerritory);
                    }
                    onUseAbility(abilityId, targetId);
                    setSelectedTerritory(null);
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
          {!isMobileActionMode && (isEnemy || isUnowned) &&
           (gameState.era_modifiers?.influence_spread || gameState.era_modifiers?.carbonari_network || gameState.settings.diplomacy_enabled) && (
            <div className="mt-2 bg-bf-dark/30 border border-bf-border/50 rounded-lg p-2.5">
              <div className="text-xs font-bold text-purple-300 uppercase mb-2 tracking-wide">🤝 Diplomacy</div>

              {/* Outside attack phase: show a contextual hint so the section is never an empty puzzle */}
              {gameState.phase !== 'attack' ? (
                <p className="text-xs text-bf-muted/60 text-center py-1">
                  Available during your attack phase
                </p>
              ) : attackSource ? (
                /* Attack source is already locked in — diplomacy actions require a clean selection */
                <p className="text-xs text-bf-muted/60 text-center py-1">
                  Deselect your attacker to use diplomacy
                </p>
              ) : (
                <>
                  {/* Influence Spread / Carbonari Network */}
                  {(isEnemy || isUnowned) && onInfluence &&
                   (gameState.era_modifiers?.influence_spread || gameState.era_modifiers?.carbonari_network) && (() => {
                    const cooldown = (gameState as any).influence_cooldown_remaining ?? 0;
                    const myPlayer = gameState.players.find((p) => p.player_id === myPlayerId);
                    // Mirror backend getInfluenceUnitCost: proxy_funding tech drops the cost to 2.
                    const influenceCost =
                      gameState.settings.tech_trees_enabled && myPlayer?.unlocked_techs?.includes('proxy_funding')
                        ? 2
                        : 3;
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
                    if (!isGaribaldiTarget && fogHidden) {
                      return (
                        <p className="text-xs text-purple-400/50 text-center py-1">
                          📡 Strength unknown — scout this territory first
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
                      <div className="space-y-1">
                        <button
                          className="w-full text-sm flex items-center justify-center gap-2 py-2 rounded-lg
                                     border border-purple-600/50 bg-purple-900/30 text-purple-200
                                     hover:bg-purple-800/40 hover:border-purple-500 transition-colors"
                          onClick={() => { onInfluence(selectedTerritory); onClose(); }}
                          title={`Capture this territory without rolling for combat. Spends ${influenceCost} units from your bordering territories (target must hold 3 units or fewer). One use, then a 3-turn cooldown.`}
                        >
                          📡 Seize via Influence{' '}
                          <span className="text-purple-400 text-xs">
                            {isGaribaldiTarget ? '(free — Garibaldi)' : `(costs ${influenceCost} units)`}
                          </span>
                        </button>
                        <p className="text-[11px] leading-snug text-purple-300/70 text-center px-1">
                          {isGaribaldiTarget
                            ? 'Take this territory without a fight — free, one-time (Garibaldi).'
                            : `Take this territory without a fight — spends ${influenceCost} units from your bordering territories · 3-turn cooldown.`}
                        </p>
                      </div>
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
                        <p className="text-xs text-bf-muted/50 text-center py-1">
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
          {gameState.phase === 'fortify' && fortifyNeighbors.length > 0 && fortifyNeighborSourceId && (
            <div className="space-y-2">
              {/* How many, before where. The picker commits the move the instant
                  a destination is tapped, so without a dial here every fortify
                  sent exactly one unit: the amount stepper below is hidden in
                  mobile action mode, leaving `fortifyAmount` on its initial 1
                  with nothing able to change it. Sized to the PICKER's source,
                  which is not always the selected territory. */}
              {isMobileActionMode && (
                <AmountDial
                  max={fortifyMax}
                  value={fortifyAmount}
                  onChange={setFortifyAmount}
                  testIdPrefix="fortify"
                  allLabel={`All ${fortifyMax}`}
                />
              )}
              <NeighborTerritoryPicker
                phase="fortify"
                sourceName={territoryNameById.get(fortifyNeighborSourceId) ?? fortifyNeighborSourceId}
                neighbors={fortifyNeighbors}
              denseMap={denseMap}
              compact={isMobileActionMode}
              orbitLocked={!orbitAccessAllowed}
              orbitLockReason={orbitAccessReason ?? undefined}
                onSelect={(territoryId) => {
                  if (onFortifyTo) {
                    setFortifyUnits(Math.min(fortifyAmount, fortifyMax));
                    setAttackSource(fortifyNeighborSourceId);
                    onFortifyTo(fortifyNeighborSourceId, territoryId);
                  } else {
                    setSelectedTerritory(territoryId);
                  }
                }}
              />
              {/* The picker lists neighbours only, on purpose: the server will
                  move troops along any chain of your own ground, and that set is
                  the size of your empire — 25-37 rows on a mid-size board at 60%
                  control. So the far half of the rule goes to the map, which can
                  show it at no cost, instead of to a list that cannot. */}
              {isMobileActionMode && attackSource !== fortifyNeighborSourceId && (
                <button
                  type="button"
                  className="btn-secondary w-full text-sm py-2"
                  data-testid="fortify-send-further"
                  onClick={() => {
                    setFortifyUnits(Math.min(fortifyAmount, fortifyMax));
                    setAttackSource(fortifyNeighborSourceId);
                    // Drop the sheet before the map is needed. The first tap on
                    // the map is otherwise swallowed to collapse this sheet, so
                    // without it choosing a destination would cost two taps and
                    // the first would look like it did nothing.
                    handleSnapChange('peek');
                  }}
                >
                  Send further — pick on the map
                </button>
              )}
            </div>
          )}

          {/* An armed fortify source had no indicator and no way out: the only
              "Cancel" in this panel lives in the attack block and says "attack".
              That was survivable while arming was a desktop-only detour; it is
              not, now that it is how a phone reaches a distant territory. */}
          {gameState.phase === 'fortify' && attackSource && (
            <div className="rounded-lg border border-bf-gold/40 bg-bf-gold/10 px-2.5 py-2">
              <p className="text-bf-gold text-xs mb-2" data-testid="fortify-pick-banner">
                Moving {Math.min(fortifyAmount, fortifyMax)} from{' '}
                {territoryNameById.get(attackSource) ?? attackSource}. Tap any highlighted
                territory to send them there.
              </p>
              <button
                type="button"
                className="btn-secondary w-full text-sm"
                data-testid="fortify-cancel"
                onClick={() => setAttackSource(null)}
              >
                Cancel move
              </button>
            </div>
          )}

          {isMine && gameState.phase === 'fortify' && tState.unit_count > 1
            && !(isMobileActionMode && fortifyNeighbors.length > 0) && (
            <div>
              <div className="text-xs font-bold text-bf-muted uppercase mb-2 tracking-wide">→ Fortify</div>
              {/* Not "adjacent": the server walks any chain of territories you
                  own, so the destination only has to be connected to this one
                  through your own ground. */}
              <label className="label text-xs">Move units to a connected territory</label>
              <div className="flex flex-wrap items-center gap-2">
                <AmountDial
                  max={fortifyMax}
                  value={fortifyAmount}
                  onChange={setFortifyAmount}
                  testIdPrefix="fortify"
                  allLabel={`All ${fortifyMax}`}
                />
                <button
                  className="btn-secondary text-sm py-1.5 px-3 flex-1"
                  onClick={() => {
                    setFortifyUnits(Math.min(fortifyAmount, fortifyMax));
                    setAttackSource(selectedTerritory);
                  }}
                >
                  Move
                </button>
              </div>
              <p className="text-xs text-bf-muted mt-1">Then click the destination territory.</p>
            </div>
          )}

          {/* Naval Section (collapsible) */}
          {!isMobileActionMode && gameState.settings.naval_enabled && tState.naval_units != null && (
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
                        className="w-11 h-11 rounded-lg bg-bf-dark border border-bf-border text-bf-text font-bold hover:bg-bf-border transition-colors shrink-0"
                        onClick={() => setNavalMoveCount((a) => Math.max(1, a - 1))}
                      >−</button>
                      <span className="w-8 text-center font-mono text-bf-text">{navalMoveCount}</span>
                      <button
                        type="button"
                        className="w-11 h-11 rounded-lg bg-bf-dark border border-bf-border text-bf-text font-bold hover:bg-bf-border transition-colors shrink-0"
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
      {isMobileActionMode && (
        <details className="mt-3 rounded-lg border border-bf-border/60 bg-bf-dark/40">
          <summary className="px-3 py-2 text-xs font-semibold text-bf-muted cursor-pointer select-none">
            Territory details
          </summary>
          <div className="px-3 pb-3 space-y-3 border-t border-bf-border/40 pt-2">
            {(() => {
              const territoryLore = getGalaxyTerritoryLoreDetail(mapTerritory.territory_id);
              const worldLore = getGalaxyWorldLore(mapTerritory.world_id);
              if (!territoryLore && !worldLore) return null;
              return (
                <div className="px-2 py-2 rounded-lg border border-bf-border bg-[rgba(20,16,40,0.55)] text-xs leading-relaxed">
                  {worldLore && (
                    <div className="text-[10px] uppercase tracking-wider text-bf-muted/80">
                      <span className="text-bf-gold">{worldLore.display_name}</span>
                      <span className="text-bf-muted"> · {worldLore.tagline}</span>
                    </div>
                  )}
                  {territoryLore && (
                    <p className="mt-1 text-[11px] text-bf-text/88">{territoryLore.hold}</p>
                  )}
                </div>
              );
            })()}
            {mapRegions && mapTerritory.region_id && mapTerritory.region_id !== 'sea_routes' && (() => {
              const regionDef = mapRegions.find((r) => r.region_id === mapTerritory.region_id);
              if (!regionDef) return null;
              const regionIdx = mapRegions.indexOf(regionDef);
              const regionColors = getRegionCssColors();
              const regionColor = regionColors[regionIdx % regionColors.length];
              const regionTerritories = mapTerritories.filter((t) => t.region_id === mapTerritory.region_id);
              const ownedInRegion = myPlayerId
                ? regionTerritories.filter((t) => gameState.territories[t.territory_id]?.owner_id === myPlayerId).length
                : 0;
              const playerCount = gameState.players.length;
              const effBonus = effectiveContinentBonus(regionDef.bonus, playerCount);
              const bonusScaled = effBonus !== regionDef.bonus;
              return (
                <div className="px-2 py-2 rounded-lg bg-bf-dark border border-bf-border text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: regionColor }} />
                      {regionDef.name}
                    </span>
                    <span
                      className="font-mono text-bf-gold"
                      title={bonusScaled ? `Continent bonuses scale with player count: +${effBonus} at ${playerCount} players (+${regionDef.bonus} at 6).` : undefined}
                    >
                      +{effBonus}
                    </span>
                  </div>
                  {myPlayerId && (
                    <p className="text-bf-muted mt-1 tabular-nums">
                      {ownedInRegion}/{regionTerritories.length} owned
                      {bonusScaled && <span className="text-bf-muted/70"> · +{effBonus} at {playerCount} players</span>}
                    </p>
                  )}
                </div>
              );
            })()}
            {!fogHidden && gameState.settings.stability_enabled && tState.stability != null && (
              <p className="text-xs text-bf-muted">Stability: {tState.stability}%</p>
            )}
            {!fogHidden && tState.naval_units != null && tState.naval_units > 0 && (
              <p className="text-xs text-blue-300">{tState.naval_units} fleet{tState.naval_units !== 1 ? 's' : ''}</p>
            )}
          </div>
        </details>
      )}

      {!isMobileCompactInfo && gameState.settings.economy_enabled && onBuild && (() => {
        // Use the VIEWER's current era (not the game's base era) so an advanced
        // player sees their own era's wonder + buildings (era-advancement aware).
        const viewerEra = resolvePlayerTechEraId(gameState, myPlayer);
        const wonderMeta = ERA_WONDERS[viewerEra];
        // Era-special buildings the viewer has unlocked via their current-era
        // tech (e.g. Space Age launch_pad) — standard buildings + wonders are
        // handled separately, so exclude them here.
        const STANDARD = new Set([
          'production_1', 'production_2', 'production_3', 'production_4',
          'defense_1', 'defense_2', 'defense_3',
          'tech_gen_1', 'tech_gen_2',
          'port', 'naval_base', 'coastal_battery',
        ]);
        const unlockedTechs = new Set(myPlayer?.unlocked_techs ?? []);
        const buildingUnlocks = techTree.filter(
          (n) => n.unlocks_building && !n.unlocks_building.startsWith('wonder_'),
        );
        /**
         * Buildings the server will refuse until their tech is researched, and
         * the tech that opens each. The build panel used to offer these as live
         * buttons and let `game:build` reject them with "You must research the
         * required technology first" — a rejection that named neither the
         * building nor the tech, after the player had already spent the click.
         */
        const techLocks: Record<string, string> = {};
        for (const n of buildingUnlocks) {
          if (unlockedTechs.has(n.tech_id)) continue;
          const building = n.unlocks_building as string;
          // Cheapest wording when two nodes unlock the same building: first wins.
          if (!(building in techLocks)) techLocks[building] = n.name ?? n.tech_id;
        }
        // Era-special buildings (e.g. the Space Age launch_pad). Locked ones are
        // listed too, so the panel shows what this era HAS rather than hiding it
        // until the research happens to land.
        const extraBuildOptions = Array.from(new Set(
          buildingUnlocks
            .filter((n) => !STANDARD.has(n.unlocks_building as string))
            .map((n) => n.unlocks_building as string),
        ));
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
            buildings={fogHidden ? [] : (tState.buildings ?? [])}
            playerResources={gameState.players.find((p) => p.player_id === myPlayerId)?.special_resource ?? 0}
            isMine={isMine}
            isMyTurn={isMyTurn}
            phase={gameState.phase}
            onBuild={onBuild}
            isCoastal={!fogHidden && tState.naval_units != null}
            eraWonder={eraWonderProp}
            extraBuildOptions={extraBuildOptions}
            techLocks={techLocks}
            onOpenTechTree={onOpenTechTree}
          />
        );
      })()}
      </div>
    </div>
  );
}
