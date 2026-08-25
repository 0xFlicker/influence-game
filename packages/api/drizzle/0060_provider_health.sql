CREATE TABLE "provider_health_states" (
  "scope_key" text PRIMARY KEY NOT NULL,
  "scope_kind" text NOT NULL,
  "provider_profile_id" text NOT NULL,
  "catalog_id" text,
  "state" text DEFAULT 'closed' NOT NULL,
  "reason" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "consecutive_failure_count" integer DEFAULT 0 NOT NULL,
  "window_started_at" text,
  "opened_at" text,
  "cooldown_until" text,
  "last_failure_at" text,
  "last_success_at" text,
  "last_attempt_id" text,
  "last_probe_evidence_id" text,
  "probe_lease_token" text,
  "probe_lease_owner" text,
  "probe_lease_expires_at" text,
  "last_probe_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "provider_health_states_scope_check" CHECK ("scope_kind" IN ('provider', 'entry')),
  CONSTRAINT "provider_health_states_state_check" CHECK ("state" IN ('closed', 'open', 'probing')),
  CONSTRAINT "provider_health_states_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('authentication', 'configuration', 'service_error', 'transport_timeout', 'transport_error')),
  CONSTRAINT "provider_health_states_counts_check" CHECK ("revision" > 0 AND "consecutive_failure_count" >= 0),
  CONSTRAINT "provider_health_states_scope_shape_check" CHECK (
    ("scope_kind" = 'provider' AND "catalog_id" IS NULL)
    OR ("scope_kind" = 'entry' AND "catalog_id" IS NOT NULL)
  ),
  CONSTRAINT "provider_health_states_probe_shape_check" CHECK (
    (
      "state" = 'probing'
      AND "probe_lease_token" IS NOT NULL
      AND "probe_lease_owner" IS NOT NULL
      AND "probe_lease_expires_at" IS NOT NULL
    ) OR (
      "state" <> 'probing'
      AND "probe_lease_token" IS NULL
      AND "probe_lease_owner" IS NULL
      AND "probe_lease_expires_at" IS NULL
    )
  )
);
--> statement-breakpoint
ALTER TABLE "provider_health_states" ADD CONSTRAINT "provider_health_states_last_attempt_id_provider_call_attempts_id_fk" FOREIGN KEY ("last_attempt_id") REFERENCES "public"."provider_call_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "provider_health_states_provider_idx" ON "provider_health_states" USING btree ("provider_profile_id", "state");
--> statement-breakpoint
CREATE INDEX "provider_health_states_catalog_idx" ON "provider_health_states" USING btree ("catalog_id", "state");
--> statement-breakpoint
CREATE TABLE "provider_health_probe_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "scope_key" text NOT NULL,
  "lease_revision" integer NOT NULL,
  "record_sha256" text NOT NULL,
  "record" jsonb NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "provider_health_probe_evidence_revision_check" CHECK ("lease_revision" > 0),
  CONSTRAINT "provider_health_probe_evidence_hash_check" CHECK ("record_sha256" LIKE 'sha256:%')
);
--> statement-breakpoint
ALTER TABLE "provider_health_probe_evidence" ADD CONSTRAINT "provider_health_probe_evidence_scope_fk" FOREIGN KEY ("scope_key") REFERENCES "public"."provider_health_states"("scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_health_probe_evidence_scope_revision_idx" ON "provider_health_probe_evidence" USING btree ("scope_key", "lease_revision");
--> statement-breakpoint
CREATE TABLE "provider_health_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_key" text NOT NULL,
  "event_kind" text NOT NULL,
  "from_state" text,
  "to_state" text NOT NULL,
  "reason" text,
  "revision" integer NOT NULL,
  "attempt_id" text,
  "actor" text,
  "safe_metadata" jsonb,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "provider_health_events_kind_check" CHECK ("event_kind" IN ('failure_recorded', 'success_recorded', 'opened', 'probe_started', 'probe_expired', 'probe_succeeded', 'probe_failed')),
  CONSTRAINT "provider_health_events_state_check" CHECK (("from_state" IS NULL OR "from_state" IN ('closed', 'open', 'probing')) AND "to_state" IN ('closed', 'open', 'probing')),
  CONSTRAINT "provider_health_events_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('authentication', 'configuration', 'service_error', 'transport_timeout', 'transport_error')),
  CONSTRAINT "provider_health_events_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "provider_health_events" ADD CONSTRAINT "provider_health_events_scope_key_provider_health_states_scope_key_fk" FOREIGN KEY ("scope_key") REFERENCES "public"."provider_health_states"("scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "provider_health_events" ADD CONSTRAINT "provider_health_events_attempt_id_provider_call_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."provider_call_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "provider_health_events_scope_idx" ON "provider_health_events" USING btree ("scope_key", "created_at");
