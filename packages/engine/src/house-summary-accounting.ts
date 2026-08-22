import type {
  HouseProviderUsage,
  HouseSummaryActorCoordinate,
  HouseSummaryPhaseReceipt,
} from "./house-summary-frontier";
import {
  MODEL_PRICING,
  OPENAI_FLEX_MODEL_PRICING,
  estimateCost,
  type TokenUsage,
} from "./token-tracker";

export const HOUSE_SUMMARY_NEAR_BUDGET_RATIO = 1.25;

export interface HouseSummaryCostLine {
  callId: string;
  serviceTier: string;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export type HouseSummaryCostResult =
  | {
      status: "exact";
      model: string;
      providerCalls: number;
      promptTokens: number;
      cachedTokens: number;
      cacheWriteTokens: number;
      completionTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      totalCostUsd: number;
      calls: HouseSummaryCostLine[];
    }
  | {
      status: "inconclusive";
      model: string;
      providerCalls: number;
      reasons: string[];
    };

export interface HouseSummaryBoundaryCost {
  boundaryId: string;
  actorCoordinate: HouseSummaryActorCoordinate;
  status: HouseSummaryPhaseReceipt["status"];
  accounting: HouseSummaryCostResult;
}

export interface HouseSummaryGameCost {
  accounting: HouseSummaryCostResult;
  boundaries: HouseSummaryBoundaryCost[];
}

export function isHouseSummaryCostWithinEnvelope(
  candidateCostUsd: number,
  roundOnlyBaselineCostUsd: number,
  maxRatio = HOUSE_SUMMARY_NEAR_BUDGET_RATIO,
): boolean {
  return Number.isFinite(candidateCostUsd)
    && Number.isFinite(roundOnlyBaselineCostUsd)
    && Number.isFinite(maxRatio)
    && candidateCostUsd >= 0
    && roundOnlyBaselineCostUsd > 0
    && maxRatio > 0
    && candidateCostUsd <= roundOnlyBaselineCostUsd * maxRatio;
}

function exactUsage(entry: HouseProviderUsage): TokenUsage | null {
  if (
    entry.responseId === null
    || entry.promptTokens === null
    || entry.cachedTokens === null
    || entry.cacheWriteTokens === null
    || entry.completionTokens === null
    || entry.reasoningTokens === null
    || entry.totalTokens === null
  ) return null;
  return {
    promptTokens: entry.promptTokens,
    cachedTokens: entry.cachedTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    completionTokens: entry.completionTokens,
    reasoningTokens: entry.reasoningTokens,
    totalTokens: entry.totalTokens,
    callCount: 1,
    emptyResponses: 0,
  };
}

export function costHouseProviderUsage(
  usage: readonly HouseProviderUsage[],
  model: string,
  expectedProviderCalls = usage.length,
): HouseSummaryCostResult {
  const reasons = new Set<string>();
  const standardPricing = MODEL_PRICING[model];
  if (!standardPricing) reasons.add("missing_model_pricing");
  if (usage.length !== expectedProviderCalls) reasons.add("provider_call_count_mismatch");
  if (new Set(usage.map((entry) => entry.callId)).size !== usage.length) reasons.add("duplicate_call_id");

  const calls: HouseSummaryCostLine[] = [];
  for (const entry of usage) {
    const tokens = exactUsage(entry);
    if (!tokens) {
      reasons.add("missing_provider_usage");
      continue;
    }
    if (!entry.serviceTier) {
      reasons.add("missing_service_tier");
      continue;
    }
    const pricing = entry.serviceTier === "flex"
      ? OPENAI_FLEX_MODEL_PRICING[model]
      : standardPricing;
    if (!pricing) {
      reasons.add(entry.serviceTier === "flex" ? "missing_flex_pricing" : "missing_model_pricing");
      continue;
    }
    calls.push({
      callId: entry.callId,
      serviceTier: entry.serviceTier,
      promptTokens: tokens.promptTokens,
      cachedTokens: tokens.cachedTokens,
      cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
      completionTokens: tokens.completionTokens,
      reasoningTokens: tokens.reasoningTokens,
      totalTokens: tokens.totalTokens,
      costUsd: estimateCost(tokens, pricing).totalCost,
    });
  }

  if (reasons.size > 0 || calls.length !== expectedProviderCalls) {
    if (calls.length !== expectedProviderCalls) reasons.add("unpriced_provider_call");
    return {
      status: "inconclusive",
      model,
      providerCalls: expectedProviderCalls,
      reasons: [...reasons].sort(),
    };
  }

  return {
    status: "exact",
    model,
    providerCalls: expectedProviderCalls,
    promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
    cachedTokens: calls.reduce((sum, call) => sum + call.cachedTokens, 0),
    cacheWriteTokens: calls.reduce((sum, call) => sum + call.cacheWriteTokens, 0),
    completionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    reasoningTokens: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
    totalTokens: calls.reduce((sum, call) => sum + call.totalTokens, 0),
    totalCostUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    calls,
  };
}

export function costHouseSummaryGame(
  receipts: readonly HouseSummaryPhaseReceipt[],
  model: string,
): HouseSummaryGameCost {
  const boundaries = receipts.map((receipt) => ({
    boundaryId: receipt.boundaryId,
    actorCoordinate: receipt.actorCoordinate,
    status: receipt.status,
    accounting: costHouseProviderUsage(receipt.usage, model, receipt.providerCalls),
  }));
  const usage = receipts.flatMap((receipt) => receipt.usage);
  const expectedProviderCalls = receipts.reduce((sum, receipt) => sum + receipt.providerCalls, 0);
  return {
    accounting: costHouseProviderUsage(usage, model, expectedProviderCalls),
    boundaries,
  };
}
