/** Response shape for GET /api/games/:gameId (waiting or in-progress). */

export interface GameLobbyPlayerRow {
  player_index: number;
  user_id: string | null;
  username: string | null;
  player_color: string;
  is_ai: boolean;
  ai_difficulty: string | null;
  is_eliminated: boolean;
  final_rank?: number | null;
  faction_id?: string | null;
}

export interface GameLobbySettingsJson {
  max_players?: number;
  fog_of_war?: boolean;
  turn_timer_seconds?: number;
  victory_type?: string;
  allowed_victory_conditions?: string[];
  victory_threshold?: number;
  initial_unit_count?: number;
  card_set_escalating?: boolean;
  diplomacy_enabled?: boolean;
  tutorial?: boolean;
  factions_enabled?: boolean;
  economy_enabled?: boolean;
  tech_trees_enabled?: boolean;
  events_enabled?: boolean;
  naval_enabled?: boolean;
  stability_enabled?: boolean;
  [key: string]: unknown;
}

export interface GameLobbySnapshot {
  game_id: string;
  era_id: string;
  map_id: string;
  status: string;
  join_code?: string | null;
  settings_json: GameLobbySettingsJson | null;
  players: GameLobbyPlayerRow[];
}
