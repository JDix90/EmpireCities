/** Client mirror of backend map visual event payloads. */

export type MapVisualKind =
  | 'reinforce'
  | 'combat'
  | 'fortify'
  | 'capture'
  | 'strike'
  | 'naval'
  | 'influence'
  | 'event'
  | 'era_advance'
  | 'frontier_unlock';

export interface MapVisualEvent {
  id: string;
  kind: MapVisualKind;
  territoryId: string;
  fromTerritoryId?: string;
  playerId?: string;
  playerColor?: string;
  attackerColor?: string;
  defenderColor?: string;
  newOwnerColor?: string;
  units?: number;
  totalAfter?: number;
  attackerLosses?: number;
  defenderLosses?: number;
  captured?: boolean;
  variant?: string;
  unitReduction?: number;
  affectedTerritories?: Array<{ territory_id: string; delta: number }>;
  regionId?: string;
  global?: boolean;
  cardId?: string;
}

/** GlobeMap historically used this name — alias for compatibility. */
export type GlobeEvent = MapVisualEvent & {
  type?: MapVisualKind;
  strikeAbilityId?: string;
};

/** Normalize server payload or legacy GlobeEvent shape. */
export function normalizeMapVisualEvent(raw: MapVisualEvent & { type?: MapVisualKind; strikeAbilityId?: string }): MapVisualEvent {
  const kind = raw.kind ?? raw.type ?? 'combat';
  return {
    ...raw,
    kind,
    variant: raw.variant ?? raw.strikeAbilityId,
  };
}
