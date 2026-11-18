/**
 * Seat colours for a game made in the lobby, in seat order (the host is seat 0).
 *
 * Seat 7 was a second orange (#e67e22) next to seat 4's #f39c12 (PT-016).
 */
const LOBBY_SEAT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ff69b4', '#ecf0f1'] as const;

/**
 * The colours a new lobby game deals. In a game against bots alone (every seat
 * but the host's is a bot) the host is blue and the first bot red, as in the
 * tutorial, the campaign and the Daily Challenge: the tutorial tells a player
 * their territories are "shown in blue", and their next game should agree.
 * A game with a human seat to fill keeps the lobby order, which the join route
 * deals from by seat.
 */
export function lobbySeatColors(aiCount: number, maxPlayers: number): string[] {
  const colors: string[] = [...LOBBY_SEAT_COLORS];
  if (aiCount > 0 && aiCount === maxPlayers - 1) {
    [colors[0], colors[1]] = [colors[1]!, colors[0]!];
  }
  return colors;
}
