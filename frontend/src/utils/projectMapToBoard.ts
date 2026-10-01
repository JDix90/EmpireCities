/**
 * Project an authored map down to the territories a game actually has in play.
 *
 * Era maps author later-era frontier tiles (`unlock_era_index > 0`) that only
 * enter play through Era Advancement. The server already projects the map it
 * sends a live game (`game:map`), but a replay or spectator view fetches the
 * full authored document from the REST API and then draws every tile — so an
 * Ancient replay showed the Americas painted in player colours, region labels
 * for regions that were never in play, and stray building glyphs.
 *
 * The game state is the source of truth for what is in play: a snapshot's
 * `territories` holds exactly the tiles that existed at that moment, growing
 * when an era unlocks a frontier. So the board for a frame is the map filtered
 * to that snapshot's territory ids: connections keep only those with both ends
 * on the board, and regions keep only those with at least one tile on it.
 *
 * Returns the same object when nothing needs removing, so memoised consumers
 * (the Pixi and globe renderers rebuild geometry when the map object changes)
 * are not churned.
 */
export interface BoardMapLike {
  territories: Array<{ territory_id: string; region_id: string }>;
  connections: Array<{ from: string; to: string }>;
  regions?: Array<{ region_id: string }>;
}

export function projectMapToBoard<M extends BoardMapLike>(map: M, inPlay: ReadonlySet<string>): M {
  if (map.territories.every((t) => inPlay.has(t.territory_id))) return map;
  const territories = map.territories.filter((t) => inPlay.has(t.territory_id));
  const onBoard = new Set(territories.map((t) => t.territory_id));
  const connections = map.connections.filter((c) => onBoard.has(c.from) && onBoard.has(c.to));
  const regionsInPlay = new Set(territories.map((t) => t.region_id));
  const regions = map.regions?.filter((r) => regionsInPlay.has(r.region_id));
  return { ...map, territories, connections, ...(regions ? { regions } : {}) };
}

/**
 * A stable key for the set of territory ids a snapshot has in play, so a
 * memo on it only recomputes when the board actually grows — not every frame.
 */
export function boardKeyOf(territories: Record<string, unknown> | null | undefined): string {
  if (!territories) return '';
  return Object.keys(territories).sort().join('|');
}
