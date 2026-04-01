-- Allow deleting a user while keeping historical games (human slot becomes NULL).
ALTER TABLE game_players DROP CONSTRAINT IF EXISTS game_players_user_id_fkey;
ALTER TABLE game_players
  ADD CONSTRAINT game_players_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_winner_id_fkey;
ALTER TABLE games
  ADD CONSTRAINT games_winner_id_fkey
  FOREIGN KEY (winner_id) REFERENCES users(user_id) ON DELETE SET NULL;
