ALTER TABLE visual_repair_jobs ALTER COLUMN scene_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE visual_repair_jobs ADD CONSTRAINT visual_repair_job_target CHECK ((mode = 'forms' AND scene_id IS NULL) OR (mode <> 'forms' AND scene_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE visual_repair_jobs DROP CONSTRAINT visual_repair_jobs_mode_check;
--> statement-breakpoint
ALTER TABLE visual_repair_jobs ADD CONSTRAINT visual_repair_jobs_mode_check CHECK (mode IN ('regenerate','harmonize','verify','continue','review','forms'));
