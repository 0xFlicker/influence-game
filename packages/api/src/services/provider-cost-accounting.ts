import { createHash, randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  estimateCostForKnownModel,
  type PrivateDecisionTrace,
  type TokenUsage,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

const PRICING_SOURCE_ID = "engine.MODEL_PRICING";
const RATE_CARD_VERSION = "2026-07-03";

const UNSAFE_KEY_PATTERN = /prompt|messages|response|content|tool|arguments|thinking|reasoning|key|secret|token/i;

type SpendRow = typeof schema.gameProviderSpendEntries.$inferSelect;
type SpendInsert = typeof schema.gameProviderSpendEntries.$inferInsert;
type CostAccountingTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export interface RecordProviderSpendForTraceInput {
  gameId: string;
  ownerEpoch: string;
  trace: PrivateDecisionTrace;
  eventSequence?: number;
  traceManifestId?: string;
  now?: Date;
}

export interface RecordProviderSpendResult {
  inserted: boolean;
  sourceKey: string;
}

export interface BackfillGameCostResult {
  gameId: string;
  inserted: number;
  skipped: number;
  rebuilt: boolean;
  diagnostics: string[];
}

export interface AdminGameCostSummary {
  callCount: number;
  failedCallCount: number;
  unpricedCallCount: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  costCurrency: string;
  costSourceCounts: Record<string, number>;
  captureSourceCounts: Record<string, number>;
  providerNativeTotals: Record<string, number>;
  lastEntryAt?: string;
  state: "no_calls" | "unavailable" | "estimated" | "actual";
}

export interface AdminGameCostDetail extends AdminGameCostSummary {
  gameId: string;
  ownerEpochBreakdowns: Array<{
    ownerEpoch: string;
    summary: AdminGameCostSummary;
  }>;
  breakdowns: Record<string, unknown>;
  expensiveCalls: Array<Record<string, unknown>>;
  retryFailureSpend: {
    failedCallCount: number;
    retryCallCount: number;
    actualCostMicrousd: number;
    estimatedCostMicrousd: number;
  };
  backfill: {
    traceBackfilledEntries: number;
    terminalBackfilledEntries: number;
    hasTerminalAggregate: boolean;
  };
  pricing: {
    rateCardVersions: string[];
    pricingSourceIds: string[];
    pricedAt: string[];
  };
  reconciliation: Array<Record<string, unknown>>;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerish(value: unknown): number | undefined {
  const n = finiteNumber(value);
  return n === undefined ? undefined : Math.max(0, Math.round(n));
}

function positiveInteger(value: unknown): number | undefined {
  const n = integerish(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function safeString(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  if (UNSAFE_KEY_PATTERN.test(value)) return "[redacted]";
  return value.slice(0, maxLength);
}

function sanitizeForAccounting(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return safeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return "[redacted]";
    return value.slice(0, 25).map((item) => sanitizeForAccounting(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return undefined;
  if (depth >= 4) return "[redacted]";

  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const safeKey = key.slice(0, 80);
    if (UNSAFE_KEY_PATTERN.test(key)) {
      safe[safeKey] = "[redacted]";
      continue;
    }
    const sanitized = sanitizeForAccounting(child, depth + 1);
    if (sanitized !== undefined) safe[safeKey] = sanitized;
  }
  return safe;
}

function pickUsageFromRaw(raw: unknown): NonNullable<PrivateDecisionTrace["usage"]> | undefined {
  const rawRecord = asRecord(raw);
  const usageRecord = asRecord(rawRecord?.usage);
  if (!usageRecord) return undefined;

  const completionDetails = asRecord(usageRecord.completion_tokens_details) ?? {};
  const promptDetails = asRecord(usageRecord.prompt_tokens_details) ?? {};
  const inputDetails = asRecord(usageRecord.input_tokens_details) ?? {};
  const outputDetails = asRecord(usageRecord.output_tokens_details) ?? {};
  const routerBilling = asRecord(usageRecord.imgnai);
  const diagnostics: string[] = [];
  if ("imgnai" in usageRecord && !routerBilling) diagnostics.push("malformed_router_billing");

  const promptTokens = integerish(usageRecord.prompt_tokens) ?? integerish(usageRecord.input_tokens);
  const completionTokens = integerish(usageRecord.completion_tokens) ?? integerish(usageRecord.output_tokens);
  const cachedTokens =
    integerish(promptDetails.cached_tokens) ??
    integerish(inputDetails.cached_tokens);
  const reasoningTokens =
    integerish(completionDetails.reasoning_tokens) ??
    integerish(outputDetails.reasoning_tokens);
  const totalTokens =
    integerish(usageRecord.total_tokens) ??
    ((promptTokens ?? 0) + (completionTokens ?? 0) || undefined);

  const usage: NonNullable<PrivateDecisionTrace["usage"]> = {
    ...(promptTokens !== undefined && { promptTokens }),
    ...(completionTokens !== undefined && { completionTokens }),
    ...(cachedTokens !== undefined && { cachedTokens }),
    ...(reasoningTokens !== undefined && { reasoningTokens }),
    ...(totalTokens !== undefined && { totalTokens }),
    ...(routerBilling && { routerBilling }),
    ...(diagnostics.length > 0 && { diagnostics }),
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function normalizedUsage(trace: PrivateDecisionTrace): NonNullable<PrivateDecisionTrace["usage"]> {
  const rawUsage = pickUsageFromRaw(trace.response.raw);
  const usage = trace.usage ?? rawUsage ?? {};
  return {
    promptTokens: usage.promptTokens ?? rawUsage?.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? rawUsage?.completionTokens ?? 0,
    cachedTokens: usage.cachedTokens ?? rawUsage?.cachedTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? rawUsage?.reasoningTokens ?? 0,
    totalTokens: usage.totalTokens ??
      rawUsage?.totalTokens ??
      ((usage.promptTokens ?? rawUsage?.promptTokens ?? 0) + (usage.completionTokens ?? rawUsage?.completionTokens ?? 0)),
    ...(usage.routerBilling ?? rawUsage?.routerBilling
      ? { routerBilling: usage.routerBilling ?? rawUsage?.routerBilling }
      : {}),
    ...(usage.diagnostics ?? rawUsage?.diagnostics
      ? { diagnostics: [...(usage.diagnostics ?? []), ...(rawUsage?.diagnostics ?? [])] }
      : {}),
  };
}

function providerResponseId(trace: PrivateDecisionTrace): string | undefined {
  const raw = asRecord(trace.response.raw);
  return safeString(raw?.id, 128);
}

function callIdForTrace(input: RecordProviderSpendForTraceInput): string {
  const responseId = providerResponseId(input.trace);
  return sha256({
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    eventSequence: input.eventSequence ?? input.trace.boundary?.finalEventSequence,
    createdAt: input.trace.createdAt,
    actor: input.trace.actor,
    action: input.trace.action,
    phase: input.trace.phase,
    round: input.trace.round,
    model: input.trace.model,
    responseId,
    finishReason: input.trace.response.finishReason,
  }).slice(0, 32);
}

function extractRouterActualMicrousd(routerBilling: Record<string, unknown> | undefined): number | undefined {
  if (!routerBilling) return undefined;
  const directMicro = integerish(routerBilling.cost_microusd) ?? integerish(routerBilling.costMicrousd);
  if (directMicro !== undefined) return directMicro;
  const usd =
    finiteNumber(routerBilling.cost_usd) ??
    finiteNumber(routerBilling.costUsd) ??
    finiteNumber(routerBilling.usd) ??
    finiteNumber(routerBilling.amount_usd);
  return usd === undefined ? undefined : Math.max(0, Math.round(usd * 1_000_000));
}

function extractProviderNative(routerBilling: Record<string, unknown> | undefined): {
  unit?: string;
  amount?: string;
} {
  if (!routerBilling) return {};
  const credits =
    finiteNumber(routerBilling.credits_charged) ??
    finiteNumber(routerBilling.creditsCharged) ??
    finiteNumber(routerBilling.credits);
  if (credits !== undefined) {
    return { unit: "katana_credit", amount: String(credits) };
  }
  const amount = finiteNumber(routerBilling.amount);
  const unit = safeString(routerBilling.unit, 40);
  return amount !== undefined && unit ? { unit, amount: String(amount) } : {};
}

function estimateMicrousd(usage: NonNullable<PrivateDecisionTrace["usage"]>, model: string): number | undefined {
  const promptTokens = usage.promptTokens ?? 0;
  const cachedTokens = usage.cachedTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens ?? 0;
  const totalTokens = usage.totalTokens ?? (promptTokens + completionTokens);
  const hasPricedBuckets = promptTokens > 0 || cachedTokens > 0 || completionTokens > 0;
  const totalUsage: TokenUsage = {
    promptTokens: hasPricedBuckets ? promptTokens : totalTokens,
    cachedTokens: hasPricedBuckets ? cachedTokens : 0,
    completionTokens: hasPricedBuckets ? completionTokens : 0,
    reasoningTokens,
    totalTokens,
    callCount: 1,
    emptyResponses: 0,
  };
  const estimate = estimateCostForKnownModel(totalUsage, model);
  return estimate ? Math.max(0, Math.round(estimate.totalCost * 1_000_000)) : undefined;
}

function usesTotalOnlyPricingFallback(usage: NonNullable<PrivateDecisionTrace["usage"]>): boolean {
  const promptTokens = usage.promptTokens ?? 0;
  const cachedTokens = usage.cachedTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const totalTokens = usage.totalTokens ?? 0;
  return totalTokens > 0 && promptTokens === 0 && cachedTokens === 0 && completionTokens === 0;
}

function costStateFor(summary: Pick<AdminGameCostSummary, "callCount" | "actualCostMicrousd" | "estimatedCostMicrousd" | "unpricedCallCount">): AdminGameCostSummary["state"] {
  if (summary.callCount === 0) return "no_calls";
  if (summary.actualCostMicrousd > 0) return "actual";
  if (summary.estimatedCostMicrousd > 0) return "estimated";
  if (summary.unpricedCallCount > 0) return "unavailable";
  return "unavailable";
}

function callStatusForFinishReason(finishReason: string | null | undefined): SpendInsert["callStatus"] {
  const normalized = finishReason?.toLowerCase();
  if (!normalized) return "unknown";
  if (["stop", "completed", "tool_calls"].includes(normalized)) return "succeeded";
  if (["error", "failed", "incomplete", "cancelled", "length", "content_filter"].includes(normalized)) {
    return "failed";
  }
  return "unknown";
}

function emptySummary(): AdminGameCostSummary {
  return {
    callCount: 0,
    failedCallCount: 0,
    unpricedCallCount: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    actualCostMicrousd: 0,
    estimatedCostMicrousd: 0,
    costCurrency: "USD",
    costSourceCounts: {},
    captureSourceCounts: {},
    providerNativeTotals: {},
    state: "no_calls",
  };
}

function incrementCount(target: Record<string, number>, key: string | null | undefined, amount = 1): void {
  const label = key || "unknown";
  target[label] = (target[label] ?? 0) + amount;
}

function recordOfNumbers(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, raw]) => [key, finiteNumber(raw)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
  );
}

function addBreakdown(
  breakdowns: Record<string, Record<string, { callCount: number; actualCostMicrousd: number; estimatedCostMicrousd: number; totalTokens: number }>>,
  group: string,
  key: string | null | undefined,
  entry: SpendRow,
): void {
  const label = key || "unknown";
  const groupRecord = breakdowns[group] ?? {};
  const existing = groupRecord[label] ?? {
    callCount: 0,
    actualCostMicrousd: 0,
    estimatedCostMicrousd: 0,
    totalTokens: 0,
  };
  existing.callCount += 1;
  existing.actualCostMicrousd += entry.actualCostMicrousd ?? 0;
  existing.estimatedCostMicrousd += entry.estimatedCostMicrousd ?? 0;
  existing.totalTokens += entry.totalTokens;
  groupRecord[label] = existing;
  breakdowns[group] = groupRecord;
}

function summaryFromEntries(entries: SpendRow[]): AdminGameCostSummary & { breakdowns: Record<string, unknown> } {
  const summary = emptySummary();
  const costSourceCounts: Record<string, number> = {};
  const captureSourceCounts: Record<string, number> = {};
  const providerNativeTotals: Record<string, number> = {};
  const breakdowns: Record<string, Record<string, { callCount: number; actualCostMicrousd: number; estimatedCostMicrousd: number; totalTokens: number }>> = {};

  for (const entry of entries) {
    summary.callCount += 1;
    if (entry.callStatus === "failed") summary.failedCallCount += 1;
    if (entry.costSource === "unavailable") summary.unpricedCallCount += 1;
    summary.promptTokens += entry.promptTokens;
    summary.cachedTokens += entry.cachedTokens;
    summary.completionTokens += entry.completionTokens;
    summary.reasoningTokens += entry.reasoningTokens;
    summary.totalTokens += entry.totalTokens;
    summary.actualCostMicrousd += entry.actualCostMicrousd ?? 0;
    summary.estimatedCostMicrousd += entry.estimatedCostMicrousd ?? 0;
    incrementCount(costSourceCounts, entry.costSource);
    incrementCount(captureSourceCounts, entry.captureSource);
    if (entry.providerNativeUnit && entry.providerNativeAmount) {
      const parsed = Number(entry.providerNativeAmount);
      if (Number.isFinite(parsed)) {
        providerNativeTotals[entry.providerNativeUnit] = (providerNativeTotals[entry.providerNativeUnit] ?? 0) + parsed;
      }
    }
    addBreakdown(breakdowns, "provider", entry.provider, entry);
    addBreakdown(breakdowns, "model", entry.modelName, entry);
    addBreakdown(breakdowns, "actorRole", entry.actorRole, entry);
    addBreakdown(breakdowns, "actor", entry.actorName ?? entry.actorId, entry);
    addBreakdown(breakdowns, "action", entry.action, entry);
    addBreakdown(breakdowns, "phase", entry.phase, entry);
    addBreakdown(breakdowns, "round", entry.round === null ? undefined : String(entry.round), entry);
    addBreakdown(breakdowns, "ownerEpoch", entry.ownerEpoch, entry);
    const entryAt = entry.observedAt || entry.createdAt;
    if (!summary.lastEntryAt || entryAt > summary.lastEntryAt) summary.lastEntryAt = entryAt;
  }

  summary.costSourceCounts = costSourceCounts;
  summary.captureSourceCounts = captureSourceCounts;
  summary.providerNativeTotals = providerNativeTotals;
  summary.state = costStateFor(summary);
  return { ...summary, breakdowns };
}

function rollupValues(
  gameId: string,
  ownerEpoch: string | null,
  rollupScope: "game" | "owner_epoch",
  entries: SpendRow[],
) {
  const summary = summaryFromEntries(entries);
  const sortedEntryTimes = entries
    .map((entry) => entry.observedAt || entry.createdAt)
    .sort();
  return {
    id: randomUUID(),
    gameId,
    ownerEpoch,
    rollupScope,
    callCount: summary.callCount,
    failedCallCount: summary.failedCallCount,
    unpricedCallCount: summary.unpricedCallCount,
    promptTokens: summary.promptTokens,
    cachedTokens: summary.cachedTokens,
    completionTokens: summary.completionTokens,
    reasoningTokens: summary.reasoningTokens,
    totalTokens: summary.totalTokens,
    actualCostMicrousd: summary.actualCostMicrousd,
    estimatedCostMicrousd: summary.estimatedCostMicrousd,
    providerNativeTotals: summary.providerNativeTotals,
    breakdowns: summary.breakdowns,
    costSourceCounts: summary.costSourceCounts,
    captureSourceCounts: summary.captureSourceCounts,
    firstEntryAt: sortedEntryTimes[0],
    lastEntryAt: sortedEntryTimes.at(-1),
    rebuiltAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function rebuildGameCostRollupsInTransaction(
  tx: CostAccountingTx,
  gameId: string,
  lock = true,
): Promise<void> {
  if (lock) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('game_cost_rollups'), hashtext(${gameId}))`);
  }

  const entries = await tx
    .select()
    .from(schema.gameProviderSpendEntries)
    .where(eq(schema.gameProviderSpendEntries.gameId, gameId));

  await tx
    .delete(schema.gameCostRollups)
    .where(eq(schema.gameCostRollups.gameId, gameId));

  if (entries.length === 0) return;

  await tx.insert(schema.gameCostRollups).values(rollupValues(gameId, null, "game", entries));

  const byOwnerEpoch = new Map<string, SpendRow[]>();
  for (const entry of entries) {
    if (!entry.ownerEpoch) continue;
    byOwnerEpoch.set(entry.ownerEpoch, [...(byOwnerEpoch.get(entry.ownerEpoch) ?? []), entry]);
  }

  if (byOwnerEpoch.size > 0) {
    await tx.insert(schema.gameCostRollups).values(
      [...byOwnerEpoch.entries()].map(([ownerEpoch, ownerEntries]) => (
        rollupValues(gameId, ownerEpoch, "owner_epoch", ownerEntries)
      )),
    );
  }
}

export async function rebuildGameCostRollups(db: DrizzleDB, gameId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await rebuildGameCostRollupsInTransaction(tx, gameId);
  });
}

export async function recordProviderSpendForTrace(
  db: DrizzleDB,
  input: RecordProviderSpendForTraceInput,
): Promise<RecordProviderSpendResult> {
  const usage = normalizedUsage(input.trace);
  const now = input.now ?? new Date();
  const callId = callIdForTrace(input);
  const sourceKey = `live:${input.gameId}:${input.ownerEpoch}:${callId}`;
  const eventSequence = positiveInteger(input.eventSequence ?? input.trace.boundary?.finalEventSequence);
  const routerBilling = asRecord(usage.routerBilling);
  const actualCostMicrousd = extractRouterActualMicrousd(routerBilling);
  const estimatedCostMicrousd = actualCostMicrousd === undefined
    ? estimateMicrousd(usage, input.trace.model.name)
    : undefined;
  const providerNative = extractProviderNative(routerBilling);
  const costSource: SpendInsert["costSource"] =
    actualCostMicrousd !== undefined
      ? "router_actual"
      : estimatedCostMicrousd !== undefined
        ? "static_estimate"
        : "unavailable";
  const diagnostics = {
    items: [
      ...(usage.diagnostics ?? []),
      ...(costSource === "unavailable" ? ["cost_unavailable"] : []),
      ...(costSource === "static_estimate" && usesTotalOnlyPricingFallback(usage) ? ["aggregate_usage_estimate"] : []),
    ].map((item) => safeString(item)).filter(Boolean),
  };

  const inserted = await db
    .insert(schema.gameProviderSpendEntries)
    .values({
      id: randomUUID(),
      gameId: input.gameId,
      ownerEpoch: input.ownerEpoch,
      eventSequence,
      sourceKey,
      captureSource: "live_trace",
      costSource,
      callStatus: callStatusForFinishReason(input.trace.response.finishReason),
      callId,
      attemptOrdinal: 1,
      providerResponseId: providerResponseId(input.trace),
      traceManifestId: input.traceManifestId,
      actorId: input.trace.actor.id,
      actorName: input.trace.actor.name,
      actorRole: input.trace.actor.role,
      action: input.trace.action,
      phase: input.trace.phase,
      round: input.trace.round,
      provider: input.trace.model.provider,
      providerProfileId: input.trace.model.providerProfileId,
      catalogId: input.trace.model.catalogId,
      modelName: input.trace.model.name,
      apiSurface: asRecord(input.trace.response.raw)?.object === "response" ? "openai_responses" : "chat_completions",
      reasoningPolicy: input.trace.reasoningPolicy,
      requestedReasoningEffort: input.trace.requestedReasoningEffort,
      promptTokens: usage.promptTokens ?? 0,
      cachedTokens: usage.cachedTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
      totalTokens: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)),
      actualCostMicrousd,
      estimatedCostMicrousd,
      providerNativeUnit: providerNative.unit,
      providerNativeAmount: providerNative.amount,
      pricingSourceId: estimatedCostMicrousd !== undefined ? PRICING_SOURCE_ID : undefined,
      rateCardVersion: estimatedCostMicrousd !== undefined ? RATE_CARD_VERSION : undefined,
      pricedAt: estimatedCostMicrousd !== undefined ? now.toISOString() : undefined,
      routerBilling: sanitizeForAccounting(routerBilling) as Record<string, unknown> | undefined,
      diagnostics: sanitizeForAccounting(diagnostics) as Record<string, unknown>,
      safeMetadata: sanitizeForAccounting({
        finishReason: input.trace.response.finishReason,
        hasTraceManifest: Boolean(input.traceManifestId),
      }) as Record<string, unknown>,
      observedAt: input.trace.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.gameProviderSpendEntries.id });

  if (inserted.length > 0) {
    await rebuildGameCostRollups(db, input.gameId);
  }

  return { inserted: inserted.length > 0, sourceKey };
}

async function repriceTotalOnlyStaticEstimateRows(
  tx: CostAccountingTx,
  gameId: string,
): Promise<number> {
  const rows = await tx
    .select()
    .from(schema.gameProviderSpendEntries)
    .where(and(
      eq(schema.gameProviderSpendEntries.gameId, gameId),
      eq(schema.gameProviderSpendEntries.captureSource, "trace_manifest_backfill"),
      eq(schema.gameProviderSpendEntries.costSource, "static_estimate"),
      sql`COALESCE(${schema.gameProviderSpendEntries.actualCostMicrousd}, 0) = 0`,
      sql`COALESCE(${schema.gameProviderSpendEntries.estimatedCostMicrousd}, 0) = 0`,
      sql`${schema.gameProviderSpendEntries.totalTokens} > 0`,
      sql`${schema.gameProviderSpendEntries.promptTokens} = 0`,
      sql`${schema.gameProviderSpendEntries.cachedTokens} = 0`,
      sql`${schema.gameProviderSpendEntries.completionTokens} = 0`,
      sql`${schema.gameProviderSpendEntries.modelName} IS NOT NULL`,
    ));

  let repriced = 0;
  for (const row of rows) {
    if (!row.modelName) continue;
    const estimatedCostMicrousd = estimateMicrousd({
      promptTokens: row.promptTokens,
      cachedTokens: row.cachedTokens,
      completionTokens: row.completionTokens,
      reasoningTokens: row.reasoningTokens,
      totalTokens: row.totalTokens,
    }, row.modelName);
    if (!estimatedCostMicrousd || estimatedCostMicrousd <= 0) continue;

    const existingDiagnostics = asRecord(row.diagnostics);
    const existingItems = Array.isArray(existingDiagnostics?.items)
      ? existingDiagnostics.items.map((item) => String(item))
      : [];
    await tx
      .update(schema.gameProviderSpendEntries)
      .set({
        estimatedCostMicrousd,
        pricingSourceId: row.pricingSourceId ?? PRICING_SOURCE_ID,
        rateCardVersion: row.rateCardVersion ?? RATE_CARD_VERSION,
        pricedAt: row.pricedAt ?? row.observedAt ?? new Date().toISOString(),
        diagnostics: sanitizeForAccounting({
          ...existingDiagnostics,
          items: [...new Set([...existingItems, "aggregate_usage_estimate", "repriced_existing_backfill"])],
        }) as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.gameProviderSpendEntries.id, row.id));
    repriced += 1;
  }

  return repriced;
}

function parseTokenUsageSnapshot(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) ?? null;
  } catch {
    return null;
  }
}

export async function backfillGameCostAccounting(
  db: DrizzleDB,
  gameId: string,
  options: { actorUserId?: string } = {},
): Promise<BackfillGameCostResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('game_cost_rollups'), hashtext(${gameId}))`);

    const diagnostics: string[] = [];
    let inserted = 0;
    let skipped = 0;

    const manifests = await tx
      .select()
      .from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, gameId),
        eq(schema.gameEvidenceManifests.evidenceType, "private_decision_trace"),
      ));

    const representedManifestRows = await tx
      .select({ traceManifestId: schema.gameProviderSpendEntries.traceManifestId })
      .from(schema.gameProviderSpendEntries)
      .where(and(
        eq(schema.gameProviderSpendEntries.gameId, gameId),
        sql`${schema.gameProviderSpendEntries.traceManifestId} IS NOT NULL`,
      ));
    const representedManifestIds = new Set(
      representedManifestRows
        .map((row) => row.traceManifestId)
        .filter((id): id is string => Boolean(id)),
    );

    for (const manifest of manifests) {
      if (representedManifestIds.has(manifest.id)) {
        skipped += 1;
        continue;
      }

      const metadata = asRecord(manifest.metadata);
      const usage = asRecord(metadata?.usage);
      if (!usage) {
        skipped += 1;
        diagnostics.push("trace_manifest:missing_usage");
        continue;
      }
      const model = asRecord(metadata?.model);
      const actor = asRecord(metadata?.actor);
      const usageEnvelope: NonNullable<PrivateDecisionTrace["usage"]> = {
        promptTokens: integerish(usage.promptTokens) ?? 0,
        cachedTokens: integerish(usage.cachedTokens) ?? 0,
        completionTokens: integerish(usage.completionTokens) ?? 0,
        reasoningTokens: integerish(usage.reasoningTokens) ?? 0,
        totalTokens: integerish(usage.totalTokens) ?? 0,
        routerBilling: asRecord(usage.routerBilling),
        diagnostics: Array.isArray(usage.diagnostics)
          ? usage.diagnostics.map((item) => String(item))
          : undefined,
      };
      const routerBilling = asRecord(usageEnvelope.routerBilling);
      const actualCostMicrousd = extractRouterActualMicrousd(routerBilling);
      const modelName = safeString(metadata?.modelName) ?? safeString(model?.name);
      const estimatedCostMicrousd = actualCostMicrousd === undefined && modelName
        ? estimateMicrousd(usageEnvelope, modelName)
        : undefined;
      const providerNative = extractProviderNative(routerBilling);
      const costSource: SpendInsert["costSource"] =
        actualCostMicrousd !== undefined
          ? "router_actual"
          : estimatedCostMicrousd !== undefined
            ? "static_estimate"
            : "unavailable";
      const diagnosticItems = [
        ...(costSource === "unavailable" ? ["cost_unavailable"] : []),
        ...(costSource === "static_estimate" && usesTotalOnlyPricingFallback(usageEnvelope) ? ["aggregate_usage_estimate"] : []),
      ];

      const rows = await tx.insert(schema.gameProviderSpendEntries)
        .values({
          id: randomUUID(),
          gameId,
          ownerEpoch: manifest.ownerEpoch,
          eventSequence: positiveInteger(manifest.eventSequence),
          sourceKey: `manifest:${manifest.id}`,
          captureSource: "trace_manifest_backfill",
          costSource,
          callStatus: "unknown",
          traceManifestId: manifest.id,
          actorId: safeString(actor?.id),
          actorName: safeString(actor?.name),
          actorRole: safeString(actor?.role),
          action: safeString(metadata?.action),
          phase: safeString(metadata?.phase),
          round: integerish(metadata?.round),
          provider: safeString(model?.provider),
          providerProfileId: safeString(model?.providerProfileId),
          catalogId: safeString(model?.catalogId),
          modelName,
          requestedReasoningEffort: safeString(metadata?.requestedReasoningEffort),
          reasoningPolicy: safeString(metadata?.reasoningPolicy),
          promptTokens: usageEnvelope.promptTokens ?? 0,
          cachedTokens: usageEnvelope.cachedTokens ?? 0,
          completionTokens: usageEnvelope.completionTokens ?? 0,
          reasoningTokens: usageEnvelope.reasoningTokens ?? 0,
          totalTokens: usageEnvelope.totalTokens ?? 0,
          actualCostMicrousd,
          estimatedCostMicrousd,
          providerNativeUnit: providerNative.unit,
          providerNativeAmount: providerNative.amount,
          pricingSourceId: estimatedCostMicrousd !== undefined ? PRICING_SOURCE_ID : undefined,
          rateCardVersion: estimatedCostMicrousd !== undefined ? RATE_CARD_VERSION : undefined,
          pricedAt: estimatedCostMicrousd !== undefined ? manifest.createdAt : undefined,
          routerBilling: sanitizeForAccounting(routerBilling) as Record<string, unknown> | undefined,
          diagnostics: sanitizeForAccounting({ items: diagnosticItems }) as Record<string, unknown>,
          observedAt: safeString(metadata?.createdAt) ?? manifest.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.gameProviderSpendEntries.id });
      inserted += rows.length;
      if (rows.length === 0) {
        skipped += 1;
      } else {
        representedManifestIds.add(manifest.id);
      }
    }

    const repriced = await repriceTotalOnlyStaticEstimateRows(tx, gameId);
    if (repriced > 0) diagnostics.push("trace_manifest:repriced_aggregate_usage_rows");

    const callLevelRows = await tx
      .select({ id: schema.gameProviderSpendEntries.id })
      .from(schema.gameProviderSpendEntries)
      .where(and(
        eq(schema.gameProviderSpendEntries.gameId, gameId),
        sql`${schema.gameProviderSpendEntries.captureSource} <> 'terminal_result_backfill'`,
      ))
      .limit(1);

    const result = (await tx
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, gameId)))[0];
    if (result && callLevelRows.length > 0) {
      const removedTerminalRows = await tx
        .delete(schema.gameProviderSpendEntries)
        .where(and(
          eq(schema.gameProviderSpendEntries.gameId, gameId),
          eq(schema.gameProviderSpendEntries.captureSource, "terminal_result_backfill"),
        ))
        .returning({ id: schema.gameProviderSpendEntries.id });
      if (removedTerminalRows.length > 0) {
        diagnostics.push("terminal_result:removed_after_call_level_rows");
      }
      skipped += 1;
      diagnostics.push("terminal_result:skipped_call_level_rows_present");
    } else if (result) {
      const snapshot = parseTokenUsageSnapshot(result.tokenUsage);
      const totalTokens = integerish(snapshot?.totalTokens);
      if (!snapshot || totalTokens === undefined) {
        skipped += 1;
        diagnostics.push("terminal_result:unusable_token_usage");
      } else {
        const promptTokens = integerish(snapshot.promptTokens) ?? 0;
        const cachedTokens = integerish(snapshot.cachedTokens) ?? 0;
        const completionTokens = integerish(snapshot.completionTokens) ?? Math.max(0, totalTokens - promptTokens);
        const reasoningTokens = integerish(snapshot.reasoningTokens) ?? 0;
        const estimatedCostValue = finiteNumber(snapshot.estimatedCost);
        const estimatedCostMicrousd = estimatedCostValue === undefined
          ? undefined
          : Math.max(0, Math.round(estimatedCostValue * 1_000_000));
        const rows = await tx.insert(schema.gameProviderSpendEntries)
          .values({
            id: randomUUID(),
            gameId,
            sourceKey: `terminal-result:${gameId}`,
            captureSource: "terminal_result_backfill",
            costSource: estimatedCostMicrousd !== undefined ? "static_estimate" : "unavailable",
            callStatus: "unknown",
            action: "terminal_result_aggregate",
            promptTokens,
            cachedTokens,
            completionTokens,
            reasoningTokens,
            totalTokens,
            estimatedCostMicrousd,
            pricingSourceId: estimatedCostMicrousd !== undefined ? "legacy.game_results.tokenUsage" : undefined,
            rateCardVersion: estimatedCostMicrousd !== undefined ? "legacy" : undefined,
            pricedAt: result.finishedAt,
            diagnostics: sanitizeForAccounting({
              items: estimatedCostMicrousd === undefined ? ["terminal_result_cost_unavailable"] : ["terminal_result_aggregate"],
            }) as Record<string, unknown>,
            observedAt: result.finishedAt,
          })
          .onConflictDoNothing()
          .returning({ id: schema.gameProviderSpendEntries.id });
        inserted += rows.length;
        if (rows.length === 0) skipped += 1;
      }
    }

    const safeDiagnostics = [...new Set(diagnostics)];
    await rebuildGameCostRollupsInTransaction(tx, gameId, false);
    await tx.insert(schema.gameCostAccountingAuditEvents).values({
      id: randomUUID(),
      gameId,
      actorUserId: options.actorUserId,
      action: "backfill_game",
      outcome: "succeeded",
      safeMetadata: sanitizeForAccounting({ inserted, skipped, diagnostics: safeDiagnostics }) as Record<string, unknown>,
    });
    return { gameId, inserted, skipped, rebuilt: true, diagnostics: safeDiagnostics };
  });
}

