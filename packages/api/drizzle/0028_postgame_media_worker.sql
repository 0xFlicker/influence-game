CREATE TABLE "game_postgame_media_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"previous_render_version" integer,
	"current_render_version" integer,
	"safe_metadata" jsonb,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_postgame_media_audit_action_check" CHECK ("game_postgame_media_audit_events"."action" IN ('completion_reconcile', 'backfill', 'rerender')),
	CONSTRAINT "game_postgame_media_audit_outcome_check" CHECK ("game_postgame_media_audit_events"."outcome" IN ('queued', 'waiting_inputs', 'suppressed', 'failed', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "game_postgame_media" DROP CONSTRAINT "game_postgame_media_snapshot_version_check";--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "render_input_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "render_input_snapshot_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "render_input_snapshot_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "renderer_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "timing_contract_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ALTER COLUMN "music_asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media" ADD COLUMN "artifact_version" text;--> statement-breakpoint
UPDATE "game_postgame_media"
SET "artifact_version" = 'legacy_' || substr(md5("game_id" || ':' || "render_version"::text), 1, 24)
WHERE "render_input_snapshot" IS NOT NULL
  AND "artifact_version" IS NULL;--> statement-breakpoint
ALTER TABLE "game_postgame_media_audit_events" ADD CONSTRAINT "game_postgame_media_audit_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_postgame_media_audit_events" ADD CONSTRAINT "game_postgame_media_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_postgame_media_audit_game_idx" ON "game_postgame_media_audit_events" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "game_postgame_media_audit_actor_idx" ON "game_postgame_media_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
ALTER TABLE "game_postgame_media" ADD CONSTRAINT "game_postgame_media_snapshot_provenance_check" CHECK (
    ("game_postgame_media"."render_input_snapshot" IS NULL
      AND "game_postgame_media"."render_input_snapshot_hash" IS NULL
      AND "game_postgame_media"."render_input_snapshot_version" IS NULL
      AND "game_postgame_media"."artifact_version" IS NULL
      AND "game_postgame_media"."renderer_version" IS NULL
      AND "game_postgame_media"."timing_contract_version" IS NULL
      AND "game_postgame_media"."music_asset_id" IS NULL)
    OR ("game_postgame_media"."render_input_snapshot" IS NOT NULL
      AND "game_postgame_media"."render_input_snapshot_hash" IS NOT NULL
      AND "game_postgame_media"."render_input_snapshot_version" > 0
      AND "game_postgame_media"."artifact_version" IS NOT NULL
      AND "game_postgame_media"."renderer_version" IS NOT NULL
      AND "game_postgame_media"."timing_contract_version" IS NOT NULL
      AND "game_postgame_media"."music_asset_id" IS NOT NULL)
  );
