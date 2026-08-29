CREATE TABLE "deployment_recovery_reconciliations" (
	"lease_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" text,
	"last_error" text,
	"requested_at" text DEFAULT now()::text NOT NULL,
	"completed_at" text,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "deployment_recovery_reconciliations_status_check" CHECK ("deployment_recovery_reconciliations"."status" IN ('pending', 'running', 'succeeded')),
	CONSTRAINT "deployment_recovery_reconciliations_claim_check" CHECK ((
      "deployment_recovery_reconciliations"."status" = 'running'
      AND "deployment_recovery_reconciliations"."claim_token" IS NOT NULL
      AND "deployment_recovery_reconciliations"."claim_expires_at" IS NOT NULL
    ) OR (
      "deployment_recovery_reconciliations"."status" <> 'running'
      AND "deployment_recovery_reconciliations"."claim_token" IS NULL
      AND "deployment_recovery_reconciliations"."claim_expires_at" IS NULL
    ))
);
--> statement-breakpoint
ALTER TABLE "deployment_recovery_reconciliations" ADD CONSTRAINT "deployment_recovery_reconciliations_lease_id_deployment_admission_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."deployment_admission_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_recovery_reconciliations_status_idx" ON "deployment_recovery_reconciliations" USING btree ("status","updated_at");