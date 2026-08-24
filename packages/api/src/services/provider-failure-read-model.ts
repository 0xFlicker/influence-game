import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
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
}

type LogicalCallRow = Pick<
  typeof schema.providerLogicalCalls.$inferSelect,
  | "id"
  | "gameId"
  | "actorName"
  | "actorRole"
  | "action"
  | "phase"
  | "round"
  | "rateLimitCount"
  | "rateLimitOutcome"
  | "rateLimitTerminalReason"
  | "diagnosticsDegraded"
  | "createdAt"
  | "updatedAt"
>;

type AttemptRow = Pick<
  typeof schema.providerCallAttempts.$inferSelect,
  | "id"
  | "logicalCallId"
  | "gameId"
  | "attemptOrdinal"
  | "providerProfileId"
  | "catalogId"
  | "modelName"
  | "status"
  | "startedAt"
  | "completedAt"
  | "outcomeKind"
  | "outcomeMessage"
  | "retryable"
  | "disposition"
  | "providerRequestId"
  | "evidenceState"
  | "evidenceManifestId"
  | "evidenceError"
>;

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
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<ProviderFailureDetail> {
  const [{ calls, attempts }, gameRows, spendRows] = await Promise.all([
    readProviderFailureRows(db, [gameId]),
    db.select({ config: schema.games.config }).from(schema.games)
      .where(eq(schema.games.id, gameId)),
    db.select({
      catalogId: schema.gameProviderSpendEntries.catalogId,
      costSource: schema.gameProviderSpendEntries.costSource,
      actualCostMicrousd: schema.gameProviderSpendEntries.actualCostMicrousd,
      estimatedCostMicrousd: schema.gameProviderSpendEntries.estimatedCostMicrousd,
    }).from(schema.gameProviderSpendEntries)
      .where(eq(schema.gameProviderSpendEntries.gameId, gameId)),
  ]);
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const attemptsByCall = Map.groupBy(attempts, (attempt) => attempt.logicalCallId);
  const failures: ProviderFailureItem[] = [];

  for (const call of calls) {
    const callAttempts = attemptsByCall.get(call.id) ?? [];
    for (const attempt of callAttempts) {
      if (!isExactFailureAttempt(attempt)) continue;
      failures.push(providerFailureAttemptItem(call, attempt, callAttempts));
    }
    if (call.rateLimitCount > 0 && call.rateLimitOutcome) {
      failures.push(providerFailureRateLimitItem(call));
    }
  }

  // Preserve evidence even if a damaged foreign-key relationship is encountered.
  for (const attempt of attempts) {
    if (callsById.has(attempt.logicalCallId) || !isExactFailureAttempt(attempt)) continue;
    failures.push(orphanedProviderFailureAttemptItem(attempt));
  }

  failures.sort((left, right) => (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
      || left.id.localeCompare(right.id)
  ));

  return {
    schemaVersion: 1,
    gameId,
    summary: summarizeProviderFailures(calls, attempts),
    budgets: providerBudgetItems(gameRows[0]?.config, attempts, spendRows),
    failures,
  };
}

function providerBudgetItems(
  rawConfig: string | undefined,
  attempts: AttemptRow[],
  spendRows: Array<{
    catalogId: string | null;
    costSource: string;
    actualCostMicrousd: number | null;
    estimatedCostMicrousd: number | null;
  }>,
): ProviderFailureBudgetItem[] {
  if (!rawConfig) return [];
  const config = JSON.parse(rawConfig) as Record<string, unknown>;
  const manifest = resolveProviderManifestFromGameConfig(config);
  return manifest.map((entry) => {
    const usedCalls = attempts.filter(
      (attempt) => attempt.catalogId === entry.catalogId,
    ).length;
    const costs = spendRows.filter((row) => row.catalogId === entry.catalogId);
    const actualCosts = costs.filter((row) => (
      row.costSource === "provider_actual"
      || row.costSource === "router_actual"
      || row.costSource === "org_reconciled"
    ));
    const estimatedCosts = costs.filter((row) => (
      row.costSource === "catalog_estimate"
      || row.costSource === "static_estimate"
    ));
    const actualCostMicrousd = costs.reduce(
      (sum, row) => sum + (row.actualCostMicrousd ?? 0),
      0,
    );
    const estimatedCostMicrousd = costs.reduce(
      (sum, row) => sum + (row.estimatedCostMicrousd ?? 0),
      0,
    );
    const unpricedCallCount = costs.filter(
      (row) => row.costSource === "unavailable",
    ).length;
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
        state: costs.length === 0
          ? "no_calls"
          : unpricedCallCount > 0
            ? "unavailable"
            : actualCosts.length > 0
              ? "actual"
              : estimatedCosts.length > 0
                ? "estimated"
                : "unavailable",
        callCount: costs.length,
        actualCostMicrousd,
        estimatedCostMicrousd,
        unpricedCallCount,
      },
    };
  });
}

