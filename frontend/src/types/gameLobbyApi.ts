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
  // Daily challenge metadata (populated by /api/daily/start)
  daily_challenge_date?: string;
  daily_challenge_spec?: {
    archetype: string;
    title?: string;
    intro?: string;
    goal?: string;
    max_turns?: number;
    player_count?: number;
    [k: string]: unknown;
  };
  // Campaign metadata (populated by /api/campaign/start and /api/campaign/continue)
  is_campaign?: boolean;
  campaign_path_id?: string;
  campaign_locked_faction?: string;
  campaign_path_name?: string;
  campaign_path_tagline?: string;
  campaign_signature_carry_label?: string;
  campaign_era_index?: number;
  campaign_era_count?: number;
  campaign_intro_text?: string;
  campaign_carry?: { survivor_bonus?: number; revolutionary_spirit?: number };
  campaign_prestige_bonus?: number;
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
