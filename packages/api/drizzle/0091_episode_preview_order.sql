ALTER TABLE "game_episode_presentations" ADD COLUMN "frame_order" jsonb NOT NULL DEFAULT '[]'::jsonb;
