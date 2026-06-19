import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Modal from '../components/ui/Modal';
import EventCardModal, { type EventCard } from '../components/game/EventCardModal';
import TechTreeModal, { type TechNode } from '../components/game/TechTreeModal';
import ActionModal from '../components/game/ActionModal';
import TutorialOverlay, { type TutorialStep } from '../components/game/TutorialOverlay';
import type { CombatResult } from '../store/gameStore';
import type { GameState } from '../store/gameStore';

type LabModal = 'create' | 'event' | 'tech' | 'combat' | 'combat-tutorial' | null;

// Mirrors the live "Launch an Attack!" coaching beat, used to verify the
// tutorial popup yields to the combat result modal instead of covering it.
const mockTutorialAttackStep: TutorialStep = {
  id: 'attack',
  title: 'Launch an Attack!',
  message: 'Try attacking an adjacent enemy territory now. Attack as many times as you like — or skip straight to fortify.',
  hint: "When you're done attacking, click the gold **Begin Fortify →** button to continue.",
  requireAction: 'end_phase',
};

// Worst-case stacked-bonus battle: many extra dice on both sides, used to
// verify the combat dice row stays inside the modal (wraps + scales down).
const mockCombatResult: CombatResult = {
  attacker_rolls: [6, 5, 4, 3, 6, 2, 5],
  defender_rolls: [6, 4, 5, 3, 2, 6],
  attacker_losses: 2,
  defender_losses: 3,
  territory_captured: true,
  attacker_bonus_breakdown: { tech: 1, faction: 1, event: 1, pending: 1, total: 4 },
  defender_bonus_breakdown: { building: 1, tech: 1, faction: 1, wonder: 1, naval_bombardment: 2, total: 6 },
  combat_ability_callouts: [{ id: 'knights_charge' }],
  fromName: 'Constantinople',
  toName: 'Anatolia',
  attackerName: 'Byzantium',
  defenderName: 'Seljuks',
} as unknown as CombatResult;

