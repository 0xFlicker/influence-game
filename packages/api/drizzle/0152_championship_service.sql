ALTER TABLE service_principals DROP CONSTRAINT service_principals_purpose_check;
--> statement-breakpoint
ALTER TABLE service_principals ADD CONSTRAINT service_principals_purpose_check CHECK (purpose IN ('free_queue', 'championship'));
