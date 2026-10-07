/**
 * The Custom Game form's Advanced fold (custom_lobby_fold_enabled).
 *
 * The form shows its main choices and folds the rest under Advanced. Closed,
 * the fold says what inside it is on, so a host never creates a game with a
 * rule switched on out of sight. Whether it is open is remembered per device.
 */

/** What the Advanced fold holds, as the form will send it. */
export interface CustomLobbyAdvancedChoices {
  customPairing: boolean;
  territoryDraft: boolean;
  factions: boolean;
  economy: boolean;
  techTrees: boolean;
  events: boolean;
  naval: boolean;
  stability: boolean;
  fogOfWar: boolean;
  diplomacy: boolean;
  coaching: boolean;
  eraAdvancement: boolean;
  uncappedCardSets: boolean;
  /** Whether the combat dice cap applies at all: it shows only once a dice-granting system is on. */
  diceCapApplies: boolean;
  diceCap: boolean;
  maxAttackerDice: number;
  maxDefenderDice: number;
}

/** The dice cap's defaults (LobbyPage.tsx): a cap left as it starts is not worth a mention. */
export const DEFAULT_MAX_ATTACKER_DICE = 5;
export const DEFAULT_MAX_DEFENDER_DICE = 4;

/**
 * The names of what is set inside the fold, in the order the form lists
 * them. Empty when everything there is as a new game starts.
 */
export function advancedSummary(c: CustomLobbyAdvancedChoices): string[] {
  const on: string[] = [];
  if (c.customPairing) on.push('Map pairing');
  if (c.territoryDraft) on.push('Territory Draft');
  if (c.factions) on.push('Asymmetric Factions');
  if (c.economy) on.push('Economy & Buildings');
  if (c.techTrees) on.push('Technology Trees');
  if (c.events) on.push('Historical Events');
  if (c.naval) on.push('Naval Warfare');
  if (c.stability) on.push('Population & Stability');
  if (c.fogOfWar) on.push('Fog of War');
  if (c.diplomacy) on.push('Diplomacy');
  if (c.coaching) on.push('In-Turn Coaching');
  if (c.eraAdvancement) on.push('Era Advancement');
  if (c.uncappedCardSets) on.push('Uncapped card sets');
  if (c.diceCapApplies) {
    if (!c.diceCap) on.push('No dice cap');
    else if (c.maxAttackerDice !== DEFAULT_MAX_ATTACKER_DICE || c.maxDefenderDice !== DEFAULT_MAX_DEFENDER_DICE) {
      on.push(`Dice cap ${c.maxAttackerDice}/${c.maxDefenderDice}`);
    }
  }
  return on;
}

const ADVANCED_OPEN_STORAGE_KEY = 'cc-custom-advanced-open';

/** Whether the host left the fold open last time on this device. Anything but a saved "open" reads as closed. */
export function loadAdvancedOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(ADVANCED_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAdvancedOpen(open: boolean): void {
  try {
    localStorage.setItem(ADVANCED_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable (private mode etc.): the fold just starts closed.
  }
}
