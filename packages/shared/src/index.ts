/**
 * Shared types/constants for frontend + backend. Extend incrementally to reduce drift.
 */

export type GamePhase = 'territory_select' | 'draft' | 'attack' | 'fortify' | 'game_over';

export type ConnectionType = 'land' | 'sea';

export interface MapConnectionEdge {
  from: string;
  to: string;
  type?: ConnectionType;
}
