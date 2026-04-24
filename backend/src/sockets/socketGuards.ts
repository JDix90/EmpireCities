export function getStartGameAuthorizationError(params: {
  callerSeat: { player_index: number } | null;
  gameStatus: string;
}): string | null {
  const { callerSeat, gameStatus } = params;
  if (!callerSeat) return 'Only players in this lobby can start or resume this game';
  if (gameStatus === 'waiting' && callerSeat.player_index !== 0) return 'Only the host can start this game';
  return null;
}

export function getCancelGameAuthorizationError(params: {
  callerSeat: { player_index: number } | null;
}): string | null {
  const { callerSeat } = params;
  if (!callerSeat) return 'Only players in this lobby can cancel it';
  if (callerSeat.player_index !== 0) return 'Only the host can cancel this game';
  return null;
}

export function getFortifyUnitsValidationError(units: number): string | null {
  if (!Number.isInteger(units) || units < 1) {
    return 'Fortify units must be a positive whole number';
  }
  return null;
}
