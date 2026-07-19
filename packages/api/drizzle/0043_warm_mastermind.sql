CREATE TABLE "authentication_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"retired_at" text,
	CONSTRAINT "authentication_credentials_provider_check" CHECK ("authentication_credentials"."provider" IN ('privy', 'clerk'))
);
--> statement-breakpoint
CREATE TABLE "verified_email_claims" (
	"normalized_email" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"state" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "verified_email_claims_state_check" CHECK ("verified_email_claims"."state" IN ('active', 'conflict')),
	CONSTRAINT "verified_email_claims_state_user_check" CHECK ((
      ("verified_email_claims"."state" = 'active' AND "verified_email_claims"."user_id" IS NOT NULL)
      OR ("verified_email_claims"."state" = 'conflict' AND "verified_email_claims"."user_id" IS NULL)
    )),
	CONSTRAINT "verified_email_claims_normalized_email_canonical_check" CHECK (lower(btrim("verified_email_claims"."normalized_email")) = "verified_email_claims"."normalized_email")
);
--> statement-breakpoint
ALTER TABLE "authentication_credentials" ADD CONSTRAINT "authentication_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_email_claims" ADD CONSTRAINT "verified_email_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authentication_credentials_provider_subject_unique" ON "authentication_credentials" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "authentication_credentials_active_user_id_idx" ON "authentication_credentials" USING btree ("user_id") WHERE "authentication_credentials"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "verified_email_claims_active_user_id_unique" ON "verified_email_claims" USING btree ("user_id") WHERE "verified_email_claims"."state" = 'active';