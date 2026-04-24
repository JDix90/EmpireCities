import { describe, expect, it } from 'vitest';
import {
  getCancelGameAuthorizationError,
  getFortifyUnitsValidationError,
  getStartGameAuthorizationError,
} from './socketGuards';

describe('getStartGameAuthorizationError', () => {
  it('rejects non-players', () => {
    expect(getStartGameAuthorizationError({ callerSeat: null, gameStatus: 'waiting' }))
      .toBe('Only players in this lobby can start or resume this game');
  });

  it('rejects non-host during waiting state', () => {
    expect(getStartGameAuthorizationError({ callerSeat: { player_index: 2 }, gameStatus: 'waiting' }))
      .toBe('Only the host can start this game');
  });

  it('allows host', () => {
    expect(getStartGameAuthorizationError({ callerSeat: { player_index: 0 }, gameStatus: 'waiting' }))
      .toBeNull();
  });
});

describe('getCancelGameAuthorizationError', () => {
  it('rejects non-players', () => {
    expect(getCancelGameAuthorizationError({ callerSeat: null }))
      .toBe('Only players in this lobby can cancel it');
  });

  it('rejects non-host player', () => {
    expect(getCancelGameAuthorizationError({ callerSeat: { player_index: 1 } }))
      .toBe('Only the host can cancel this game');
  });
});

describe('getFortifyUnitsValidationError', () => {
  it('rejects non-integer units', () => {
    expect(getFortifyUnitsValidationError(1.5)).toBe('Fortify units must be a positive whole number');
  });

  it('rejects non-positive units', () => {
    expect(getFortifyUnitsValidationError(0)).toBe('Fortify units must be a positive whole number');
    expect(getFortifyUnitsValidationError(-2)).toBe('Fortify units must be a positive whole number');
  });

  it('accepts positive integer', () => {
    expect(getFortifyUnitsValidationError(3)).toBeNull();
  });
});
