/**
 * Whether a game event comes from a game other than the one this page shows.
 *
 * The server sends some game events to a player's user room (`user:<id>`)
 * rather than to the game's room: their own game state, their copy of a map
 * visual under fog, truce offers and alerts, coaching tips, campaign progress.
 * Every socket the player has open receives them, whichever game it is
 * showing, so a page checks the game each one names before acting on it.
 *
 * An event that names no game comes from an older server and keeps the old
 * reading, as does a page that has no game id.
 */
export function isForAnotherGame(
  eventGameId: string | null | undefined,
  gameId: string | null | undefined,
): boolean {
  return !!eventGameId && !!gameId && eventGameId !== gameId;
}
