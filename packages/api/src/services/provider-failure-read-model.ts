import { eq, sql } from "drizzle-orm";
import { resolveProviderManifestFromGameConfig } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export type ProviderFailureState = "recovered" | "terminal" | "degraded" | "transitioned";

export interface ProviderFailureSummary {
  schemaVersion: 1;
  state: "empty" | ProviderFailureState;
  failureCount: number;
  exactFailureCount: number;
  rateLimitCount: number;
  recoveredCount: number;
  terminalCount: number;
  degradedCount: number;
  transitionedCount: number;
  lastFailureAt: string | null;
}

export interface ProviderFailureAttemptItem {
  kind: "attempt";
  id: string;
  logicalCallId: string;
  occurredAt: string;
  state: ProviderFailureState;
  actorName: string;
  actorRole: string;
  action: string;
  phase: string | null;
  round: number | null;
  providerProfileId: string;
  transport: string;
  modelName: string;
  attemptOrdinal: number;
  outcomeKind: string;
  outcomeMessage: string | null;
  retryable: boolean | null;
  disposition: string | null;
  providerRequestId: string | null;
  evidence: {
    state: "available" | "degraded" | "unavailable";
    manifestId: string | null;
    error: string | null;
  };
}

export interface ProviderFailureRateLimitItem {
  kind: "rate_limit";
  id: string;
  logicalCallId: string;
  occurredAt: string;
  state: Extract<ProviderFailureState, "recovered" | "terminal" | "transitioned" | "degraded">;
  actorName: string;
  actorRole: string;
  action: string;
  phase: string | null;
  round: number | null;
  count: number;
  outcome: "pending" | "recovered" | "exhausted";
  terminalReason: string | null;
}

export type ProviderFailureItem = ProviderFailureAttemptItem | ProviderFailureRateLimitItem;

export interface ProviderFailureBudgetItem {
  catalogId: string;
  providerProfileId: string;
  modelName: string;
  role: "primary" | "fallback";
  usedCalls: number;
  maxCallsPerGame: number | null;
  remainingCalls: number | null;
  state: "unbounded" | "available" | "exhausted";
  cost: {
    state: "no_calls" | "actual" | "estimated" | "unavailable";
    callCount: number;
    actualCostMicrousd: number;
    estimatedCostMicrousd: number;
    unpricedCallCount: number;
  };
}

export interface ProviderFailureDetail {
  schemaVersion: 1;
  gameId: string;
  summary: ProviderFailureSummary;
  budgets: ProviderFailureBudgetItem[];
  failures: ProviderFailureItem[];
  page: ProviderFailurePage;
}

