import { createHash } from "node:crypto";
import { createLlmProviderRuntimesFromEnv, type LlmProviderRuntime } from "../llm-client";
import { resolveProviderManifest } from "../model-catalog";
import { executeModelInvocation } from "../provider-adapters";
import { ProviderExecutionCoordinator, ProviderAttemptError, type ProviderAttemptIntent, type ProviderAttemptRecord } from "../provider-execution";
import { createExactStructuredOutputArtifact, type StructuredDomainDecodeResult } from "../structured-output";
import { estimateCostForKnownModel, estimateTierAwareOpenAICost } from "../token-tracker";
import { CUT_EDITORIAL_MODEL, CUT_EDITORIAL_VERSION, CUT_EDITORIAL_PROMPT, CUT_PROPOSAL_SCHEMA, discoverCuts, planCutDiscovery, type DiscoveryReport } from "./editorial";
import { CUT_SELECTION_PROMPT, CUT_SELECTION_SCHEMA, validateCutSelection } from "./selection";
import type { CutSource } from "./source";

export const CUT_TRIAL_LIMITS = { maxCalls: 40, maxInputBytesPerCall: 32_000, maxOutputTokensPerCall: 4_000 };
export interface CutTrialAttempt {
  windowId: string;
  reservedUsd: number;
  intent: ProviderAttemptIntent;
  terminal?: ProviderAttemptRecord;
  estimatedCostUsd?: number | null;
}
export interface CutTrialJournal {
  version: 1;
  binding: string;
  budgetUsd: number;
  attempts: CutTrialAttempt[];
}
function binding(source: CutSource) {
  return createHash("sha256").update(JSON.stringify({ source, version: CUT_EDITORIAL_VERSION, model: CUT_EDITORIAL_MODEL, prompt: CUT_EDITORIAL_PROMPT, schema: CUT_PROPOSAL_SCHEMA, selectionPrompt: CUT_SELECTION_PROMPT, selectionSchema: CUT_SELECTION_SCHEMA, limits: CUT_TRIAL_LIMITS })).digest("hex");
}
export function newCutTrialJournal(source: CutSource, budgetUsd: number): CutTrialJournal {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("A positive trial budget is required");
  planCutDiscovery(source, CUT_TRIAL_LIMITS);
  return { version: 1, binding: binding(source), budgetUsd, attempts: [] };
}

/** Unknown/failed transport usage retains the full reservation; never call it free. */
export function cutTrialSpend(journal: CutTrialJournal) {
  return journal.attempts.reduce((n, a) => n + (a.estimatedCostUsd ?? a.reservedUsd), 0);
}
function reserveCost(inputBytes: number, outputTokens: number) {
  // One token per UTF-8 byte plus envelope allowance deliberately over-reserves input.
  const promptTokens = inputBytes + 2048;
  const estimate = estimateCostForKnownModel({ promptTokens, cachedTokens: 0, completionTokens: outputTokens,
    reasoningTokens: 0, totalTokens: promptTokens + outputTokens, callCount: 1, emptyResponses: 0 }, "gpt-6-luna");
  if (!estimate) throw new Error("Missing editorial model pricing");
  return estimate.totalCost;
}
function cost(record: ProviderAttemptRecord): number | null {
  const facts = record.accounting;
  if (facts?.actualCostMicrousd !== undefined) return facts.actualCostMicrousd / 1_000_000;
  const u = facts?.usage;
  if (u?.promptTokens === undefined || u.completionTokens === undefined) return null;
  const tier = facts?.effectiveServiceTier;
  if (tier !== "flex" && tier !== "auto" && tier !== "default") return null;
  return estimateTierAwareOpenAICost({ [tier]: { promptTokens: u.promptTokens, completionTokens: u.completionTokens,
    cachedTokens: u.cachedTokens ?? 0, reasoningTokens: u.reasoningTokens ?? 0, totalTokens: u.totalTokens ?? u.promptTokens + u.completionTokens,
    callCount: 1, emptyResponses: 0 } }, "gpt-6-luna")?.totalCost ?? null;
}
interface TrialInvocation<T> {
  prompt: string; schema: Record<string, unknown>; window: { id: string }; maxOutputTokens: number;
  accept: (value: unknown) => T;
}
function artifact<T>(request: TrialInvocation<T>) {
  const decode = (value: unknown): StructuredDomainDecodeResult<T> => {
    try { return { status: "valid", value: request.accept(value) }; }
    catch (error) { return { status: "invalid", message: error instanceof Error ? error.message : "Invalid editorial output" }; }
  };
  return createExactStructuredOutputArtifact<unknown, T>({ action: CUT_EDITORIAL_VERSION,
    name: "house_cut_candidates", schema: request.schema, acceptedValueUsesProviderSchema: true,
    decodeProviderPayload: decode, decodeAcceptedValue: decode });
}
export function createCutTrialRuntimes(env: NodeJS.ProcessEnv = process.env) {
  const runtimes = createLlmProviderRuntimesFromEnv(resolveProviderManifest([{ catalogId: CUT_EDITORIAL_MODEL, reasoningPolicy: "low" }]), env,
    { timeout: 120_000, maxRetries: 0 });
  if (!runtimes) throw new Error("OpenAI credentials are required for an explicitly approved trial");
  return runtimes;
}

