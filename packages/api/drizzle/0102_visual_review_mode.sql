ALTER TABLE visual_repair_jobs DROP CONSTRAINT visual_repair_jobs_mode_check;
--> statement-breakpoint
ALTER TABLE visual_repair_jobs ADD CONSTRAINT visual_repair_jobs_mode_check CHECK (mode IN ('regenerate','verify','continue','review'));
