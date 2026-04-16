import { randomInt } from 'crypto';
import type { CombatResult, EraModifiers } from '../../types';

/**
 * Roll N six-sided dice using `dieRoll` (defaults to crypto.randomInt).
 * Returns the results sorted in descending order.
 */
function rollDice(count: number, dieRoll: () => number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(dieRoll());
  }
  return rolls.sort((a, b) => b - a);
}

/**
 * Resolve a **single** combat exchange (one dice roll) between an attacker and defender.
 *
 * Each call to `game:attack` triggers exactly one exchange — the attacker commits up to 3 dice,
 * the defender up to 2, highest pairs are compared, and losses are applied. Capturing a territory
 * with a large garrison therefore requires the player to issue **multiple attacks**.
 * This matches classic Risk single-roll semantics for a responsive online experience.
 *
 * @param attackingUnits  Total units in the attacking territory (must be >= 2)
 * @param defendingUnits  Total units in the defending territory (must be >= 1)
 * @param attackerDiceOverride  Optional: override attacker dice count (for special units)
 * @param defenderDiceOverride  Optional: override defender dice count (for special units)
 * @param dieRoll  Optional: inject dice rolls (1–6 per call), in order: all attacker dice then all defender dice. Used by tests; production uses crypto.randomInt.
 * @param eraModifiers Optional era rules (e.g. Ancient legion re-roll).
 */
export function resolveCombat(
  attackingUnits: number,
  defendingUnits: number,
  attackerDiceOverride?: number,
  defenderDiceOverride?: number,
  dieRoll?: () => number,
  eraModifiers?: EraModifiers
): CombatResult {
  if (attackingUnits < 2) {
    return {
      attacker_rolls: [],
      defender_rolls: [],
      attacker_losses: 0,
      defender_losses: 0,
      territory_captured: false,
      error: 'Attacker must have at least 2 units to attack',
    };
  }
  if (defendingUnits < 1) {
    // Instead of throwing, return a result indicating no combat and log a warning
    if (typeof console !== 'undefined') {
      console.warn?.('resolveCombat: Defender must have at least 1 unit');
    }
    return {
      attacker_rolls: [],
      defender_rolls: [],
      attacker_losses: 0,
      defender_losses: 0,
      territory_captured: false,
      error: 'Defender must have at least 1 unit',
    };
  }

  // Determine dice counts
  const attackerDice = attackerDiceOverride ?? Math.min(attackingUnits - 1, 3);
  const defenderDice = defenderDiceOverride ?? Math.min(defendingUnits, 2);

  const rng = dieRoll ?? (() => randomInt(1, 7));
  const attackerRolls = rollDice(attackerDice, rng);
  const defenderRolls = rollDice(defenderDice, rng);

  // Ancient era: re-roll attacker's lowest die once, keep the better result
  if (eraModifiers?.legion_reroll && attackerRolls.length > 0) {
    const minIdx = attackerRolls.indexOf(Math.min(...attackerRolls));
    const reroll = rng();
    attackerRolls[minIdx] = Math.max(attackerRolls[minIdx], reroll);
    attackerRolls.sort((a, b) => b - a);
  }

  let attackerLosses = 0;
  let defenderLosses = 0;

  // Compare dice pairs (highest vs highest, second vs second, etc.)
  const comparisons = Math.min(attackerRolls.length, defenderRolls.length);
  for (let i = 0; i < comparisons; i++) {
    if (attackerRolls[i] > defenderRolls[i]) {
      // Attacker wins this comparison — defender loses a unit
      defenderLosses++;
    } else {
      // Defender wins ties — attacker loses a unit
      attackerLosses++;
    }
  }

  // ACW era: re-roll any attacker die that tied with a defender die (keep better result)
  if (eraModifiers?.rifle_doctrine) {
    // Recalculate using rerolled tied dice
    const rerollComparisons = Math.min(attackerRolls.length, defenderRolls.length);
    let newAttackerLosses = 0;
    let newDefenderLosses = 0;
    const rerolledAttackerRolls = [...attackerRolls];
    for (let i = 0; i < rerollComparisons; i++) {
      if (rerolledAttackerRolls[i] === defenderRolls[i]) {
        // Tie: attacker re-rolls this die
        const reroll = rng();
        rerolledAttackerRolls[i] = Math.max(rerolledAttackerRolls[i], reroll);
      }
    }
    rerolledAttackerRolls.sort((a, b) => b - a);
    for (let i = 0; i < rerollComparisons; i++) {
      if (rerolledAttackerRolls[i] > defenderRolls[i]) {
        newDefenderLosses++;
      } else {
        newAttackerLosses++;
      }
    }
    // Replace the original loss tallies with the rifle-doctrine adjusted ones
    attackerLosses = newAttackerLosses;
    defenderLosses = newDefenderLosses;
    // Update attacker_rolls in place so the client can see the rerolled dice
    attackerRolls.splice(0, attackerRolls.length, ...rerolledAttackerRolls);
  }

  const territory_captured =
    defenderLosses >= defendingUnits && attackerLosses < attackingUnits;

  return {
    attacker_rolls: attackerRolls,
    defender_rolls: defenderRolls,
    attacker_losses: attackerLosses,
    defender_losses: Math.min(defenderLosses, defendingUnits),
    territory_captured,
  };
}

/**
 * Calculate the card set redemption bonus based on how many sets
 * have been redeemed globally in this game.
 * Schedule: 4, 6, 8, 10, 12, 15, then +5 for each subsequent set.
 */
export function getCardSetBonus(redemptionCount: number): number {
  const schedule = [4, 6, 8, 10, 12, 15];
  if (redemptionCount < schedule.length) {
    return schedule[redemptionCount];
  }
  return 15 + (redemptionCount - schedule.length + 1) * 5;
}

/**
 * Calculate the base reinforcement units for a player.
 * Minimum of 3 units guaranteed (from territory count).
 *
 * Continent bonuses are scaled by active player count: with few players each side
 * owns a larger share of the map, so full-region control (and stacked bonuses) is
 * much more common than in a 6-player game. Reference size is 6 players.
 */
export function calculateReinforcements(
  territoryCount: number,
  continentBonuses: number,
  playerCount: number = 6
): number {
  const base = Math.max(3, Math.floor(territoryCount / 3));
  const pc = Math.max(2, Math.min(playerCount, 12));
  const scaledContinent = Math.floor((continentBonuses * pc) / 6);
  return base + scaledContinent;
}
