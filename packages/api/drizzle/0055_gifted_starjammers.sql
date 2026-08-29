CREATE TABLE "deployment_admission_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fencing_token" bigint NOT NULL,
	"candidate_sha" text NOT NULL,
	"source_repository" text NOT NULL,
	"workflow_run_id" bigint NOT NULL,
	"workflow_run_attempt" integer NOT NULL,
	"actor" text NOT NULL,
	"phase" text DEFAULT 'draining' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"acquired_at" text DEFAULT now()::text NOT NULL,
	"heartbeat_at" text DEFAULT now()::text NOT NULL,
	"expires_at" text NOT NULL,
	"absolute_deadline_at" text NOT NULL,
	"completed_at" text,
	"completion_reason" text,
	"revoked_at" text,
	"revoked_by" text,
	"revocation_reason" text,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "deployment_admission_leases_fence_check" CHECK ("deployment_admission_leases"."fencing_token" > 0),
	CONSTRAINT "deployment_admission_leases_candidate_sha_check" CHECK ("deployment_admission_leases"."candidate_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "deployment_admission_leases_source_repository_check" CHECK ("deployment_admission_leases"."source_repository" = '0xFlicker/linode-iac'),
	CONSTRAINT "deployment_admission_leases_workflow_run_check" CHECK ("deployment_admission_leases"."workflow_run_id" > 0 AND "deployment_admission_leases"."workflow_run_attempt" > 0),
	CONSTRAINT "deployment_admission_leases_actor_check" CHECK ("deployment_admission_leases"."actor" ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
	CONSTRAINT "deployment_admission_leases_phase_check" CHECK ("deployment_admission_leases"."phase" IN ('draining', 'validating', 'switching', 'accepting', 'restoring')),
	CONSTRAINT "deployment_admission_leases_status_check" CHECK ("deployment_admission_leases"."status" IN ('active', 'accepted', 'restored', 'aborted', 'revoked', 'expired')),
	CONSTRAINT "deployment_admission_leases_revision_check" CHECK ("deployment_admission_leases"."revision" > 0),
	CONSTRAINT "deployment_admission_leases_deadline_order_check" CHECK ("deployment_admission_leases"."expires_at"::timestamptz <= "deployment_admission_leases"."absolute_deadline_at"::timestamptz),
	CONSTRAINT "deployment_admission_leases_revocation_audit_check" CHECK ((
      "deployment_admission_leases"."status" = 'revoked'
      AND "deployment_admission_leases"."revoked_at" IS NOT NULL
      AND "deployment_admission_leases"."revoked_by" IS NOT NULL
      AND "deployment_admission_leases"."revocation_reason" IS NOT NULL
    ) OR (
      "deployment_admission_leases"."status" <> 'revoked'
      AND "deployment_admission_leases"."revoked_at" IS NULL
      AND "deployment_admission_leases"."revoked_by" IS NULL
      AND "deployment_admission_leases"."revocation_reason" IS NULL
    ))
);
--> statement-breakpoint
CREATE TABLE "deployment_admission_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"next_fencing_token" bigint DEFAULT 1 NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "deployment_admission_state_singleton_check" CHECK ("deployment_admission_state"."id" = 1),
	CONSTRAINT "deployment_admission_state_next_fence_check" CHECK ("deployment_admission_state"."next_fencing_token" > 0)
);
--> statement-breakpoint
INSERT INTO "deployment_admission_state" ("id") VALUES (1);--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_admission_leases_fence_unique" ON "deployment_admission_leases" USING btree ("fencing_token");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_admission_leases_one_active" ON "deployment_admission_leases" USING btree ("status") WHERE "deployment_admission_leases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "deployment_admission_leases_candidate_sha_idx" ON "deployment_admission_leases" USING btree ("candidate_sha");