export async function getGameCostSummaryMap(
  db: DrizzleDB,
  gameIds: string[],
): Promise<Map<string, AdminGameCostSummary>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.gameCostRollups)
    .where(and(
      eq(schema.gameCostRollups.rollupScope, "game"),
      inArray(schema.gameCostRollups.gameId, gameIds),
    ));
  const map = new Map<string, AdminGameCostSummary>();
  for (const row of rows) {
    map.set(row.gameId, {
      callCount: row.callCount,
      failedCallCount: row.failedCallCount,
      unpricedCallCount: row.unpricedCallCount,
      promptTokens: row.promptTokens,
      cachedTokens: row.cachedTokens,
      completionTokens: row.completionTokens,
      reasoningTokens: row.reasoningTokens,
      totalTokens: row.totalTokens,
      actualCostMicrousd: row.actualCostMicrousd,
      estimatedCostMicrousd: row.estimatedCostMicrousd,
      costCurrency: "USD",
      costSourceCounts: recordOfNumbers(row.costSourceCounts),
      captureSourceCounts: recordOfNumbers(row.captureSourceCounts),
      providerNativeTotals: recordOfNumbers(row.providerNativeTotals),
      lastEntryAt: row.lastEntryAt ?? undefined,
      state: costStateFor(row),
    });
  }
  return map;
}

