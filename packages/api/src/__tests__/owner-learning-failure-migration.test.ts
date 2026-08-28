import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";

const FAILURE_EVIDENCE_MIGRATION = new URL(
  "../../drizzle/0064_owner_learning_failure_evidence.sql",
  import.meta.url,
);
const ATTEMPT_PROTOCOL_MIGRATION = new URL(
  "../../drizzle/0065_owner_learning_attempt_protocol.sql",
  import.meta.url,
);
const CALL_EVIDENCE_STAGING_MIGRATION = new URL(
  "../../drizzle/0066_owner_learning_call_evidence_staging.sql",
  import.meta.url,
);
const RESPONSE_EVIDENCE_INVARIANT_MIGRATION = new URL(
  "../../drizzle/0067_owner_learning_response_evidence_invariant.sql",
  import.meta.url,
);
const RETRY_QUEUE_FENCE_MIGRATION = new URL(
  "../../drizzle/0068_owner_learning_retry_queue_fence.sql",
  import.meta.url,
);
const FAILURE_COMMIT_INVARIANT_MIGRATION = new URL(
  "../../drizzle/0069_owner_learning_failure_commit_invariant.sql",
  import.meta.url,
);

test("owner learning failure migrations preserve legacy facts and add honest recovery", async () => {
  const db = await setupTestDB();
  const testSchema = `owner_learning_failure_${randomUUID().replaceAll("-", "")}`;
  await createLegacyFixture(db, testSchema);

  try {
    await applyScopedMigration(db, testSchema, FAILURE_EVIDENCE_MIGRATION);
    await applyScopedMigration(db, testSchema, ATTEMPT_PROTOCOL_MIGRATION);
    await applyScopedMigration(db, testSchema, CALL_EVIDENCE_STAGING_MIGRATION);
    await applyScopedMigration(db, testSchema, RESPONSE_EVIDENCE_INVARIANT_MIGRATION);
    await applyScopedMigration(db, testSchema, RETRY_QUEUE_FENCE_MIGRATION);
    await applyScopedMigration(db, testSchema, FAILURE_COMMIT_INVARIANT_MIGRATION);

    const review = (await db.execute<{
      safe_failure_code: string;
      retryable: boolean;
      owner_retry_count: number;
      strategy_style: string | null;
      strategy_instructions: string;
    }>(sql.raw(`
      SELECT
        review.safe_failure_code,
        review.retryable,
        review.owner_retry_count,
        revision.behavior_snapshot ->> 'strategyStyle' AS strategy_style,
        revision.behavior_snapshot ->> 'strategyInstructions' AS strategy_instructions
      FROM "${testSchema}".agent_learning_reviews review
      JOIN "${testSchema}".agent_revisions revision
        ON revision.id = review.reviewed_revision_id
      WHERE review.id = 'legacy-review'
    `)))[0];
    expect(review).toEqual({
      safe_failure_code: "invalid_structured_output",
      retryable: true,
      owner_retry_count: 0,
      strategy_style: null,
      strategy_instructions: "Keep exact legacy strategy guidance.",
    });
    const terminalProvider = (await db.execute<{ retryable: boolean }>(sql.raw(`
      SELECT retryable
      FROM "${testSchema}".agent_learning_reviews
      WHERE id = 'legacy-provider-terminal'
    `)))[0];
    expect(terminalProvider?.retryable).toBe(false);
    const incoherent = (await db.execute<{ retryable: boolean }>(sql.raw(`
      SELECT retryable
      FROM "${testSchema}".agent_learning_reviews
      WHERE id = 'legacy-incoherent'
    `)))[0];
    expect(incoherent?.retryable).toBe(false);
    const incompatible = (await db.execute<{ retryable: boolean }>(sql.raw(`
      SELECT retryable
      FROM "${testSchema}".agent_learning_reviews
      WHERE id = 'legacy-version-incompatible'
    `)))[0];
    expect(incompatible?.retryable).toBe(false);

    const call = (await db.execute<{
      attempt_ordinal: number;
      retry_of_attempt_id: string | null;
      provider_turn_protocol: string;
      evidence_state: string;
      failure_diagnostic_id: string;
      final_provider_request_id: string;
      token_receipt: { inputTokens: number; totalOutputTokens: number };
      cost_source: string;
      estimated_cost_microusd: string;
    }>(sql.raw(`
      SELECT
        attempt_ordinal,
        retry_of_attempt_id,
        provider_turn_protocol,
        evidence_state,
        failure_diagnostic_id,
        final_provider_request_id,
        token_receipt,
        cost_source,
        estimated_cost_microusd::text
      FROM "${testSchema}".agent_learning_review_calls
      WHERE id = 'legacy-call'
    `)))[0];
    expect(call).toMatchObject({
      attempt_ordinal: 1,
      retry_of_attempt_id: null,
      provider_turn_protocol: "owner-learning-harness-v2",
      evidence_state: "legacy_unavailable",
      final_provider_request_id: "legacy-provider-request",
      token_receipt: { inputTokens: 321, totalOutputTokens: 45 },
      cost_source: "estimated",
      estimated_cost_microusd: "678",
    });
    expect(call?.failure_diagnostic_id).toStartWith("legacy-owner-learning:");

    const diagnostic = (await db.execute<{
      id: string;
      phase: string | null;
      safe_failure_code: string;
      error_class: string;
      error_code: string;
      provider_request_id: string;
      state: string;
      legacy_uncaptured: boolean;
    }>(sql.raw(`
      SELECT
        diagnostic.id,
        diagnostic.phase,
        diagnostic.safe_failure_code,
        diagnostic.error_class,
        diagnostic.error_code,
        diagnostic.provider_request_id,
        manifest.state,
        (manifest.metadata ->> 'legacyUncaptured')::boolean AS legacy_uncaptured
      FROM "${testSchema}".agent_learning_review_failure_diagnostics diagnostic
      JOIN "${testSchema}".agent_learning_review_failure_manifests manifest
        ON manifest.diagnostic_id = diagnostic.id
      WHERE diagnostic.review_id = 'legacy-review'
    `)))[0];
    expect(diagnostic).toMatchObject({
      id: call?.failure_diagnostic_id,
      phase: null,
      safe_failure_code: "invalid_structured_output",
      error_class: "LegacyUncapturedFailure",
      error_code: "legacy_uncaptured",
      provider_request_id: "legacy-provider-request",
      state: "legacy_unavailable",
      legacy_uncaptured: true,
    });

    const indexes = await db.execute<{ indexdef: string }>(sql.raw(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = '${testSchema}'
        AND indexname = 'agent_learning_review_calls_ordinal_unique'
    `));
    expect(indexes[0]?.indexdef.replaceAll('"', "")).toContain(
      "(review_id, ordinal, attempt_ordinal)",
    );

    await expect((async () => {
      await db.execute(sql.raw(`
        UPDATE "${testSchema}".agent_learning_review_failure_diagnostics
        SET sanitized_message = 'rewritten'
        WHERE review_id = 'legacy-review'
      `));
    })()).rejects.toThrow();
    await expect((async () => {
      await db.execute(sql.raw(`
        DELETE FROM "${testSchema}".agent_learning_reviews
        WHERE id = 'legacy-review'
      `));
    })()).rejects.toThrow();

    await expect(db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${testSchema}"`));
      await tx.execute(sql.raw(`
        INSERT INTO agent_learning_review_failure_diagnostics (
          id, review_id, phase, safe_failure_code, error_class, error_code,
          sanitized_message, fingerprint, evidence_manifest_id, occurred_at
        ) VALUES (
          'invalid-without-receipt', 'legacy-provider-terminal', 'output_validation',
          'invalid_structured_output', 'ValidationError', 'invalid_turn_contract',
          'missing response receipt',
          'sha256:missing-response-receipt',
          'owner-learning-failure:invalid-without-receipt',
          '2026-08-27T20:06:00.000Z'
        )
      `));
    })).rejects.toThrow();

    await expect(db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${testSchema}"`));
      await tx.execute(sql.raw(`
        INSERT INTO agent_learning_review_calls (
          id, review_id, ordinal, attempt_ordinal, state, stage,
          input_policy_hash, provider_response_observed_at,
          provider_response_sha256, safe_failure_code, reserved_at, completed_at
        ) VALUES (
          'receipt-without-body', 'legacy-provider-terminal', 1, 1, 'failed',
          'drafting_recommendations', 'sha256:staged-missing-body',
          '2026-08-27T20:06:00.000Z', 'sha256:raw-response', 'invalid_turn_contract',
          '2026-08-27T20:05:00.000Z', '2026-08-27T20:06:00.000Z'
        );
        INSERT INTO agent_learning_review_failure_diagnostics (
          id, review_id, call_id, call_ordinal, attempt_ordinal, phase,
          safe_failure_code, error_class, error_code, sanitized_message,
          fingerprint, evidence_manifest_id, occurred_at
        ) VALUES (
          'diagnostic-without-body', 'legacy-provider-terminal', 'receipt-without-body',
          1, 1, 'output_validation', 'invalid_structured_output',
          'OwnerLearningOutputValidationError', 'invalid_turn_contract',
          'response body was not staged', 'sha256:missing-staged-body',
          'owner-learning-failure:diagnostic-without-body',
          '2026-08-27T20:06:00.000Z'
        );
        INSERT INTO agent_learning_review_failure_manifests (
          id, diagnostic_id, review_id, state, source_pointers, metadata
        ) VALUES (
          'owner-learning-failure:diagnostic-without-body',
          'diagnostic-without-body', 'legacy-provider-terminal', 'pending',
          '[]'::jsonb, '{}'::jsonb
        );
        UPDATE agent_learning_review_calls
        SET failure_diagnostic_id = 'diagnostic-without-body', evidence_state = 'pending'
        WHERE id = 'receipt-without-body';
      `));
    })).rejects.toThrow();

    await expect(db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${testSchema}"`));
      await tx.execute(sql.raw(`
        INSERT INTO agent_learning_reviews (
          id, owner_user_id, agent_profile_id, reviewed_revision_id,
          analysis_status, retryable, logical_call_count, dive_count,
          created_at, updated_at
        ) VALUES (
          'mixed-version-review', 'legacy-owner', 'legacy-profile', 'legacy-revision',
          'queued', false, 1, 0,
          '2026-08-27T20:10:00.000Z', '2026-08-27T20:10:00.000Z'
        );
        INSERT INTO agent_learning_review_calls (
          id, review_id, ordinal, state, final_provider_request_id,
          cost_source, completed_at, reserved_at
        ) VALUES (
          'mixed-version-call', 'mixed-version-review', 1, 'failed',
          'mixed-version-provider-request', 'unavailable',
          '2026-08-27T20:11:00.000Z', '2026-08-27T20:10:30.000Z'
        );
        UPDATE agent_learning_reviews
        SET analysis_status = 'failed', safe_failure_code = 'provider_error', retryable = true,
            completed_at = '2026-08-27T20:11:00.000Z', updated_at = '2026-08-27T20:11:00.000Z'
        WHERE id = 'mixed-version-review';
      `));
    })).rejects.toThrow("matching diagnostic");
    expect((await db.execute<{ analysis_status: string }>(sql.raw(`
      SELECT analysis_status
      FROM "${testSchema}".agent_learning_reviews
      WHERE id = 'mixed-version-review'
    `)))[0]).toBeUndefined();
  } finally {
    await db.execute(sql.raw(`DROP SCHEMA "${testSchema}" CASCADE`));
  }
});