/** Local operator trial using shared native structured execution. Save must atomically persist before dispatch. */
export async function runCutTrial(options: {
  source: CutSource; journal: CutTrialJournal; runtimes: readonly LlmProviderRuntime[];
  save: (journal: CutTrialJournal) => Promise<void>; progress?: (message: string) => void; signal?: AbortSignal;
}) {
  const { source, journal, runtimes } = options;
  if (journal.version !== 1 || journal.binding !== binding(source) || !Number.isFinite(journal.budgetUsd) || journal.budgetUsd <= 0) throw new Error("Trial source, policy or budget mismatch");
  if (runtimes.length !== 1 || runtimes[0]?.catalogId !== CUT_EDITORIAL_MODEL) throw new Error("Editorial trial requires its approved model");
  if (journal.attempts.some(a => !a.terminal)) throw new Error("A prior dispatch has an unknown outcome. Inspect the journal before starting another trial; it may have incurred cost.");
  const plan = planCutDiscovery(source, CUT_TRIAL_LIMITS);
  const remaining = plan.windows.filter(w => !journal.attempts.some(a => a.windowId === w.id && a.terminal?.acceptedValue !== undefined));
  const upper = remaining.reduce((n, w) => n + 3 * reserveCost(Buffer.byteLength(JSON.stringify(w)) + 8000, plan.maxOutputTokensPerCall), 0);
  if (cutTrialSpend(journal) + upper > journal.budgetUsd) throw new Error(`Full trial with retries exceeds $${journal.budgetUsd} budget. No calls started.`);
  return discoverCuts(source, request => executeCutTrialInvocation(options, request), CUT_TRIAL_LIMITS);
}