async function readProviderFailureRows(
  db: Pick<DrizzleDB, "select">,
  gameIds: readonly string[],
  failuresOnly = false,
): Promise<{ calls: LogicalCallRow[]; attempts: AttemptRow[] }> {
  const exactFailure = and(
    isNotNull(schema.providerCallAttempts.outcomeKind),
    notInArray(schema.providerCallAttempts.outcomeKind, ["usable", "rate_limit"]),
  );
  const callHasExactFailure = sql<boolean>`EXISTS (
    SELECT 1
    FROM ${schema.providerCallAttempts}
    WHERE ${schema.providerCallAttempts.logicalCallId} = ${schema.providerLogicalCalls.id}
      AND ${schema.providerCallAttempts.outcomeKind} IS NOT NULL
      AND ${schema.providerCallAttempts.outcomeKind} NOT IN ('usable', 'rate_limit')
  )`;
  const calls = await db.select({
      id: schema.providerLogicalCalls.id,
      gameId: schema.providerLogicalCalls.gameId,
      actorName: schema.providerLogicalCalls.actorName,
      actorRole: schema.providerLogicalCalls.actorRole,
      action: schema.providerLogicalCalls.action,
      phase: schema.providerLogicalCalls.phase,
      round: schema.providerLogicalCalls.round,
      rateLimitCount: schema.providerLogicalCalls.rateLimitCount,
      rateLimitOutcome: schema.providerLogicalCalls.rateLimitOutcome,
      rateLimitTerminalReason: schema.providerLogicalCalls.rateLimitTerminalReason,
      diagnosticsDegraded: schema.providerLogicalCalls.diagnosticsDegraded,
      createdAt: schema.providerLogicalCalls.createdAt,
      updatedAt: schema.providerLogicalCalls.updatedAt,
    }).from(schema.providerLogicalCalls)
      .where(and(
        inArray(schema.providerLogicalCalls.gameId, [...gameIds]),
        failuresOnly
          ? or(gt(schema.providerLogicalCalls.rateLimitCount, 0), callHasExactFailure)
          : undefined,
      ))
      .orderBy(asc(schema.providerLogicalCalls.createdAt), asc(schema.providerLogicalCalls.id));
  const callIds = calls.map((call) => call.id);
  const attempts = await db.select({
      id: schema.providerCallAttempts.id,
      logicalCallId: schema.providerCallAttempts.logicalCallId,
      gameId: schema.providerCallAttempts.gameId,
      attemptOrdinal: schema.providerCallAttempts.attemptOrdinal,
      providerProfileId: schema.providerCallAttempts.providerProfileId,
      catalogId: schema.providerCallAttempts.catalogId,
      modelName: schema.providerCallAttempts.modelName,
      status: schema.providerCallAttempts.status,
      startedAt: schema.providerCallAttempts.startedAt,
      completedAt: schema.providerCallAttempts.completedAt,
      outcomeKind: schema.providerCallAttempts.outcomeKind,
      outcomeMessage: schema.providerCallAttempts.outcomeMessage,
      retryable: schema.providerCallAttempts.retryable,
      disposition: schema.providerCallAttempts.disposition,
      providerRequestId: schema.providerCallAttempts.providerRequestId,
      evidenceState: schema.providerCallAttempts.evidenceState,
      evidenceManifestId: schema.providerCallAttempts.evidenceManifestId,
      evidenceError: schema.providerCallAttempts.evidenceError,
    }).from(schema.providerCallAttempts)
      .where(and(
        inArray(schema.providerCallAttempts.gameId, [...gameIds]),
        failuresOnly
          ? or(
              callIds.length > 0
                ? inArray(schema.providerCallAttempts.logicalCallId, callIds)
                : undefined,
              exactFailure,
            )
          : undefined,
      ))
      .orderBy(asc(schema.providerCallAttempts.startedAt), asc(schema.providerCallAttempts.id));
  return { calls, attempts };
}

function summarizeProviderFailures(calls: LogicalCallRow[], attempts: AttemptRow[]): ProviderFailureSummary {
  const attemptsByCall = Map.groupBy(attempts, (attempt) => attempt.logicalCallId);
  const callsById = new Map(calls.map((call) => [call.id, call]));
  const exactFailures = attempts.filter(isExactFailureAttempt);
  const rateLimitCount = calls.reduce((sum, call) => sum + call.rateLimitCount, 0);
  const states = [
    ...exactFailures.map((attempt) => providerFailureState(
      attempt,
      attemptsByCall.get(attempt.logicalCallId) ?? [],
      callsById.get(attempt.logicalCallId)?.diagnosticsDegraded ?? false,
    )),
    ...calls.filter((call) => call.rateLimitCount > 0).map(rateLimitState),
  ];
  const lastFailureAt = [
    ...exactFailures.map((attempt) => attempt.completedAt ?? attempt.startedAt),
    ...calls.filter((call) => call.rateLimitCount > 0).map((call) => call.updatedAt),
  ].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const summary = {
    schemaVersion: 1 as const,
    failureCount: exactFailures.length + rateLimitCount,
    exactFailureCount: exactFailures.length,
    rateLimitCount,
    recoveredCount: states.filter((state) => state === "recovered").length,
    terminalCount: states.filter((state) => state === "terminal").length,
    degradedCount: exactFailures.filter((attempt) => (
      attempt.evidenceState === "degraded"
        || callsById.get(attempt.logicalCallId)?.diagnosticsDegraded
    )).length + calls.filter((call) => call.rateLimitCount > 0 && call.diagnosticsDegraded).length,
    transitionedCount: states.filter((state) => state === "transitioned").length,
    lastFailureAt,
  };
  return {
    ...summary,
    state: summary.failureCount === 0
      ? "empty"
      : summary.terminalCount > 0
        ? "terminal"
        : summary.degradedCount > 0
          ? "degraded"
          : summary.transitionedCount > 0
            ? "transitioned"
            : "recovered",
  };
}