function buildMockGameState(): GameState {
  return {
    game_id: 'modal-lab',
    status: 'in_progress',
    phase: 'draft',
    current_player_index: 0,
    turn_number: 3,
    players: [
      {
        player_id: 'p1',
        user_id: 'u1',
        username: 'Tester',
        color_hex: '#d4af37',
        territory_count: 12,
        cards: [],
        capital_territory_id: null,
        secret_mission: null,
        is_ai: false,
        is_eliminated: false,
        available_abilities: [],
        ability_cooldowns: {},
        unlocked_techs: ['bronze_working'],
        tech_points: 8,
        faction_id: null,
      },
    ],
    territories: {},
    settings: {
      turn_timer_seconds: 300,
      max_players: 4,
      ai_player_count: 0,
      ai_difficulty: 'medium',
      fog_of_war: false,
      game_mode: 'classic',
      map_id: 'era_ancient',
      territory_selection: false,
      initial_unit_count: 3,
      economy_enabled: true,
      tech_trees_enabled: true,
      events_enabled: true,
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

const mockEventCard: EventCard = {
  card_id: 'spring-floods',
  title: 'Spring Floods',
  description: 'Heavy rains overwhelm river valleys. Choose between emergency fortifications or broader relief efforts for your population.',
  category: 'regional',
  era_id: 'ancient',
  affects_all_players: false,
  choices: [
    { choice_id: 'fortify', label: 'Raise temporary defenses', effect: { type: 'defense_modifier', target: 'self', value: 1, duration_turns: 2 } },
    { choice_id: 'relief', label: 'Redirect grain to relief camps', effect: { type: 'production_bonus', target: 'self', value: 2, duration_turns: 2 } },
    { choice_id: 'conscription', label: 'Press locals into repair crews', effect: { type: 'units_added', target: 'self', value: 3 } },
  ],
  result_summary: Array.from({ length: 8 }, (_, index) => ({
    territory_id: `t${index + 1}`,
    name: `Floodplain ${index + 1}`,
    delta: index % 2 === 0 ? -1 : 1,
  })),
};

const mockTechTree: TechNode[] = [
  { tech_id: 'bronze_working', name: 'Bronze Working', description: 'Sharper weapons and stronger armor.', tier: 1, cost: 3, attack_bonus: 1 },
  { tech_id: 'road_networks', name: 'Road Networks', description: 'Move troops and supplies more efficiently.', tier: 1, cost: 3, reinforce_bonus: 1 },
  { tech_id: 'siegecraft', name: 'Siegecraft', description: 'Build engines to break strongholds.', tier: 2, cost: 5, prerequisite: 'bronze_working', attack_bonus: 1 },
  { tech_id: 'civil_service', name: 'Civil Service', description: 'Formal bureaucracy improves output.', tier: 2, cost: 5, prerequisite: 'road_networks', tech_point_income: 1 },
  { tech_id: 'fortified_cities', name: 'Fortified Cities', description: 'Major settlements become hard to crack.', tier: 3, cost: 7, prerequisite: 'siegecraft', defense_bonus: 1 },
  { tech_id: 'imperial_logistics', name: 'Imperial Logistics', description: 'Empire-wide supply chains sustain larger armies.', tier: 3, cost: 7, prerequisite: 'civil_service', reinforce_bonus: 2 },
  { tech_id: 'legendary_generals', name: 'Legendary Generals', description: 'Elite command doctrine unlocks decisive campaigns.', tier: 4, cost: 9, prerequisite: 'fortified_cities', unlocks_ability: 'Decisive March' },
];

export default function ModalLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedModal = searchParams.get('modal') as LabModal;
  const [localOpen, setLocalOpen] = useState<LabModal>(requestedModal);

  const activeModal = requestedModal ?? localOpen;
  const setActiveModal = (value: LabModal) => {
    setLocalOpen(value);
    if (value) {
      setSearchParams({ modal: value });
    } else {
      setSearchParams({});
    }
  };

  const mockState = useMemo(() => buildMockGameState(), []);

  return (
    <div className="min-h-screen bg-bf-dark text-bf-text px-4 py-8 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl text-bf-gold">Modal Lab</h1>
            <p className="text-sm text-bf-muted mt-2">Hidden QA route for mobile viewport checks. Use an iPhone-sized viewport to verify scroll and action reachability.</p>
          </div>
          <Link to="/" className="btn-secondary">Back to app</Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button type="button" className="btn-primary" onClick={() => setActiveModal('create')}>Open shared modal</button>
          <button type="button" className="btn-primary" onClick={() => setActiveModal('event')}>Open event modal</button>
          <button type="button" className="btn-primary" onClick={() => setActiveModal('tech')}>Open tech modal</button>
          <button type="button" className="btn-primary" onClick={() => setActiveModal('combat')}>Open combat modal</button>
          <button type="button" className="btn-primary" onClick={() => setActiveModal('combat-tutorial')}>Combat + tutorial</button>
        </div>

        <div className="card space-y-3">
          <p className="text-sm text-bf-muted">Direct test URLs:</p>
          <ul className="space-y-2 text-sm">
            <li><a className="text-bf-gold underline" href="/__modal-lab?modal=create">/__modal-lab?modal=create</a></li>
            <li><a className="text-bf-gold underline" href="/__modal-lab?modal=event">/__modal-lab?modal=event</a></li>
            <li><a className="text-bf-gold underline" href="/__modal-lab?modal=tech">/__modal-lab?modal=tech</a></li>
            <li><a className="text-bf-gold underline" href="/__modal-lab?modal=combat">/__modal-lab?modal=combat</a></li>
            <li><a className="text-bf-gold underline" href="/__modal-lab?modal=combat-tutorial">/__modal-lab?modal=combat-tutorial</a></li>
          </ul>
        </div>
      </div>

      <Modal
        open={activeModal === 'create'}
        onClose={() => setActiveModal(null)}
        title="Configure New Game"
        className="max-w-2xl w-full"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {Array.from({ length: 14 }, (_, index) => (
            <div key={index}>
              <label className="label">Setting {index + 1}</label>
              <div className="input">Sample control content</div>
            </div>
          ))}
          <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t border-bf-border bg-bf-surface/95 backdrop-blur md:col-span-2">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end">
              <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setActiveModal(null)}>Cancel</button>
              <button type="button" className="btn-primary w-full sm:flex-1">Create &amp; Enter Lobby</button>
            </div>
          </div>
        </div>
      </Modal>

      {activeModal === 'event' && (
        <EventCardModal
          card={mockEventCard}
          isMyTurn
          onChoice={() => setActiveModal(null)}
          onDismiss={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'tech' && (
        <TechTreeModal
          gameState={mockState}
          currentPlayerId="p1"
          techTree={mockTechTree}
          onResearch={() => undefined}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'combat' && (
        <ActionModal
          data={{ type: 'combat', result: mockCombatResult, perspective: 'attacker' }}
          onDismiss={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'combat-tutorial' && (
        <>
          <ActionModal
            data={{ type: 'combat', result: mockCombatResult, perspective: 'attacker' }}
            onDismiss={() => setActiveModal(null)}
          />
          <TutorialOverlay
            steps={[mockTutorialAttackStep]}
            stepIndex={0}
            lessonModule="core"
            onAdvance={() => undefined}
            onContinuePlaying={() => undefined}
            onReturnToLobby={() => undefined}
            onExitTutorial={() => setActiveModal(null)}
            behindModal
          />
        </>
      )}
    </div>
  );
}