export async function getGameCostDetail(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<{ ok: true; detail: AdminGameCostDetail } | { ok: false; statusCode: 404; error: string }> {
  const game = (await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(sql`${schema.games.id} = ${idOrSlug} OR ${schema.games.slug} = ${idOrSlug}`))[0];
  if (!game) return { ok: false, statusCode: 404, error: "Game not found" };

  const entries = await db
    .select()
    .from(schema.gameProviderSpendEntries)
    .where(eq(schema.gameProviderSpendEntries.gameId, game.id));
  const gameSummary = summaryFromEntries(entries);
  const ownerEpochBreakdowns = [...new Set(entries.map((entry) => entry.ownerEpoch).filter((value): value is string => Boolean(value)))]
    .map((ownerEpoch) => {
      const { breakdowns: _breakdowns, ...summary } =
        summaryFromEntries(entries.filter((entry) => entry.ownerEpoch === ownerEpoch));
      return { ownerEpoch, summary };
    });
  const expensiveCalls = [...entries]
    .sort((a, b) => ((b.actualCostMicrousd ?? b.estimatedCostMicrousd ?? 0) - (a.actualCostMicrousd ?? a.estimatedCostMicrousd ?? 0)))
    .slice(0, 10)
    .map((entry) => ({
      actorName: entry.actorName,
      actorRole: entry.actorRole,
      action: entry.action,
      phase: entry.phase,
      round: entry.round,
      provider: entry.provider,
      modelName: entry.modelName,
      costSource: entry.costSource,
      actualCostMicrousd: entry.actualCostMicrousd,
      estimatedCostMicrousd: entry.estimatedCostMicrousd,
      totalTokens: entry.totalTokens,
      callStatus: entry.callStatus,
    }));
  const retryEntries = entries.filter((entry) => entry.retryParentSourceKey);
  const failedEntries = entries.filter((entry) => entry.callStatus === "failed");
  const reconciliations = await db
    .select()
    .from(schema.gameCostReconciliations)
    .where(eq(schema.gameCostReconciliations.gameId, game.id));

  return {
    ok: true,
    detail: {
      ...gameSummary,
      gameId: game.id,
      ownerEpochBreakdowns,
      breakdowns: gameSummary.breakdowns,
      expensiveCalls,
      retryFailureSpend: {
        failedCallCount: failedEntries.length,
        retryCallCount: retryEntries.length,
        actualCostMicrousd: [...failedEntries, ...retryEntries].reduce((sum, entry) => sum + (entry.actualCostMicrousd ?? 0), 0),
        estimatedCostMicrousd: [...failedEntries, ...retryEntries].reduce((sum, entry) => sum + (entry.estimatedCostMicrousd ?? 0), 0),
      },
      backfill: {
        traceBackfilledEntries: entries.filter((entry) => entry.captureSource === "trace_manifest_backfill").length,
        terminalBackfilledEntries: entries.filter((entry) => entry.captureSource === "terminal_result_backfill").length,
        hasTerminalAggregate: entries.some((entry) => entry.captureSource === "terminal_result_backfill"),
      },
      pricing: {
        rateCardVersions: [...new Set(entries.map((entry) => entry.rateCardVersion).filter((value): value is string => Boolean(value)))],
        pricingSourceIds: [...new Set(entries.map((entry) => entry.pricingSourceId).filter((value): value is string => Boolean(value)))],
        pricedAt: [...new Set(entries.map((entry) => entry.pricedAt).filter((value): value is string => Boolean(value)))],
      },
      reconciliation: reconciliations.map((row) => ({
        id: row.id,
        provider: row.provider,
        status: row.status,
        reconciliationSource: row.reconciliationSource,
        internalActualCostMicrousd: row.internalActualCostMicrousd,
        internalEstimatedCostMicrousd: row.internalEstimatedCostMicrousd,
        providerActualCostMicrousd: row.providerActualCostMicrousd,
        deltaMicrousd: row.deltaMicrousd,
        costCurrency: row.costCurrency,
        reconciledAt: row.reconciledAt,
      })),
    },
  };
}