function providerFailureAttemptItem(
  call: LogicalCallRow,
  attempt: AttemptRow,
  callAttempts: AttemptRow[],
): ProviderFailureAttemptItem {
  const evidenceState = attempt.evidenceState === "stored" && attempt.evidenceManifestId
    ? "available"
    : attempt.evidenceState === "degraded"
      ? "degraded"
      : "unavailable";
  return {
    kind: "attempt",
    id: attempt.id,
    logicalCallId: attempt.logicalCallId,
    occurredAt: attempt.completedAt ?? attempt.startedAt,
    state: providerFailureState(attempt, callAttempts, call.diagnosticsDegraded),
    actorName: call.actorName,
    actorRole: call.actorRole,
    action: call.action,
    phase: call.phase,
    round: call.round,
    providerProfileId: attempt.providerProfileId,
    modelName: attempt.modelName,
    attemptOrdinal: attempt.attemptOrdinal,
    outcomeKind: attempt.outcomeKind ?? "indeterminate",
    outcomeMessage: attempt.outcomeMessage,
    retryable: attempt.retryable,
    disposition: attempt.disposition,
    providerRequestId: attempt.providerRequestId,
    evidence: {
      state: evidenceState,
      manifestId: evidenceState === "available" ? attempt.evidenceManifestId : null,
      error: evidenceState === "available" ? null : attempt.evidenceError,
    },
  };
}

function orphanedProviderFailureAttemptItem(attempt: AttemptRow): ProviderFailureAttemptItem {
  return {
    kind: "attempt",
    id: attempt.id,
    logicalCallId: attempt.logicalCallId,
    occurredAt: attempt.completedAt ?? attempt.startedAt,
    state: "degraded",
    actorName: "Unknown actor",
    actorRole: "system",
    action: "unknown",
    phase: null,
    round: null,
    providerProfileId: attempt.providerProfileId,
    modelName: attempt.modelName,
    attemptOrdinal: attempt.attemptOrdinal,
    outcomeKind: attempt.outcomeKind ?? "indeterminate",
    outcomeMessage: attempt.outcomeMessage,
    retryable: attempt.retryable,
    disposition: attempt.disposition,
    providerRequestId: attempt.providerRequestId,
    evidence: {
      state: "degraded",
      manifestId: null,
      error: "Logical provider call metadata is unavailable",
    },
  };
}

function providerFailureRateLimitItem(call: LogicalCallRow): ProviderFailureRateLimitItem {
  return {
    kind: "rate_limit",
    id: `rate-limit:${call.id}`,
    logicalCallId: call.id,
    occurredAt: call.updatedAt,
    state: rateLimitState(call),
    actorName: call.actorName,
    actorRole: call.actorRole,
    action: call.action,
    phase: call.phase,
    round: call.round,
    count: call.rateLimitCount,
    outcome: call.rateLimitOutcome ?? "pending",
    terminalReason: call.rateLimitTerminalReason,
  };
}

function providerFailureState(
  attempt: AttemptRow,
  callAttempts: AttemptRow[],
  diagnosticsDegraded: boolean,
): ProviderFailureState {
  if (diagnosticsDegraded || attempt.evidenceState === "degraded") return "degraded";
  const recovered = callAttempts.some((candidate) => (
    candidate.attemptOrdinal > attempt.attemptOrdinal
      && candidate.outcomeKind === "usable"
      && candidate.disposition === "accepted"
  ));
  if (recovered) return "recovered";
  return attempt.disposition === "exhausted" ? "terminal" : "transitioned";
}

function rateLimitState(call: LogicalCallRow): ProviderFailureState {
  if (call.rateLimitOutcome === "exhausted") return "terminal";
  if (call.diagnosticsDegraded) return "degraded";
  if (call.rateLimitOutcome === "recovered") return "recovered";
  return "transitioned";
}

function isExactFailureAttempt(attempt: AttemptRow): boolean {
  return attempt.outcomeKind !== null
    && attempt.outcomeKind !== "usable"
    && attempt.outcomeKind !== "rate_limit";
}
