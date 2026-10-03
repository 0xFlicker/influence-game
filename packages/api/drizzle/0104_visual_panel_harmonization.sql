ALTER TABLE visual_repair_jobs ADD COLUMN source_version_id text REFERENCES visual_media_versions(id);
--> statement-breakpoint
ALTER TABLE visual_repair_jobs DROP CONSTRAINT visual_repair_jobs_mode_check;
--> statement-breakpoint
ALTER TABLE visual_repair_jobs ADD CONSTRAINT visual_repair_jobs_mode_check CHECK (mode IN ('regenerate','harmonize','verify','continue','review'));
--> statement-breakpoint
ALTER TABLE visual_repair_jobs ADD CONSTRAINT visual_repair_jobs_panel_source_check CHECK (
 (mode <> 'harmonize' OR source_version_id IS NOT NULL)
 AND (source_version_id IS NULL OR (mode IN ('harmonize','continue') AND source_image_id IS NULL))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_visual_repair_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.game_id,NEW.scene_id,NEW.version,NEW.operator_id,NEW.mode,NEW.plan,NEW.render_context,NEW.source_image_id,NEW.source_version_id,NEW.reuse_prefix,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.game_id,OLD.scene_id,OLD.version,OLD.operator_id,OLD.mode,OLD.plan,OLD.render_context,OLD.source_image_id,OLD.source_version_id,OLD.reuse_prefix,OLD.created_at)
 THEN RAISE EXCEPTION 'Visual repair inputs are immutable'; END IF;
 RETURN NEW;
END $$;
