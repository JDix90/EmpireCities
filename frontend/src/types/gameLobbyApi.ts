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
}

export interface GameLobbySettingsJson {
  max_players?: number;
  fog_of_war?: boolean;
  turn_timer_seconds?: number;
  victory_type?: string;
  initial_unit_count?: number;
  card_set_escalating?: boolean;
  diplomacy_enabled?: boolean;
  tutorial?: boolean;
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