export interface ProviderFailurePage {
  limit: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export const DEFAULT_PROVIDER_FAILURE_PAGE_LIMIT = 100;
export const MAX_PROVIDER_FAILURE_PAGE_LIMIT = 200;

export class InvalidProviderFailureCursorError extends Error {
  constructor() {
    super("Invalid provider failure cursor");
    this.name = "InvalidProviderFailureCursorError";
  }
}

interface ProviderFailureCursor {
  occurredAt: string;
  sortKey: string;
}

interface ProviderFailurePageRow extends Record<string, unknown> {
  kind: "attempt" | "rate_limit";
  id: string;
  sortKey: string;
  logicalCallId: string;
  occurredAt: string;
  state: ProviderFailureState;
  actorName: string | null;
  actorRole: string | null;
  action: string | null;
  phase: string | null;
  round: number | null;
  providerProfileId: string | null;
  transport: string | null;
  modelName: string | null;
  attemptOrdinal: number | null;
  outcomeKind: string | null;
  outcomeMessage: string | null;
  retryable: boolean | null;
  disposition: string | null;
  providerRequestId: string | null;
  evidenceState: string | null;
  evidenceManifestId: string | null;
  evidenceError: string | null;
  rateLimitCount: number | null;
  rateLimitOutcome: string | null;
  rateLimitTerminalReason: string | null;
  hasLogicalCall: boolean;
}

interface ProviderBudgetAggregateRow extends Record<string, unknown> {
  catalogId: string;
  usedCalls: number;
  callCount: number;
  actualSourceCount: number;
  estimatedSourceCount: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  unpricedCallCount: number;
}

export async function getProviderFailureSummaryMap(
  db: Pick<DrizzleDB, "execute">,
  gameIds: readonly string[],
): Promise<Map<string, ProviderFailureSummary>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db.execute<{
    gameId: string;
    exactFailureCount: number;
    rateLimitCount: number;
    recoveredCount: number;
    terminalCount: number;
    degradedCount: number;
    transitionedCount: number;
    lastFailureAt: string | null;
  }>(sql`
    SELECT
      call.game_id AS "gameId",
      COALESCE(sum(attempt.exact_failure_count), 0)::int AS "exactFailureCount",
      COALESCE(sum(call.rate_limit_count), 0)::int AS "rateLimitCount",
      (
        COALESCE(sum(attempt.recovered_count), 0)
        + count(*) FILTER (
          WHERE call.rate_limit_count > 0
            AND call.rate_limit_outcome = 'recovered'
            AND NOT call.diagnostics_degraded
        )
      )::int AS "recoveredCount",
      (
        COALESCE(sum(attempt.terminal_count), 0)
        + count(*) FILTER (
          WHERE call.rate_limit_count > 0
            AND call.rate_limit_outcome = 'exhausted'
        )
      )::int AS "terminalCount",
      (
        COALESCE(sum(attempt.degraded_count), 0)
        + count(*) FILTER (
          WHERE call.rate_limit_count > 0
            AND call.rate_limit_outcome IS DISTINCT FROM 'exhausted'
            AND call.diagnostics_degraded
        )
      )::int AS "degradedCount",
      (
        COALESCE(sum(attempt.transitioned_count), 0)
        + count(*) FILTER (
          WHERE call.rate_limit_count > 0
            AND call.rate_limit_outcome NOT IN ('recovered', 'exhausted')
            AND NOT call.diagnostics_degraded
        )
      )::int AS "transitionedCount",
      max(
        CASE
          WHEN call.rate_limit_count > 0 AND attempt.last_failure_at IS NOT NULL
            THEN greatest(call.updated_at, attempt.last_failure_at)
          WHEN call.rate_limit_count > 0 THEN call.updated_at
          ELSE attempt.last_failure_at
        END
      ) AS "lastFailureAt"
    FROM provider_logical_calls call
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
        )::int AS exact_failure_count,
        count(*) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
            AND NOT (failed.evidence_state = 'degraded' OR call.diagnostics_degraded)
            AND EXISTS (
              SELECT 1
              FROM provider_call_attempts later
              WHERE later.logical_call_id = failed.logical_call_id
                AND later.attempt_ordinal > failed.attempt_ordinal
                AND later.outcome_kind = 'usable'
                AND later.disposition = 'accepted'
            )
        )::int AS recovered_count,
        count(*) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
            AND (failed.evidence_state = 'degraded' OR call.diagnostics_degraded)
        )::int AS degraded_count,
        count(*) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
            AND NOT (failed.evidence_state = 'degraded' OR call.diagnostics_degraded)
            AND NOT EXISTS (
              SELECT 1
              FROM provider_call_attempts later
              WHERE later.logical_call_id = failed.logical_call_id
                AND later.attempt_ordinal > failed.attempt_ordinal
                AND later.outcome_kind = 'usable'
                AND later.disposition = 'accepted'
            )
            AND failed.disposition = 'exhausted'
        )::int AS terminal_count,
        count(*) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
            AND NOT (failed.evidence_state = 'degraded' OR call.diagnostics_degraded)
            AND NOT EXISTS (
              SELECT 1
              FROM provider_call_attempts later
              WHERE later.logical_call_id = failed.logical_call_id
                AND later.attempt_ordinal > failed.attempt_ordinal
                AND later.outcome_kind = 'usable'
                AND later.disposition = 'accepted'
            )
            AND failed.disposition IS DISTINCT FROM 'exhausted'
        )::int AS transitioned_count,
        max(COALESCE(failed.completed_at, failed.started_at)) FILTER (
          WHERE failed.outcome_kind IS NOT NULL
            AND failed.outcome_kind NOT IN ('usable', 'rate_limit')
        ) AS last_failure_at
      FROM provider_call_attempts failed
      WHERE failed.logical_call_id = call.id
    ) attempt ON true
    WHERE call.game_id IN (${sql.join(gameIds.map((gameId) => sql`${gameId}`), sql`, `)})
      AND (attempt.exact_failure_count > 0 OR call.rate_limit_count > 0)
    GROUP BY call.game_id
  `);
  const byGameId = new Map(rows.map((row) => [row.gameId, row]));
  return new Map(gameIds.map((gameId) => {
    const row = byGameId.get(gameId);
    if (!row) return [gameId, emptyProviderFailureSummary()] as const;
    const failureCount = row.exactFailureCount + row.rateLimitCount;
    return [gameId, {
      schemaVersion: 1,
      state: row.terminalCount > 0
        ? "terminal"
        : row.degradedCount > 0
          ? "degraded"
          : row.transitionedCount > 0
            ? "transitioned"
            : "recovered",
      failureCount,
      exactFailureCount: row.exactFailureCount,
      rateLimitCount: row.rateLimitCount,
      recoveredCount: row.recoveredCount,
      terminalCount: row.terminalCount,
      degradedCount: row.degradedCount,
      transitionedCount: row.transitionedCount,
      lastFailureAt: row.lastFailureAt,
    }] as const;
  }));
}

