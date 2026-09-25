CREATE TABLE "game_episode_presentations" (
 "game_id" text PRIMARY KEY REFERENCES "games"("id") ON DELETE CASCADE,
 "title" text, "description" text, "cover_url" text,
 "locked" boolean NOT NULL DEFAULT false,
 "revision" integer NOT NULL DEFAULT 0,
 "status" text NOT NULL DEFAULT 'queued',
 "lease_token" text, "lease_until" text, "failure" text,
 "updated_at" text NOT NULL DEFAULT now()::text,
 CONSTRAINT "episode_status_check" CHECK ("status" IN ('queued','generating','ready','failed'))
);
