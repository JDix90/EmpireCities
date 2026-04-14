// ============================================================
// Event Card Manager — draw, apply effects, resolve choices
// ============================================================

import type {
  GameState,
  EventCard,
  EventEffect,
  EventEffectType,
  EventEffectResult,
  TemporaryModifier,
  EraId,
} from '../../types';

// Era-specific decks (lazy imports to keep module thin)
import { ancientEvents } from './decks/ancient';
import { medievalEvents } from './decks/medieval';
import { discoveryEvents } from './decks/discovery';
import { ww2Events } from './decks/ww2';
import { coldwarEvents } from './decks/coldwar';
import { modernEvents } from './decks/modern';
import { acwEvents } from './decks/acw';
import { risorgimentoEvents } from './decks/risorgimento';

const ERA_DECKS: Record<string, EventCard[]> = {
  ancient: ancientEvents,
  medieval: medievalEvents,
  discovery: discoveryEvents,
  ww2: ww2Events,
  coldwar: coldwarEvents,
  modern: modernEvents,
  acw: acwEvents,
  risorgimento: risorgimentoEvents,
};

/** Returns the full event card deck for an era. */
export function getEraDeck(eraId: EraId): EventCard[] {
  return ERA_DECKS[eraId] ?? [];
}

/** Draw a random card from a deck. Returns undefined if deck is empty. */
export function drawRandomCard(deck: EventCard[]): EventCard | undefined {
  if (deck.length === 0) return undefined;
  return deck[Math.floor(Math.random() * deck.length)];
}

/**
 * Apply an instant event effect to the game state.
 * For player-targeted effects the current player is used unless target_id specifies another.
 */
export function applyEventEffect(state: GameState, effect: EventEffect): EventEffectResult {
  const currentPlayer = state.players[state.current_player_index];
  const affected: Array<{ territory_id: string; delta: number }> = [];

  switch (effect.type) {
    case 'units_added': {
      if (effect.target === 'player') {
        // Add units spread across the player's territories (largest first)
        const entries = Object.entries(state.territories)
          .filter(([, t]) => t.owner_id === currentPlayer.player_id)
          .sort(([, a], [, b]) => b.unit_count - a.unit_count);
        let remaining = Math.max(0, effect.value);
        for (const [id, t] of entries) {
          if (remaining <= 0) break;
          t.unit_count += 1;
          affected.push({ territory_id: id, delta: 1 });
          remaining--;
        }
      } else if (effect.target === 'territory' && effect.target_id) {
        const t = state.territories[effect.target_id];
        if (t) {
          t.unit_count = Math.max(1, t.unit_count + effect.value);
          affected.push({ territory_id: effect.target_id, delta: effect.value });
        }
      }
      break;
    }
    case 'units_removed': {
      if (effect.target === 'player') {
        const entries = Object.entries(state.territories)
          .filter(([, t]) => t.owner_id === currentPlayer.player_id)
          .sort(([, a], [, b]) => b.unit_count - a.unit_count);
        let remaining = Math.max(0, effect.value);
        for (const [id, t] of entries) {
          if (remaining <= 0) break;
          const removable = Math.max(0, t.unit_count - 1);
          const remove = Math.min(removable, remaining);
          if (remove > 0) {
            t.unit_count -= remove;
            affected.push({ territory_id: id, delta: -remove });
          }
          remaining -= remove;
        }
      } else if (effect.target === 'region') {
        // Remove units from all territories in the region
        for (const t of Object.values(state.territories)) {
          if (t.unit_count > 1) {
            const remove = Math.min(t.unit_count - 1, effect.value);
            t.unit_count -= remove;
          }
        }
      }
      break;
    }
    case 'attack_modifier':
    case 'defense_modifier':
    case 'production_bonus': {
      if (effect.duration_turns && effect.duration_turns > 0) {
        // Add as a temporary modifier on the current player
        const mods: TemporaryModifier[] = currentPlayer.temporary_modifiers ?? [];
        mods.push({
          type: effect.type,
          value: effect.value,
          turns_remaining: effect.duration_turns,
        });
        currentPlayer.temporary_modifiers = mods;
      }
      break;
    }
    case 'truce': {
      // Force a truce between the current player and their most recently fought opponent.
      // Priority: last attacked player → any opponent currently at war → random.
      const opponents = state.players.filter(
        (p) => !p.is_eliminated && p.player_id !== currentPlayer.player_id,
      );
      if (opponents.length > 0) {
        let opponent = opponents.find(
          (p) => p.player_id === currentPlayer.last_attacked_player_id,
        );
        if (!opponent) {
          opponent = opponents.find((p) => {
            const d = state.diplomacy.find(
              (e) =>
                (e.player_index_a === currentPlayer.player_index && e.player_index_b === p.player_index) ||
                (e.player_index_a === p.player_index && e.player_index_b === currentPlayer.player_index),
            );
            return d?.status === 'war';
          });
        }
        if (!opponent) {
          opponent = opponents[Math.floor(Math.random() * opponents.length)];
        }
        const entry = state.diplomacy.find(
          (d) =>
            (d.player_index_a === currentPlayer.player_index && d.player_index_b === opponent!.player_index) ||
            (d.player_index_a === opponent!.player_index && d.player_index_b === currentPlayer.player_index),
        );
        if (entry) {
          entry.status = 'truce';
          entry.truce_turns_remaining = effect.value || 1;
        }
      }
      break;
    }
    case 'region_disaster': {
      // Remove units from every territory (all players) — simulates plague, famine, etc.
      for (const t of Object.values(state.territories)) {
        if (t.unit_count > 1) {
          const remove = Math.min(t.unit_count - 1, effect.value);
          t.unit_count -= remove;
        }
      }
      return { global: true };
    }
  }

  return affected.length > 0 ? { affected_territories: affected } : {};
}

/**
 * Resolve a player's choice on an active event card.
 * Finds the chosen effect and applies it, then clears `active_event`.
 */
export function resolveEventChoice(
  state: GameState,
  cardId: string,
  choiceId: string,
): boolean {
  const event = state.active_event;
  if (!event || event.card_id !== cardId) return false;

  const choice = event.choices?.find((c) => c.choice_id === choiceId);
  if (!choice) return false;

  applyEventEffect(state, choice.effect);
  state.active_event = undefined;
  return true;
}

/**
 * Decrement `turns_remaining` on each temporary modifier for a player.
 * Removes expired modifiers.
 */
export function tickTemporaryModifiers(state: GameState, playerId: string): void {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || !player.temporary_modifiers) return;

  for (const m of player.temporary_modifiers) {
    m.turns_remaining--;
  }
  player.temporary_modifiers = player.temporary_modifiers.filter((m) => m.turns_remaining > 0);
  if (player.temporary_modifiers.length === 0) {
    player.temporary_modifiers = undefined;
  }
}

/** Sum up temporary modifier values of a given type for a player. */
export function getTemporaryModifierValue(
  state: GameState,
  playerId: string,
  type: EventEffectType,
): number {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player?.temporary_modifiers) return 0;
  return player.temporary_modifiers
    .filter((m) => m.type === type)
    .reduce((sum, m) => sum + m.value, 0);
}