function emptyProviderFailureSummary(): ProviderFailureSummary {
  return {
    schemaVersion: 1,
    state: "empty",
    failureCount: 0,
    exactFailureCount: 0,
    rateLimitCount: 0,
    recoveredCount: 0,
    terminalCount: 0,
    degradedCount: 0,
    transitionedCount: 0,
    lastFailureAt: null,
  };
}

export async function getProviderFailureDetail(
  db: Pick<DrizzleDB, "execute" | "select">,
  gameId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ProviderFailureDetail> {
  const limit = Math.max(
    1,
    Math.min(
      Math.trunc(options.limit ?? DEFAULT_PROVIDER_FAILURE_PAGE_LIMIT),
      MAX_PROVIDER_FAILURE_PAGE_LIMIT,
    ),
  );
  const cursor = options.cursor !== undefined
    ? decodeProviderFailureCursor(options.cursor)
    : null;
  const [rows, summaries, gameRows, budgetRows] = await Promise.all([
    readProviderFailureRows(db, gameId, { cursor, limit }),
    getProviderFailureSummaryMap(db, [gameId]),
    db.select({ config: schema.games.config }).from(schema.games)
      .where(eq(schema.games.id, gameId)),
    readProviderBudgetAggregates(db, gameId),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const failures = pageRows.map(providerFailureItemFromRow).reverse();

  return {
    schemaVersion: 1,
    gameId,
    summary: summaries.get(gameId) ?? emptyProviderFailureSummary(),
    budgets: providerBudgetItems(gameRows[0]?.config, budgetRows),
    failures,
    page: {
      limit,
      returned: failures.length,
      hasMore,
      nextCursor: hasMore && last
        ? encodeProviderFailureCursor({
            occurredAt: last.occurredAt,
            sortKey: last.sortKey,
          })
        : null,
    },
  };
}

function providerBudgetItems(
  rawConfig: string | undefined,
  aggregateRows: ProviderBudgetAggregateRow[],
): ProviderFailureBudgetItem[] {
  if (!rawConfig) return [];
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  const manifest = resolveProviderManifestFromGameConfig(config);
  const aggregateByCatalogId = new Map(
    aggregateRows.map((row) => [row.catalogId, row]),
  );
  return manifest.map((entry) => {
    const aggregate = aggregateByCatalogId.get(entry.catalogId);
    const usedCalls = aggregate?.usedCalls ?? 0;
    const callCount = aggregate?.callCount ?? 0;
    const actualSourceCount = aggregate?.actualSourceCount ?? 0;
    const estimatedSourceCount = aggregate?.estimatedSourceCount ?? 0;
    const actualCostMicrousd = aggregate?.actualCostMicrousd ?? 0;
    const estimatedCostMicrousd = aggregate?.estimatedCostMicrousd ?? 0;
    const unpricedCallCount = aggregate?.unpricedCallCount ?? 0;
    const maxCallsPerGame = entry.maxCallsPerGame ?? null;
    const remainingCalls = maxCallsPerGame === null
      ? null
      : Math.max(0, maxCallsPerGame - usedCalls);
    return {
      catalogId: entry.catalogId,
      providerProfileId: entry.providerProfile.id,
      modelName: entry.modelId,
      role: entry.role,
      usedCalls,
      maxCallsPerGame,
      remainingCalls,
      state: maxCallsPerGame === null
        ? "unbounded"
        : remainingCalls === 0
          ? "exhausted"
          : "available",
      cost: {
        state: callCount === 0
          ? "no_calls"
          : unpricedCallCount > 0
            ? "unavailable"
            : actualSourceCount > 0
              ? "actual"
              : estimatedSourceCount > 0
                ? "estimated"
                : "unavailable",
        callCount,
        actualCostMicrousd,
        estimatedCostMicrousd,
        unpricedCallCount,
      },
    };
  });
}

async function readProviderFailureRows(
  db: Pick<DrizzleDB, "execute">,
  gameId: string,
  options: { cursor: ProviderFailureCursor | null; limit: number },
): Promise<ProviderFailurePageRow[]> {
  const cursorCondition = options.cursor
    ? sql`
        ("occurredAt" < ${options.cursor.occurredAt})
        OR ("occurredAt" = ${options.cursor.occurredAt} AND "sortKey" < ${options.cursor.sortKey})
      `
    : sql`true`;
  return db.execute<ProviderFailurePageRow>(sql`
    WITH failure_rows AS (
      SELECT
        'attempt'::text AS "kind",
        attempt.id AS "id",
        ('attempt:' || attempt.id) AS "sortKey",
        attempt.logical_call_id AS "logicalCallId",
        COALESCE(attempt.completed_at, attempt.started_at) AS "occurredAt",
        CASE
          WHEN logical_call.id IS NULL
            OR attempt.evidence_state = 'degraded'
            OR logical_call.diagnostics_degraded
            THEN 'degraded'
          WHEN EXISTS (
            SELECT 1
            FROM provider_call_attempts later
            WHERE later.logical_call_id = attempt.logical_call_id
              AND later.attempt_ordinal > attempt.attempt_ordinal
              AND later.outcome_kind = 'usable'
              AND later.disposition = 'accepted'
          ) THEN 'recovered'
          WHEN attempt.disposition = 'exhausted' THEN 'terminal'
          ELSE 'transitioned'
        END AS "state",
        logical_call.actor_name AS "actorName",
        logical_call.actor_role AS "actorRole",
        logical_call.action AS "action",
        logical_call.phase AS "phase",
        logical_call.round AS "round",
        attempt.provider_profile_id AS "providerProfileId",
        attempt.request_shape AS "transport",
        attempt.model_name AS "modelName",
        attempt.attempt_ordinal AS "attemptOrdinal",
        attempt.outcome_kind AS "outcomeKind",
        attempt.outcome_message AS "outcomeMessage",
        attempt.retryable AS "retryable",
        attempt.disposition AS "disposition",
        attempt.provider_request_id AS "providerRequestId",
        attempt.evidence_state AS "evidenceState",
        attempt.evidence_manifest_id AS "evidenceManifestId",
        attempt.evidence_error AS "evidenceError",
        NULL::int AS "rateLimitCount",
        NULL::text AS "rateLimitOutcome",
        NULL::text AS "rateLimitTerminalReason",
        (logical_call.id IS NOT NULL) AS "hasLogicalCall"
      FROM provider_call_attempts attempt
      LEFT JOIN provider_logical_calls logical_call
        ON logical_call.id = attempt.logical_call_id
        AND logical_call.game_id = attempt.game_id
      WHERE attempt.game_id = ${gameId}
        AND attempt.outcome_kind IS NOT NULL
        AND attempt.outcome_kind NOT IN ('usable', 'rate_limit')

      UNION ALL

      SELECT
        'rate_limit'::text AS "kind",
        ('rate-limit:' || logical_call.id) AS "id",
        ('rate-limit:' || logical_call.id) AS "sortKey",
        logical_call.id AS "logicalCallId",
        logical_call.updated_at AS "occurredAt",
        CASE
          WHEN logical_call.rate_limit_outcome = 'exhausted' THEN 'terminal'
          WHEN logical_call.diagnostics_degraded THEN 'degraded'
          WHEN logical_call.rate_limit_outcome = 'recovered' THEN 'recovered'
          ELSE 'transitioned'
        END AS "state",
        logical_call.actor_name AS "actorName",
        logical_call.actor_role AS "actorRole",
        logical_call.action AS "action",
        logical_call.phase AS "phase",
        logical_call.round AS "round",
        NULL::text AS "providerProfileId",
        NULL::text AS "transport",
        NULL::text AS "modelName",
        NULL::int AS "attemptOrdinal",
        NULL::text AS "outcomeKind",
        NULL::text AS "outcomeMessage",
        NULL::boolean AS "retryable",
        NULL::text AS "disposition",
        NULL::text AS "providerRequestId",
        NULL::text AS "evidenceState",
        NULL::text AS "evidenceManifestId",
        NULL::text AS "evidenceError",
        logical_call.rate_limit_count AS "rateLimitCount",
        logical_call.rate_limit_outcome AS "rateLimitOutcome",
        logical_call.rate_limit_terminal_reason AS "rateLimitTerminalReason",
        true AS "hasLogicalCall"
      FROM provider_logical_calls logical_call
      WHERE logical_call.game_id = ${gameId}
        AND logical_call.rate_limit_count > 0
        AND logical_call.rate_limit_outcome IS NOT NULL
    )
    SELECT *
    FROM failure_rows
    WHERE ${cursorCondition}
    ORDER BY "occurredAt" DESC, "sortKey" DESC
    LIMIT ${options.limit + 1}
  `);
}

async function readProviderBudgetAggregates(
  db: Pick<DrizzleDB, "execute">,
  gameId: string,
): Promise<ProviderBudgetAggregateRow[]> {
  return db.execute<ProviderBudgetAggregateRow>(sql`
    WITH attempt_usage AS (
      SELECT
        catalog_id,
        count(*)::int AS used_calls
      FROM provider_call_attempts
      WHERE game_id = ${gameId}
        AND catalog_id IS NOT NULL
      GROUP BY catalog_id
    ), spend_usage AS (
      SELECT
        catalog_id,
        count(*)::int AS call_count,
        count(*) FILTER (
          WHERE cost_source IN ('provider_actual', 'router_actual', 'org_reconciled')
        )::int AS actual_source_count,
        count(*) FILTER (
          WHERE cost_source IN ('catalog_estimate', 'static_estimate')
        )::int AS estimated_source_count,
        COALESCE(sum(actual_cost_microusd), 0)::int AS actual_cost_microusd,
        COALESCE(sum(estimated_cost_microusd), 0)::int AS estimated_cost_microusd,
        count(*) FILTER (WHERE cost_source = 'unavailable')::int AS unpriced_call_count
      FROM game_provider_spend_entries
      WHERE game_id = ${gameId}
        AND catalog_id IS NOT NULL
      GROUP BY catalog_id
    )
    SELECT
      COALESCE(attempt_usage.catalog_id, spend_usage.catalog_id) AS "catalogId",
      COALESCE(attempt_usage.used_calls, 0)::int AS "usedCalls",
      COALESCE(spend_usage.call_count, 0)::int AS "callCount",
      COALESCE(spend_usage.actual_source_count, 0)::int AS "actualSourceCount",
      COALESCE(spend_usage.estimated_source_count, 0)::int AS "estimatedSourceCount",
      COALESCE(spend_usage.actual_cost_microusd, 0)::int AS "actualCostMicrousd",
      COALESCE(spend_usage.estimated_cost_microusd, 0)::int AS "estimatedCostMicrousd",
      COALESCE(spend_usage.unpriced_call_count, 0)::int AS "unpricedCallCount"
    FROM attempt_usage
    FULL OUTER JOIN spend_usage USING (catalog_id)
  `);
}

function providerFailureItemFromRow(row: ProviderFailurePageRow): ProviderFailureItem {
  if (row.kind === "rate_limit") {
    return {
      kind: "rate_limit",
      id: row.id,
      logicalCallId: row.logicalCallId,
      occurredAt: row.occurredAt,
      state: row.state,
      actorName: row.actorName ?? "Unknown actor",
      actorRole: row.actorRole ?? "system",
      action: row.action ?? "unknown",
      phase: row.phase,
      round: row.round,
      count: row.rateLimitCount ?? 0,
      outcome: row.rateLimitOutcome === "recovered" || row.rateLimitOutcome === "exhausted"
        ? row.rateLimitOutcome
        : "pending",
      terminalReason: row.rateLimitTerminalReason,
    };
  }

  const evidenceState = !row.hasLogicalCall
    ? "degraded"
    : row.evidenceState === "stored" && row.evidenceManifestId
      ? "available"
      : row.evidenceState === "degraded"
        ? "degraded"
        : "unavailable";
  return {
    kind: "attempt",
    id: row.id,
    logicalCallId: row.logicalCallId,
    occurredAt: row.occurredAt,
    state: row.state,
    actorName: row.actorName ?? "Unknown actor",
    actorRole: row.actorRole ?? "system",
    action: row.action ?? "unknown",
    phase: row.phase,
    round: row.round,
    providerProfileId: row.providerProfileId ?? "unknown",
    transport: row.transport ?? "unknown",
    modelName: row.modelName ?? "unknown",
    attemptOrdinal: row.attemptOrdinal ?? 0,
    outcomeKind: row.outcomeKind ?? "indeterminate",
    outcomeMessage: row.outcomeMessage,
    retryable: row.retryable,
    disposition: row.disposition,
    providerRequestId: row.providerRequestId,
    evidence: {
      state: evidenceState,
      manifestId: evidenceState === "available" ? row.evidenceManifestId : null,
      error: evidenceState === "available"
        ? null
        : !row.hasLogicalCall
          ? "Logical provider call metadata is unavailable"
          : row.evidenceError,
    },
  };
}

function encodeProviderFailureCursor(cursor: ProviderFailureCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.sortKey]), "utf8")
    .toString("base64url");
}

function decodeProviderFailureCursor(value: string): ProviderFailureCursor {
  if (value.length === 0 || value.length > 1024) throw new InvalidProviderFailureCursorError();
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) {
      throw new InvalidProviderFailureCursorError();
    }
    const [occurredAt, sortKey] = decoded;
    if (
      typeof occurredAt !== "string"
      || occurredAt.length === 0
      || occurredAt.length > 100
      || !Number.isFinite(Date.parse(occurredAt))
      || typeof sortKey !== "string"
      || sortKey.length === 0
      || sortKey.length > 512
    ) {
      throw new InvalidProviderFailureCursorError();
    }
    return { occurredAt, sortKey };
  } catch (error) {
    if (error instanceof InvalidProviderFailureCursorError) throw error;
    throw new InvalidProviderFailureCursorError();
  }
}
