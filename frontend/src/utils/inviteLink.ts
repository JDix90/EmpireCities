/**
 * Build the shareable invite URL for a game.
 *
 * Prefers the join-code link (`/join/:code`), which routes a fresh invitee
 * through the lobby join flow so they're added to the game before opening it.
 * The raw `/game/:id` URL only works for existing participants — handing it to a
 * new invitee produces "Game Not Found" — so it's used only as a last resort
 * when no join code is available (and the `/game/:id` route now self-heals).
 */
export function buildInviteUrl(origin: string, gameId: string, joinCode: string | null | undefined): string {
  if (joinCode) return `${origin}/join/${joinCode}`;
  return `${origin}/game/${gameId}`;
}
