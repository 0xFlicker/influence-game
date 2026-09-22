CREATE TABLE visual_game_assets (
  game_id text PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  profiles jsonb NOT NULL,
  "cast" jsonb NOT NULL DEFAULT '[]'::jsonb,
  portraits jsonb NOT NULL DEFAULT '{}'::jsonb,
  backgrounds jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'ready', 'failed')),
  failure text
);
--> statement-breakpoint
CREATE TABLE visual_room_library (
  room_id text NOT NULL,
  version integer NOT NULL,
  image bytea NOT NULL,
  PRIMARY KEY (room_id, version)
);
--> statement-breakpoint
ALTER TABLE visual_scenes ADD COLUMN after_dialogue_sequence integer NOT NULL DEFAULT 0;
