/**
 * A campaign stage's turn clock (`solo_untimed_enabled`). Nobody waits on a
 * solo player: their seat already waits for them when they leave, so the clock
 * only took turns off players still at the screen. Off, the setting is left
 * out and the stage gets the default clock it always had.
 */
export function campaignClockSettings(soloUntimed: boolean): { turn_timer_seconds?: number } {
  return soloUntimed ? { turn_timer_seconds: 0 } : {};
}
