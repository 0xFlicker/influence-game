ALTER TABLE "legal_acceptances" ADD COLUMN "deployment_sha" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ALTER COLUMN "deployment_sha" DROP DEFAULT;