export async function executeCutTrialInvocation<T>(options: {
  source: CutSource; journal: CutTrialJournal; runtimes: readonly LlmProviderRuntime[];
  save: (journal: CutTrialJournal) => Promise<void>; progress?: (message: string) => void; signal?: AbortSignal;
}, request: TrialInvocation<T>) {
    const { source, journal, runtimes, save, progress } = options;
    if (journal.version !== 1 || journal.binding !== binding(source) || !Number.isFinite(journal.budgetUsd) || journal.budgetUsd <= 0) throw new Error("Trial policy or budget mismatch");
    if (runtimes.length !== 1 || runtimes[0]?.catalogId !== CUT_EDITORIAL_MODEL) throw new Error("Editorial execution requires its approved model");
    if (journal.attempts.some(a => !a.terminal)) throw new Error("Unknown prior dispatch; do not retry blindly");
    progress?.(request.window.id);
    const attempts = () => journal.attempts.filter(a => a.windowId === request.window.id);
    const capacityFallback = () => attempts().length === 2 && attempts().every(a => a.terminal?.outcome.kind === "rate_limit");
    const coordinator = new ProviderExecutionCoordinator({ hooks: {
      onReadAccepted() {
        const accepted = attempts().find(a => a.terminal?.acceptedValue !== undefined)?.terminal;
        return accepted ? { attemptId: accepted.attemptId, attemptOrdinal: accepted.attemptOrdinal,
          catalogId: CUT_EDITORIAL_MODEL, value: accepted.acceptedValue } : undefined;
      },
      onAllocateAttemptOrdinal() { return attempts().length + 1; },
      async onReserve(intent) {
        options.signal?.throwIfAborted();
        if (attempts().length >= 2 && !capacityFallback()) throw new Error("Window attempt budget exhausted; inspect failed attempts");
        const reservedUsd = reserveCost(Buffer.byteLength(JSON.stringify(intent.preparedRequest.body)), request.maxOutputTokens);
        if (cutTrialSpend(journal) + reservedUsd > journal.budgetUsd) throw new Error("Editorial trial cost ceiling reached");
        journal.attempts.push({ windowId: request.window.id, intent, reservedUsd });
        await save(journal);
      },
      async onTerminal(record) {
        const attempt = journal.attempts.find(a => a.intent.attemptId === record.attemptId);
        if (!attempt) throw new Error("Unreserved editorial attempt");
        attempt.terminal = record;
        attempt.estimatedCostUsd = cost(record);
        await save(journal);
        return { acceptedAttemptId: record.acceptedValue === undefined ? undefined : record.attemptId };
      },
    } });
    const call = coordinator.startCall({ gameId: source.game.id, actor: { name: "House Cuts editor", role: "producer" },
      action: "house_cut_discovery", semantic: { version: 1, kind: "house_cut_discovery", sourceHash: source.hash,
        windowId: request.window.id, editorialVersion: CUT_EDITORIAL_VERSION } });
    const execute = (standard: boolean) => executeModelInvocation({ call, runtimes: standard ? [{ ...runtimes[0]!, openAIServiceTier: "auto" }] : runtimes, maxAttempts: standard ? 1 : 2, requestSignalFactory: () => options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      invocation: { messages: [{ role: "system", content: request.prompt }, { role: "user", content: JSON.stringify(request.window) }],
        result: { kind: "structured", artifact: artifact(request) }, outputTokenLimit: request.maxOutputTokens, reasoning: { effort: "low" } },
      validate: (_outcome, value) => value ? { status: "usable", value }
        : { status: "unusable", kind: "undecodable_structured_output", message: "Missing Cut batch" },
    });
    let result;
    try { result = await execute(capacityFallback()); }
    catch (error) {
      if (!(error instanceof ProviderAttemptError) || error.outcome.kind !== "rate_limit" || !capacityFallback()) throw error;
      progress?.(`${request.window.id}: Flex capacity unavailable; trying standard processing once`);
      result = await execute(true);
    }
    const rows = attempts();
    const costUsd = rows.some(a => a.estimatedCostUsd == null) ? null : rows.reduce((n, a) => n + a.estimatedCostUsd!, 0);
    return { decoded: result.value, kind: "provider" as const, costUsd };

}


export async function runAutomaticCutTrial(options: Parameters<typeof runCutTrial>[0]): Promise<{ report: DiscoveryReport; selectedKeys: string[] }> {
  const report = await runCutTrial(options);
  if (!report.candidates.length) return { report, selectedKeys: [] };
  const window = { id: "selection", audience: report.source.audience, cast: report.source.cast,
    candidates: report.candidates.map(c => ({ key: c.key, proposal: c.proposal })), evidence: report.source.evidence };
  if (Buffer.byteLength(JSON.stringify(window)) > 128_000) throw new Error("Selection context exceeds budget; no incomplete selection published");
  const selected = await executeCutTrialInvocation(options, { prompt: CUT_SELECTION_PROMPT, schema: CUT_SELECTION_SCHEMA,
    window, maxOutputTokens: 1000, accept: value => {
      const selectedKeys = validateCutSelection(value, report);
      return { selectedKeys };
    } });
  return { report, selectedKeys: selected.decoded.selectedKeys };
}
