import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import GameMap from '../components/game/GameMap';
import { useMapVisualEvents } from '../hooks/useMapVisualEvents';
import { useGameStore, type GameState } from '../store/gameStore';
import AtomBombAnimation, { type StrikeAnimationVariant } from '../components/game/AtomBombAnimation';
import {
  MAP_VISUAL_LAB_FIXTURE,
  MAP_VISUAL_LAB_PLAYERS,
  labPayload,
} from '../fixtures/mapVisualLabFixture';
import type { MapVisualEvent } from '../utils/mapVisualEvents';
import type { MapStrikeFlashProps } from '../utils/mapStrikeEffects';

const GlobeMap = lazy(() => import('../components/game/GlobeMap'));

type LabView = '2d' | 'globe';

const TRIGGER_BUTTONS: Array<{ id: string; label: string }> = [
  { id: 'reinforce', label: 'Reinforce' },
  { id: 'combat', label: 'Combat' },
  { id: 'capture', label: 'Capture' },
  { id: 'fortify', label: 'Fortify' },
  { id: 'naval', label: 'Naval' },
  { id: 'influence', label: 'Influence' },
  { id: 'influence_blocked', label: 'Influence (blocked)' },
  { id: 'strike', label: 'Strike' },
  { id: 'event', label: 'Event' },
];

function buildLabGameState(): GameState {
  return {
    game_id: 'map-visual-lab',
    status: 'in_progress',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 1,
    players: MAP_VISUAL_LAB_PLAYERS.map((p, i) => ({
      player_id: p.player_id,
      user_id: `u${i + 1}`,
      username: i === 0 ? 'Attacker' : 'Defender',
      color_hex: p.color,
      territory_count: 2,
      cards: [],
      capital_territory_id: null,
      secret_mission: null,
      is_ai: false,
      is_eliminated: false,
      available_abilities: [],
      ability_cooldowns: {},
      unlocked_techs: [],
      tech_points: 0,
      faction_id: null,
    })),
    territories: {
      lab_t1: { owner_id: 'lab_p1', unit_count: 4 },
      lab_t2: { owner_id: 'lab_p2', unit_count: 3 },
      lab_t3: { owner_id: 'lab_p2', unit_count: 2 },
    },
    settings: {
      turn_timer_seconds: 300,
      max_players: 2,
      ai_player_count: 0,
      ai_difficulty: 'medium',
      fog_of_war: false,
      game_mode: 'classic',
      map_id: 'map-visual-lab',
      territory_selection: false,
      initial_unit_count: 3,
      economy_enabled: false,
      tech_trees_enabled: false,
      events_enabled: false,
      factions_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
      victory_conditions: ['domination'],
      victory_threshold_pct: 65,
    },
    card_deck: [],
    discard_pile: [],
    pending_event_card: null,
    truce_turns_remaining: 0,
    pending_truces: [],
    diplomacy: [],
    draft_units_remaining: 0,
    winner_id: null,
    winner_ids: [],
    victory_condition: null,
  } as unknown as GameState;
}

export default function MapVisualLabPage() {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<LabView>('2d');
  const [strikeFlash, setStrikeFlash] = useState<MapStrikeFlashProps | null>(null);
  const [strikeAnim, setStrikeAnim] = useState<{
    abilityId: StrikeAnimationVariant;
    targetName: string;
    unitReduction?: number;
    key: number;
  } | null>(null);
  const strikeFlashKeyRef = useRef(0);
  const autoTriggeredRef = useRef(false);

  const {
    mapVisualEvents,
    globeEvents,
    pushMapVisualLocal,
    onMapVisualDone,
  } = useMapVisualEvents();

  const setGameState = useGameStore((s) => s.setGameState);

  useEffect(() => {
    setGameState(buildLabGameState());
  }, [setGameState]);

  const trigger = useCallback((kind: string) => {
    const payload = labPayload(kind) as Omit<MapVisualEvent, 'id'>;
    pushMapVisualLocal(payload);

    if (kind === 'strike') {
      const abilityId = 'air_strike' as MapStrikeFlashProps['abilityId'];
      strikeFlashKeyRef.current += 1;
      setStrikeFlash({
        territoryId: 'lab_t1',
        abilityId,
        key: strikeFlashKeyRef.current,
      });
    }
  }, [pushMapVisualLocal]);

  useEffect(() => {
    if (autoTriggeredRef.current) return;
    const action = searchParams.get('action');
    if (!action) return;
    autoTriggeredRef.current = true;
    trigger(action);
  }, [searchParams, trigger]);

  const mapHeight = useMemo(() => Math.max(360, window.innerHeight - 180), []);

  return (
    <div className="min-h-screen bg-cc-dark text-cc-text flex flex-col">
      <header className="border-b border-cc-border px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3 pt-safe px-safe">
        <Link to="/lobby" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
          ← Lobby
        </Link>
        <h1 className="font-display text-xl text-cc-gold tracking-widest">MAP VISUAL LAB</h1>
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={() => setView('2d')}
            className={view === '2d' ? 'text-cc-gold text-sm' : 'text-cc-muted hover:text-cc-text text-sm'}
          >
            2D
          </button>
          <button
            type="button"
            onClick={() => setView('globe')}
            className={view === 'globe' ? 'text-cc-gold text-sm' : 'text-cc-muted hover:text-cc-text text-sm'}
          >
            Globe
          </button>
        </div>
      </header>

      <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-cc-border">
        {TRIGGER_BUTTONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-testid={`lab-trigger-${id}`}
            onClick={() => trigger(id)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-cc-border hover:border-cc-gold/50 hover:text-cc-gold transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 p-4">
        <div className="h-full max-h-[calc(100vh-180px)] rounded-lg overflow-hidden">
          {view === '2d' ? (
            <GameMap
              mapData={MAP_VISUAL_LAB_FIXTURE}
              onTerritoryClick={() => {}}
              width={900}
              height={mapHeight}
              mapVisualEvents={mapVisualEvents}
              onMapVisualDone={onMapVisualDone}
              strikeFlash={strikeFlash}
            />
          ) : (
            <Suspense fallback={<div className="text-cc-muted animate-pulse p-8">Loading globe…</div>}>
              <GlobeMap
                mapData={MAP_VISUAL_LAB_FIXTURE}
                onTerritoryClick={() => {}}
                width={900}
                height={mapHeight}
                events={globeEvents}
                onEventDone={onMapVisualDone}
                reducedEffects
              />
            </Suspense>
          )}
        </div>
      </div>

      {strikeAnim && (
        <AtomBombAnimation
          key={strikeAnim.key}
          abilityId={strikeAnim.abilityId}
          targetName={strikeAnim.targetName}
          unitReduction={strikeAnim.unitReduction}
          onDone={() => setStrikeAnim(null)}
        />
      )}
    </div>
  );
}
