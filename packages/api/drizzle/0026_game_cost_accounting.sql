CREATE TABLE IF NOT EXISTS "game_provider_spend_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id"),
  "owner_epoch" text REFERENCES "game_run_owners"("owner_epoch"),
  "event_sequence" integer,
  "source_key" text NOT NULL,
  "capture_source" text NOT NULL,
  "cost_source" text NOT NULL DEFAULT 'unavailable',
  "call_status" text NOT NULL DEFAULT 'unknown',
  "call_id" text,
  "attempt_ordinal" integer NOT NULL DEFAULT 1,
  "retry_parent_source_key" text,
  "provider_response_id" text,
  "trace_manifest_id" text REFERENCES "game_evidence_manifests"("id"),
  "actor_id" text,
  "actor_name" text,
  "actor_role" text,
  "action" text,
  "phase" text,
  "round" integer,
  "provider" text,
  "provider_profile_id" text,
  "catalog_id" text,
  "model_name" text,
  "api_surface" text,
  "reasoning_policy" text,
  "requested_reasoning_effort" text,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "cached_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "reasoning_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "actual_cost_microusd" bigint,
  "estimated_cost_microusd" bigint,
  "cost_currency" text NOT NULL DEFAULT 'USD',
  "provider_native_unit" text,
  "provider_native_amount" text,
  "pricing_source_id" text,
  "rate_card_version" text,
  "priced_at" text,
  "latency_ms" integer,
  "router_billing" jsonb,
  "diagnostics" jsonb,
  "safe_metadata" jsonb,
  "observed_at" text NOT NULL DEFAULT now()::text,
  "created_at" text NOT NULL DEFAULT now()::text,
  "updated_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "game_provider_spend_entries_capture_source_check"
    CHECK ("capture_source" IN ('live_trace', 'trace_manifest_backfill', 'terminal_result_backfill', 'manual_adjustment')),
  CONSTRAINT "game_provider_spend_entries_cost_source_check"
    CHECK ("cost_source" IN ('provider_actual', 'router_actual', 'org_reconciled', 'catalog_estimate', 'static_estimate', 'unavailable')),
  CONSTRAINT "game_provider_spend_entries_call_status_check"
    CHECK ("call_status" IN ('succeeded', 'failed', 'unknown')),
  CONSTRAINT "game_provider_spend_entries_attempt_check"
    CHECK ("attempt_ordinal" > 0),
  CONSTRAINT "game_provider_spend_entries_event_sequence_check"
    CHECK ("event_sequence" IS NULL OR "event_sequence" > 0),
  CONSTRAINT "game_provider_spend_entries_round_check"
    CHECK ("round" IS NULL OR "round" >= 0),
  CONSTRAINT "game_provider_spend_entries_token_counts_check"
    CHECK (
      "prompt_tokens" >= 0
      AND "cached_tokens" >= 0
      AND "completion_tokens" >= 0
      AND "reasoning_tokens" >= 0
      AND "total_tokens" >= 0
    ),
  CONSTRAINT "game_provider_spend_entries_cost_counts_check"
    CHECK (
      ("actual_cost_microusd" IS NULL OR "actual_cost_microusd" >= 0)
      AND ("estimated_cost_microusd" IS NULL OR "estimated_cost_microusd" >= 0)
      AND ("latency_ms" IS NULL OR "latency_ms" >= 0)
    ),
  CONSTRAINT "game_provider_spend_entries_game_owner_fk"
    FOREIGN KEY ("game_id", "owner_epoch")
    REFERENCES "game_run_owners"("game_id", "owner_epoch"),
  CONSTRAINT "game_provider_spend_entries_event_boundary_fk"
    FOREIGN KEY ("game_id", "event_sequence")
    REFERENCES "game_events"("game_id", "sequence")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_provider_spend_entries_source_key_unique"
  ON "game_provider_spend_entries" USING btree ("source_key");

CREATE UNIQUE INDEX IF NOT EXISTS "game_provider_spend_entries_trace_manifest_unique"
  ON "game_provider_spend_entries" USING btree ("trace_manifest_id")
  WHERE "trace_manifest_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "game_provider_spend_entries_game_id_idx"
  ON "game_provider_spend_entries" USING btree ("game_id", "created_at");

CREATE INDEX IF NOT EXISTS "game_provider_spend_entries_owner_epoch_idx"
  ON "game_provider_spend_entries" USING btree ("owner_epoch");

CREATE INDEX IF NOT EXISTS "game_provider_spend_entries_trace_manifest_idx"
  ON "game_provider_spend_entries" USING btree ("trace_manifest_id");

CREATE INDEX IF NOT EXISTS "game_provider_spend_entries_cost_source_idx"
  ON "game_provider_spend_entries" USING btree ("cost_source");

CREATE INDEX IF NOT EXISTS "game_provider_spend_entries_capture_source_idx"
  ON "game_provider_spend_entries" USING btree ("capture_source");

