CREATE TABLE "game_run_owners" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"run_source" text DEFAULT 'api' NOT NULL,
	"process_id" text,
	"acquired_at" text DEFAULT now()::text NOT NULL,
	"heartbeat_at" text DEFAULT now()::text NOT NULL,
	"expires_at" text,
	"closed_at" text,
	"revoked_at" text,
	"last_persisted_event_sequence" integer DEFAULT 0 NOT NULL,
	"kernel_health" text DEFAULT 'healthy' NOT NULL,
	"failure_reason" text,
	"failure_details" jsonb,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_run_owners_owner_epoch_unique" UNIQUE("owner_epoch"),
	CONSTRAINT "game_run_owners_game_owner_epoch_unique" UNIQUE("game_id","owner_epoch"),
	CONSTRAINT "game_run_owners_status_check" CHECK ("status" IN ('active', 'closed', 'revoked', 'expired')),
	CONSTRAINT "game_run_owners_run_source_check" CHECK ("run_source" IN ('api', 'simulation_import')),
	CONSTRAINT "game_run_owners_kernel_health_check" CHECK ("kernel_health" IN ('healthy', 'degraded', 'suspended')),
	CONSTRAINT "game_run_owners_last_persisted_event_sequence_check" CHECK ("last_persisted_event_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_hash" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"visibility" text NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"run_source" text DEFAULT 'api' NOT NULL,
	"source_pointers" jsonb,
	"envelope" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_events_game_id_sequence_unique" UNIQUE("game_id","sequence"),
	CONSTRAINT "game_events_sequence_positive_check" CHECK ("sequence" > 0),
	CONSTRAINT "game_events_visibility_check" CHECK ("visibility" IN ('public', 'player', 'producer', 'system')),
	CONSTRAINT "game_events_run_source_check" CHECK ("run_source" IN ('api', 'simulation_import')),
	CONSTRAINT "game_events_envelope_game_id_check" CHECK ("envelope" ? 'gameId' AND ("envelope"->>'gameId') = "game_id"),
	CONSTRAINT "game_events_envelope_sequence_check" CHECK ("envelope" ? 'sequence' AND (("envelope"->>'sequence')::integer) = "sequence"),
	CONSTRAINT "game_events_envelope_type_check" CHECK ("envelope" ? 'type' AND ("envelope"->>'type') = "event_type"),
	CONSTRAINT "game_events_envelope_payload_version_check" CHECK ("envelope" ? 'payloadVersion' AND (("envelope"->>'payloadVersion')::integer) = "payload_version")
);
--> statement-breakpoint
CREATE TABLE "game_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"last_event_sequence" integer NOT NULL,
	"checkpoint_kind" text DEFAULT 'phase_boundary' NOT NULL,
	"phase" text,
	"round" integer,
	"event_head_hash" text NOT NULL,
	"projection_hash" text NOT NULL,
	"hydrateable" boolean DEFAULT false NOT NULL,
	"hydration_status" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"transcript_cursor" jsonb,
	"token_cost_cursor" jsonb,
	"degraded_reason" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_checkpoints_boundary_unique" UNIQUE("game_id","last_event_sequence","checkpoint_kind"),
	CONSTRAINT "game_checkpoints_checkpoint_kind_check" CHECK ("checkpoint_kind" IN ('initial', 'phase_boundary', 'terminal')),
	CONSTRAINT "game_checkpoints_last_event_sequence_check" CHECK ("last_event_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_evidence_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"owner_epoch" text NOT NULL,
	"event_sequence" integer,
	"evidence_type" text NOT NULL,
	"retention_class" text DEFAULT 'debug' NOT NULL,
	"access_scope" text DEFAULT 'producer_admin' NOT NULL,
	"redaction_status" text DEFAULT 'active' NOT NULL,
	"expires_at" text,
	"redacted_at" text,
	"storage_provider" text,
	"storage_bucket" text,
	"storage_key" text,
	"source_pointers" jsonb,
	"metadata" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_evidence_manifests_retention_class_check" CHECK ("retention_class" IN ('debug', 'audit', 'legal_hold')),
	CONSTRAINT "game_evidence_manifests_access_scope_check" CHECK ("access_scope" IN ('producer_admin')),
	CONSTRAINT "game_evidence_manifests_redaction_status_check" CHECK ("redaction_status" IN ('active', 'expired', 'redacted')),
	CONSTRAINT "game_evidence_manifests_event_sequence_check" CHECK ("event_sequence" IS NULL OR "event_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "game_evidence_manifest_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"manifest_id" text NOT NULL,
	"game_id" text NOT NULL,
	"accessor_user_id" text,
	"accessor_role" text,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"read_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "game_evidence_manifest_reads_outcome_check" CHECK ("outcome" IN ('allowed', 'denied', 'expired', 'redacted'))
);
--> statement-breakpoint
ALTER TABLE "game_run_owners" ADD CONSTRAINT "game_run_owners_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_owner_epoch_game_run_owners_owner_epoch_fk" FOREIGN KEY ("owner_epoch") REFERENCES "public"."game_run_owners"("owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_checkpoints" ADD CONSTRAINT "game_checkpoints_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_checkpoints" ADD CONSTRAINT "game_checkpoints_owner_epoch_game_run_owners_owner_epoch_fk" FOREIGN KEY ("owner_epoch") REFERENCES "public"."game_run_owners"("owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_checkpoints" ADD CONSTRAINT "game_checkpoints_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_checkpoints" ADD CONSTRAINT "game_checkpoints_event_boundary_fk" FOREIGN KEY ("game_id","last_event_sequence") REFERENCES "public"."game_events"("game_id","sequence") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ADD CONSTRAINT "game_evidence_manifests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ADD CONSTRAINT "game_evidence_owner_epoch_fk" FOREIGN KEY ("owner_epoch") REFERENCES "public"."game_run_owners"("owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ADD CONSTRAINT "game_evidence_manifests_game_owner_fk" FOREIGN KEY ("game_id","owner_epoch") REFERENCES "public"."game_run_owners"("game_id","owner_epoch") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifests" ADD CONSTRAINT "game_evidence_manifests_event_boundary_fk" FOREIGN KEY ("game_id","event_sequence") REFERENCES "public"."game_events"("game_id","sequence") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifest_reads" ADD CONSTRAINT "evidence_reads_manifest_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."game_evidence_manifests"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifest_reads" ADD CONSTRAINT "game_evidence_manifest_reads_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_evidence_manifest_reads" ADD CONSTRAINT "game_evidence_manifest_reads_accessor_user_id_users_id_fk" FOREIGN KEY ("accessor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "game_run_owners_one_active_per_game" ON "game_run_owners" ("game_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "game_run_owners_game_id_idx" ON "game_run_owners" ("game_id");
--> statement-breakpoint
CREATE INDEX "game_events_game_id_idx" ON "game_events" ("game_id");
--> statement-breakpoint
CREATE INDEX "game_events_event_type_idx" ON "game_events" ("event_type");
--> statement-breakpoint
CREATE INDEX "game_checkpoints_game_id_idx" ON "game_checkpoints" ("game_id");
--> statement-breakpoint
CREATE INDEX "game_evidence_manifests_game_id_idx" ON "game_evidence_manifests" ("game_id");
--> statement-breakpoint
CREATE INDEX "game_evidence_manifests_event_sequence_idx" ON "game_evidence_manifests" ("game_id","event_sequence");
--> statement-breakpoint
CREATE INDEX "game_evidence_manifest_reads_manifest_id_idx" ON "game_evidence_manifest_reads" ("manifest_id");
--> statement-breakpoint
CREATE INDEX "game_evidence_manifest_reads_game_id_idx" ON "game_evidence_manifest_reads" ("game_id");
