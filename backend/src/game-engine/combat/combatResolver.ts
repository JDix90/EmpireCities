import { randomInt } from 'crypto';
import type { CombatResult } from '../../types';

/**
 * Roll N cryptographically random six-sided dice.
 * Returns the results sorted in descending order.
 */
function rollDice(count: number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(randomInt(1, 7)); // 1–6 inclusive
  }
  return rolls.sort((a, b) => b - a);
}

/**
 * Resolve a single combat exchange between an attacker and defender.
 *
 * @param attackingUnits  Total units in the attacking territory (must be >= 2)
 * @param defendingUnits  Total units in the defending territory (must be >= 1)
 * @param attackerDiceOverride  Optional: override attacker dice count (for special units)
 * @param defenderDiceOverride  Optional: override defender dice count (for special units)
 */
export function resolveCombat(
  attackingUnits: number,
  defendingUnits: number,
  attackerDiceOverride?: number,
  defenderDiceOverride?: number
): CombatResult {
  if (attackingUnits < 2) {
    throw new Error('Attacker must have at least 2 units to attack');
  }
  if (defendingUnits < 1) {
    throw new Error('Defender must have at least 1 unit');
  }

  // Determine dice counts
  const attackerDice = attackerDiceOverride ?? Math.min(attackingUnits - 1, 3);
  const defenderDice = defenderDiceOverride ?? Math.min(defendingUnits, 2);

  const attackerRolls = rollDice(attackerDice);
  const defenderRolls = rollDice(defenderDice);

  let attackerLosses = 0;
  let defenderLosses = 0;

  // Compare dice pairs (highest vs highest, second vs second)
  const comparisons = Math.min(attackerDice, defenderDice);
  for (let i = 0; i < comparisons; i++) {
    if (attackerRolls[i] > defenderRolls[i]) {
      // Attacker wins this comparison — defender loses a unit
      defenderLosses++;
    } else {
      // Defender wins ties — attacker loses a unit
      attackerLosses++;
    }
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
 * Minimum of 3 units guaranteed.
 */
export function calculateReinforcements(
  territoryCount: number,
  continentBonuses: number
): number {
  const base = Math.max(3, Math.floor(territoryCount / 3));
  return base + continentBonuses;
}
