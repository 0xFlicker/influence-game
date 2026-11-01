ALTER TABLE character_cutouts ADD COLUMN art_saved_at timestamptz, ADD COLUMN art_save_attempted_at timestamptz, ADD COLUMN save_error text;
--> statement-breakpoint
ALTER TABLE character_cutout_demands ADD COLUMN preparation_attempted_at timestamptz;
--> statement-breakpoint
ALTER TABLE game_players ADD COLUMN werewolf_player_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX game_players_werewolf_identity ON game_players (game_id, werewolf_player_id);
--> statement-breakpoint
-- A Werewolf participant needs the same durable relational presentation identity
-- as an Influence participant. This is created atomically with its start event.
CREATE FUNCTION create_werewolf_participants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event->>'type' = 'werewolf.started' THEN
    INSERT INTO game_players (id, game_id, werewolf_player_id, agent_profile_id, persona, agent_config)
    SELECT gen_random_uuid()::text, NEW.game_id, player->>'id', profile.id,
      CASE WHEN profile.id IS NULL THEN player::text ELSE jsonb_build_object('name', player->>'name')::text END, '{}'
    FROM jsonb_array_elements(NEW.event->'payload'->'players') player
    LEFT JOIN agent_profiles profile ON profile.id = player->>'agentProfileId'
    ON CONFLICT (game_id, werewolf_player_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER werewolf_participant_identity AFTER INSERT ON werewolf_events
FOR EACH ROW EXECUTE FUNCTION create_werewolf_participants();