CREATE TABLE IF NOT EXISTS "game_cost_rollups" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id"),
  "owner_epoch" text REFERENCES "game_run_owners"("owner_epoch"),
  "rollup_scope" text NOT NULL,
  "call_count" integer NOT NULL DEFAULT 0,
  "failed_call_count" integer NOT NULL DEFAULT 0,
  "unpriced_call_count" integer NOT NULL DEFAULT 0,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "cached_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "reasoning_tokens" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "actual_cost_microusd" bigint NOT NULL DEFAULT 0,
  "estimated_cost_microusd" bigint NOT NULL DEFAULT 0,
  "provider_native_totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "breakdowns" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cost_source_counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "capture_source_counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "first_entry_at" text,
  "last_entry_at" text,
  "rebuilt_at" text NOT NULL DEFAULT now()::text,
  "created_at" text NOT NULL DEFAULT now()::text,
  "updated_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "game_cost_rollups_game_owner_fk"
    FOREIGN KEY ("game_id", "owner_epoch")
    REFERENCES "game_run_owners"("game_id", "owner_epoch"),
  CONSTRAINT "game_cost_rollups_scope_check"
    CHECK ("rollup_scope" IN ('game', 'owner_epoch')),
  CONSTRAINT "game_cost_rollups_scope_owner_check"
    CHECK (
      ("rollup_scope" = 'game' AND "owner_epoch" IS NULL)
      OR ("rollup_scope" = 'owner_epoch' AND "owner_epoch" IS NOT NULL)
    ),
  CONSTRAINT "game_cost_rollups_counts_check"
    CHECK (
      "call_count" >= 0
      AND "failed_call_count" >= 0
      AND "unpriced_call_count" >= 0
      AND "prompt_tokens" >= 0
      AND "cached_tokens" >= 0
      AND "completion_tokens" >= 0
      AND "reasoning_tokens" >= 0
      AND "total_tokens" >= 0
      AND "actual_cost_microusd" >= 0
      AND "estimated_cost_microusd" >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_cost_rollups_game_scope_unique"
  ON "game_cost_rollups" USING btree ("game_id", "rollup_scope", "owner_epoch");

CREATE UNIQUE INDEX IF NOT EXISTS "game_cost_rollups_game_total_unique"
  ON "game_cost_rollups" USING btree ("game_id")
  WHERE "rollup_scope" = 'game';

CREATE INDEX IF NOT EXISTS "game_cost_rollups_game_id_idx"
  ON "game_cost_rollups" USING btree ("game_id");

CREATE INDEX IF NOT EXISTS "game_cost_rollups_owner_epoch_idx"
  ON "game_cost_rollups" USING btree ("owner_epoch");

CREATE TABLE IF NOT EXISTS "game_cost_reconciliations" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id"),
  "provider" text,
  "status" text NOT NULL,
  "reconciliation_source" text NOT NULL,
  "report_hash" text,
  "internal_actual_cost_microusd" bigint NOT NULL DEFAULT 0,
  "internal_estimated_cost_microusd" bigint NOT NULL DEFAULT 0,
  "provider_actual_cost_microusd" bigint,
  "delta_microusd" bigint,
  "cost_currency" text NOT NULL DEFAULT 'USD',
  "normalized_deltas" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "diagnostics" jsonb,
  "created_by_user_id" text REFERENCES "users"("id"),
  "reconciled_at" text NOT NULL DEFAULT now()::text,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "game_cost_reconciliations_status_check"
    CHECK ("status" IN ('matched', 'partial', 'unavailable')),
  CONSTRAINT "game_cost_reconciliations_costs_check"
    CHECK (
      "internal_actual_cost_microusd" >= 0
      AND "internal_estimated_cost_microusd" >= 0
      AND ("provider_actual_cost_microusd" IS NULL OR "provider_actual_cost_microusd" >= 0)
    )
);

CREATE INDEX IF NOT EXISTS "game_cost_reconciliations_game_id_idx"
  ON "game_cost_reconciliations" USING btree ("game_id", "created_at");

CREATE TABLE IF NOT EXISTS "game_cost_accounting_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text REFERENCES "games"("id"),
  "actor_user_id" text REFERENCES "users"("id"),
  "action" text NOT NULL,
  "outcome" text NOT NULL,
  "safe_metadata" jsonb,
  "created_at" text NOT NULL DEFAULT now()::text,
  CONSTRAINT "game_cost_accounting_audit_action_check"
    CHECK ("action" IN ('backfill_game', 'rebuild_rollup', 'record_reconciliation')),
  CONSTRAINT "game_cost_accounting_audit_outcome_check"
    CHECK ("outcome" IN ('succeeded', 'failed', 'denied'))
);

CREATE INDEX IF NOT EXISTS "game_cost_accounting_audit_game_id_idx"
  ON "game_cost_accounting_audit_events" USING btree ("game_id", "created_at");

CREATE INDEX IF NOT EXISTS "game_cost_accounting_audit_actor_idx"
  ON "game_cost_accounting_audit_events" USING btree ("actor_user_id", "created_at");

INSERT INTO "permissions" ("id", "name", "description")
VALUES ('perm_manage_cost_accounting', 'manage_cost_accounting', 'Backfill, rebuild, and reconcile admin game cost accounting')
ON CONFLICT ("name") DO UPDATE
SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles", "permissions"
WHERE "roles"."name" = 'sysop'
  AND "permissions"."name" = 'manage_cost_accounting'
ON CONFLICT DO NOTHING;
