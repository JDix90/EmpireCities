import { describe, expect, it } from 'vitest';
import { incomingAttackCardMode, ownAttackCardMode } from './combatPresentation';

describe('combat presentation', () => {
  it('shows the dice in lite mode instead of swallowing them', () => {
    // The regression this guards: lite mode ("skip combat & map animations")
    // dropped the readout entirely, so neither attacking nor being attacked
    // showed a roll.
    expect(ownAttackCardMode({ liteMode: true, canRepeatAttack: false }).show).toBe(true);
    expect(ownAttackCardMode({ liteMode: true, canRepeatAttack: true }).show).toBe(true);
    expect(incomingAttackCardMode({ liteMode: true }).show).toBe(true);
  });

  it('lets lite mode move on by itself once there is nothing to decide', () => {
    expect(ownAttackCardMode({ liteMode: true, canRepeatAttack: false }).autoAdvance).toBe(true);
  });

  it('still waits for a click when the same attack can be rolled again', () => {
    // "Attack again" and "Blitz" live on this card; auto-dismissing would take
    // the choice away.
    expect(ownAttackCardMode({ liteMode: true, canRepeatAttack: true }).autoAdvance).toBe(false);
    expect(ownAttackCardMode({ liteMode: false, canRepeatAttack: true }).autoAdvance).toBe(false);
  });

  it('leaves the normal attacker card waiting on the player', () => {
    expect(ownAttackCardMode({ liteMode: false, canRepeatAttack: false }).autoAdvance).toBe(false);
  });

  it('keeps incoming attacks a rolling theater in every mode', () => {
    expect(incomingAttackCardMode({ liteMode: false }).autoAdvance).toBe(true);
    expect(incomingAttackCardMode({ liteMode: true }).autoAdvance).toBe(true);
  });
});
