CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"terms_version" text NOT NULL,
	"privacy_version" text NOT NULL,
	"source" text NOT NULL,
	"accepted_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "legal_acceptances_source_check" CHECK ("legal_acceptances"."source" IN ('account_creation', 'existing_account'))
);
--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_user_versions_unique" ON "legal_acceptances" USING btree ("user_id","terms_version","privacy_version");