async function createLegacyFixture(db: DrizzleDB, testSchema: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE SCHEMA "${testSchema}";
    CREATE TABLE "${testSchema}".users (
      id text PRIMARY KEY
    );
    CREATE TABLE "${testSchema}".agent_revisions (
      id text PRIMARY KEY,
      ordinal integer NOT NULL,
      behavior_snapshot jsonb NOT NULL
    );
    CREATE TABLE "${testSchema}".agent_profiles (
      id text PRIMARY KEY,
      current_revision_id text NOT NULL
    );
    CREATE TABLE "${testSchema}".agent_learning_reviews (
      id text PRIMARY KEY,
      owner_user_id text NOT NULL,
      agent_profile_id text NOT NULL,
      reviewed_revision_id text NOT NULL,
      analysis_status text NOT NULL,
      resolution text,
      resolved_at text,
      safe_failure_code text,
      retryable boolean DEFAULT false NOT NULL,
      checkpoint jsonb,
      logical_call_count integer DEFAULT 0 NOT NULL,
      dive_count integer DEFAULT 0 NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      completed_at text,
      eligibility_policy_version text DEFAULT 'owner-learning-eligibility-v2' NOT NULL,
      evidence_version text DEFAULT 'owner-learning-evidence-v2' NOT NULL,
      reviewer_version text DEFAULT 'owner-learning-reviewer-v1' NOT NULL,
      prompt_version text DEFAULT 'owner-learning-prompt-v2' NOT NULL,
      schema_version text DEFAULT 'owner-learning-result-v2' NOT NULL,
      provider_policy_version text DEFAULT 'owner-learning-luna-flex-v3' NOT NULL,
      selected_model text DEFAULT 'openai:gpt-5.6-luna' NOT NULL,
      CONSTRAINT agent_learning_reviews_analysis_status_check CHECK (
        analysis_status IN ('queued', 'running', 'ready', 'no_change', 'failed')
      ),
      CONSTRAINT agent_learning_reviews_failure_check CHECK (
        safe_failure_code IS NULL OR safe_failure_code IN (
          'provider_capacity_exhausted', 'provider_timeout', 'provider_error',
          'invalid_structured_output', 'tier_mismatch', 'output_budget_exhausted',
          'logical_call_budget_exhausted', 'evidence_unavailable', 'worker_interrupted'
        )
      )
    );
    CREATE TABLE "${testSchema}".agent_learning_review_calls (
      id text PRIMARY KEY,
      review_id text NOT NULL,
      ordinal integer NOT NULL,
      state text NOT NULL,
      final_provider_request_id text,
      token_receipt jsonb,
      cost_source text DEFAULT 'unavailable' NOT NULL,
      actual_cost_microusd bigint,
      estimated_cost_microusd bigint,
      completed_at text,
      reserved_at text NOT NULL
    );
    CREATE UNIQUE INDEX agent_learning_review_calls_ordinal_unique
      ON "${testSchema}".agent_learning_review_calls (review_id, ordinal);
    CREATE TABLE "${testSchema}".agent_learning_events (
      id text PRIMARY KEY,
      review_id text,
      kind text NOT NULL,
      payload jsonb NOT NULL,
      occurred_at text NOT NULL
    );

    INSERT INTO "${testSchema}".users (id) VALUES ('legacy-owner');
    INSERT INTO "${testSchema}".agent_revisions (id, ordinal, behavior_snapshot)
      VALUES (
        'legacy-revision',
        7,
        '{"strategyInstructions":"Keep exact legacy strategy guidance."}'::jsonb
      );
    INSERT INTO "${testSchema}".agent_profiles (id, current_revision_id)
      VALUES ('legacy-profile', 'legacy-revision');
    INSERT INTO "${testSchema}".agent_learning_reviews (
      id, owner_user_id, agent_profile_id, reviewed_revision_id,
      analysis_status, safe_failure_code, retryable, checkpoint,
      logical_call_count, dive_count, created_at, updated_at, completed_at
    ) VALUES (
      'legacy-review',
      'legacy-owner',
      'legacy-profile',
      'legacy-revision',
      'failed',
      'invalid_structured_output',
      false,
      '{
        "version":1,
        "logicalCallCount":4,
        "diveCount":2,
        "selectedMomentIds":[],
        "nextMomentCursor":0,
        "provisionalThemes":[],
        "validatedFindings":[],
        "lastCompletedStage":"investigating_moments",
        "promptHash":"sha256:a6c1a175e2ff65eacb5c8cf1211116c202ba519ec6f3fb5a5eda120da81aea52",
        "schemaHash":"sha256:6d4c4ac42856f496b961b335d68fe361b81786dea5bb5b6d0006be0c590721a6",
        "completion":null
      }'::jsonb,
      4,
      2,
      '2026-08-27T20:00:00.000Z',
      '2026-08-27T20:05:00.000Z',
      '2026-08-27T20:05:00.000Z'
    );
    INSERT INTO "${testSchema}".agent_learning_reviews (
      id, owner_user_id, agent_profile_id, reviewed_revision_id,
      analysis_status, safe_failure_code, retryable, checkpoint,
      logical_call_count, dive_count, created_at, updated_at, completed_at
    ) VALUES
    (
      'legacy-provider-terminal', 'legacy-owner', 'legacy-profile', 'legacy-revision',
      'failed', 'provider_error', false, NULL, 1, 0,
      '2026-08-27T20:00:00.000Z', '2026-08-27T20:05:00.000Z', '2026-08-27T20:05:00.000Z'
    ),
    (
      'legacy-incoherent', 'legacy-owner', 'legacy-profile', 'legacy-revision',
      'failed', 'invalid_structured_output', false,
      '{"version":1,"logicalCallCount":1,"diveCount":0,"completion":null}'::jsonb,
      1, 0,
      '2026-08-27T20:00:00.000Z', '2026-08-27T20:05:00.000Z', '2026-08-27T20:05:00.000Z'
    ),
    (
      'legacy-version-incompatible', 'legacy-owner', 'legacy-profile', 'legacy-revision',
      'failed', 'invalid_structured_output', false, NULL, 1, 0,
      '2026-08-27T20:00:00.000Z', '2026-08-27T20:05:00.000Z', '2026-08-27T20:05:00.000Z'
    );
    UPDATE "${testSchema}".agent_learning_reviews
    SET prompt_version = 'owner-learning-prompt-v1'
    WHERE id = 'legacy-version-incompatible';
    INSERT INTO "${testSchema}".agent_learning_review_calls (
      id, review_id, ordinal, state, final_provider_request_id,
      token_receipt, cost_source, estimated_cost_microusd,
      completed_at, reserved_at
    ) VALUES (
      'legacy-call',
      'legacy-review',
      4,
      'failed',
      'legacy-provider-request',
      '{"inputTokens":321,"totalOutputTokens":45}'::jsonb,
      'estimated',
      678,
      '2026-08-27T20:05:00.000Z',
      '2026-08-27T20:04:00.000Z'
    );
  `));
}

async function applyScopedMigration(
  db: DrizzleDB,
  testSchema: string,
  migrationPath: URL,
): Promise<void> {
  const migration = (await Bun.file(migrationPath).text()).replaceAll(
    '"public".',
    `"${testSchema}".`,
  );
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${testSchema}"`));
    for (const statement of statements) await tx.execute(sql.raw(statement));
  });
}
