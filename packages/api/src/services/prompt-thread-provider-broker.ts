import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import {
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  type ProviderResultArtifact,
} from "@influence/prompt-lab-protocol";
import {
  appendCellTransition,
  atomicWriteArtifact,
  recordCellProviderResult,
  invalidateRunUnderLock,
  type RunMutationLock,
} from "./prompt-thread-workspace.js";

/** The only model snapshot accepted by the first paid prompt-thread panel. */
export const PROMPT_THREAD_PANEL_MODEL = "gpt-5.4-nano-2026-03-17";
export const PROMPT_THREAD_MAX_PROVIDER_ATTEMPTS = 28;

export interface PromptThreadBrokerCell {
  cellId: string;
  ordinal: number;
  actorId: string;
  lineage: string;
  firstCall?: boolean;
  requestedServiceTier?: "flex" | "auto";
  /** Approved character-derived input-token ceiling for this exact provider cell. */
  estimatedInputTokens?: number;
  /** Approved maximum Responses output-token ceiling for this exact provider cell. */
  maxOutputTokens?: number;
  maxCostUsd?: number;
  controlReturnTurn?: boolean;
}

export interface PromptThreadBrokerRequest {
  cellId: string;
  model: string;
  request: Record<string, unknown>;
}

export interface PromptThreadBrokerReceipt {
  cellId: string;
  requestDigest: string;
  responseId?: string;
  requestId?: string;
  effectiveServiceTier?: string;
  elapsedMs: number;
  cachedInputTokens: number;
  costUsd: number;
  controlPrefixBeforeDigest?: string;
  controlPrefixAfterDigest?: string;
}

interface PreparedBrokerRequest {
  cell: PromptThreadBrokerCell;
  request: Record<string, unknown>;
  requestDigest: string;
  controlPrefixBeforeDigest?: string;
  controlPrefixAfterDigest?: string;
}

export type PromptThreadProviderDispatch = (
  request: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;
export interface PromptThreadBrokerPolicy {
  model?: string;
  requestKind?: "panel" | "curator";
  completedCellIds?: readonly string[];
}

export class PromptThreadBrokerError extends Error {
  constructor(readonly code: "unplanned_cell" | "out_of_order" | "duplicate_cell" | "attempt_cap" | "model_drift" | "invalid_response" | "invalid_request" | "cache_contaminated" | "tier_mismatch" | "spend_cap") {
    super(`Prompt-thread broker rejected request: ${code}`);
  }
}

/**
 * Orchestrator-owned provider seam. Workers hand it final Responses requests;
 * it alone journals the no-retry boundary and returns only a complete response.
 */
export class PromptThreadProviderBroker {
  private readonly cells = new Map<string, PromptThreadBrokerCell>();
  private readonly dispatched = new Set<string>();
  private nextOrdinal = 1;
  private readonly maxSpendUsd: number;
  private reservedSpendUsd = 0;
  private readonly model: string;
  private readonly requestKind: "panel" | "curator";

  constructor(
    cells: readonly PromptThreadBrokerCell[],
    maxSpendUsd = Number.POSITIVE_INFINITY,
    policy: PromptThreadBrokerPolicy = {},
  ) {
    if (cells.length > PROMPT_THREAD_MAX_PROVIDER_ATTEMPTS) {
      throw new PromptThreadBrokerError("attempt_cap");
    }
    for (const cell of cells) {
      if (this.cells.has(cell.cellId)) throw new PromptThreadBrokerError("duplicate_cell");
      this.cells.set(cell.cellId, { ...cell });
      this.reservedSpendUsd += cell.maxCostUsd ?? 0;
    }
    this.maxSpendUsd = maxSpendUsd;
    this.model = policy.model ?? PROMPT_THREAD_PANEL_MODEL;
    this.requestKind = policy.requestKind ?? "panel";
    const completedCellIds = new Set(policy.completedCellIds ?? []);
    for (const cell of [...this.cells.values()].sort((left, right) => left.ordinal - right.ordinal)) {
      if (completedCellIds.has(cell.cellId)) {
        if (cell.ordinal !== this.nextOrdinal) {
          throw new PromptThreadBrokerError("out_of_order");
        }
        this.dispatched.add(cell.cellId);
        this.nextOrdinal += 1;
      } else {
        break;
      }
    }
    if (this.dispatched.size !== completedCellIds.size) {
      throw new PromptThreadBrokerError("out_of_order");
    }
    if (this.reservedSpendUsd > maxSpendUsd) throw new PromptThreadBrokerError("spend_cap");
  }

  prepare(request: PromptThreadBrokerRequest): PreparedBrokerRequest {
    if (request.model !== this.model) throw new PromptThreadBrokerError("model_drift");
    const cell = this.cells.get(request.cellId);
    if (!cell) throw new PromptThreadBrokerError("unplanned_cell");
    if (this.dispatched.has(cell.cellId)) throw new PromptThreadBrokerError("duplicate_cell");
    if (cell.ordinal !== this.nextOrdinal) throw new PromptThreadBrokerError("out_of_order");
    if (this.dispatched.size >= PROMPT_THREAD_MAX_PROVIDER_ATTEMPTS) {
      throw new PromptThreadBrokerError("attempt_cap");
    }
    const envelope = applyApprovedEnvelope(request.request, cell);
    const injected = this.requestKind === "panel"
      ? injectCacheMarker(envelope, cell.lineage)
      : envelope;
    const transformed = cell.controlReturnTurn
      ? applyCacheControl(injected, cell.lineage)
      : injected;
    return {
      cell,
      request: transformed,
      requestDigest: digest(transformed),
      ...(cell.controlReturnTurn && {
        controlPrefixBeforeDigest: digest(injected),
        controlPrefixAfterDigest: digest(transformed),
      }),
    };
  }

  recordComplete(prepared: PreparedBrokerRequest, response: unknown, elapsedMs: number): PromptThreadBrokerReceipt {
    const record = asRecord(response);
    if (record?.status !== "completed") throw new PromptThreadBrokerError("invalid_response");
    const usage = asRecord(record.usage);
    const inputDetails = asRecord(usage?.input_tokens_details);
    const cachedInputTokens = numberOrZero(inputDetails?.cached_tokens);
    if (prepared.cell.firstCall && cachedInputTokens > 0) throw new PromptThreadBrokerError("cache_contaminated");
    const effectiveTier = stringOrUndefined(record.service_tier);
    if (prepared.cell.requestedServiceTier && effectiveTier !== prepared.cell.requestedServiceTier) throw new PromptThreadBrokerError("tier_mismatch");
    this.dispatched.add(prepared.cell.cellId);
    this.nextOrdinal += 1;
    return {
      cellId: prepared.cell.cellId,
      requestDigest: prepared.requestDigest,
      responseId: stringOrUndefined(record.id),
      requestId: stringOrUndefined(record._request_id),
      effectiveServiceTier: effectiveTier,
      elapsedMs,
      cachedInputTokens,
      costUsd: prepared.cell.maxCostUsd ?? 0,
      ...(prepared.controlPrefixBeforeDigest && {
        controlPrefixBeforeDigest: prepared.controlPrefixBeforeDigest,
      }),
      ...(prepared.controlPrefixAfterDigest && {
        controlPrefixAfterDigest: prepared.controlPrefixAfterDigest,
      }),
    };
  }

  async dispatch(
    lock: RunMutationLock,
    input: PromptThreadBrokerRequest,
    send: PromptThreadProviderDispatch,
    options: { alreadyPlanned?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ response: unknown; receipt: PromptThreadBrokerReceipt }> {
    const prepared = this.prepare(input);
    validateFinalRequest(prepared.cell, prepared.request, {
      model: this.model,
      requestKind: this.requestKind,
    });
    const base = `runs/${lock.runId}/cells/${prepared.cell.cellId}`;
    const preparedArtifact = {
      protocolVersion: PROTOCOL_VERSION,
      schemaHash: PROTOCOL_SCHEMA_HASH,
      kind: "prepared_request" as const,
      createdAt: new Date().toISOString(),
      cellId: prepared.cell.cellId,
      requestHash: prepared.requestDigest,
      privateRequest: JSON.parse(JSON.stringify(prepared.request)),
    };
    if (!options.alreadyPlanned) {
      await appendCellTransition(lock, { cellId: prepared.cell.cellId, stage: "planned" });
    }
    await atomicWriteArtifact(lock, `${base}/prepared-request.json`, preparedArtifact);
    await appendCellTransition(lock, { cellId: prepared.cell.cellId, stage: "started" });
    const startedAt = performance.now();
    let response: unknown;
    try {
      response = await send(prepared.request, {
        ...(options.signal && { signal: options.signal }),
      });
    } catch {
      await invalidateRunUnderLock(lock, "provider_no_complete_response");
      throw new PromptThreadBrokerError("invalid_response");
    }
    let receipt: PromptThreadBrokerReceipt;
    try {
      receipt = this.recordComplete(prepared, response, Math.round(performance.now() - startedAt));
    } catch (error) {
      const reason = error instanceof PromptThreadBrokerError
        ? error.code
        : "provider_no_complete_response";
      await invalidateRunUnderLock(lock, reason);
      throw error;
    }
    try {
      const artifact: ProviderResultArtifact = {
        protocolVersion: PROTOCOL_VERSION,
        schemaHash: PROTOCOL_SCHEMA_HASH,
        kind: "provider_result",
        createdAt: new Date().toISOString(),
        cellId: prepared.cell.cellId,
        requestHash: prepared.requestDigest,
        status: "completed",
        privateResponse: JSON.parse(JSON.stringify({ response, receipt })),
      };
      await recordCellProviderResult(lock, prepared.cell.cellId, artifact);
    } catch (error) {
      await invalidateRunUnderLock(lock, "provider_result_persistence_failed");
      throw error;
    }
    return { response, receipt };
  }
}

function cacheControlMarker(
  lineage: string,
  variant: "v1" | "x1",
): string {
  return `[influence-cache-prefix:${variant}:${digest(lineage).slice("sha256:".length, 31)}]`;
}

function applyCacheControl(
  request: Record<string, unknown>,
  lineage: string,
): Record<string, unknown> {
  const copy = structuredClone(request);
  const instructions = typeof copy.instructions === "string" ? copy.instructions : null;
  const marker = cacheControlMarker(lineage, "v1");
  if (!instructions || !instructions.includes(marker)) {
    throw new PromptThreadBrokerError("invalid_response");
  }
  copy.instructions = instructions.replace(
    marker,
    cacheControlMarker(lineage, "x1"),
  );
  return copy;
}

function injectCacheMarker(
  request: Record<string, unknown>,
  lineage: string,
): Record<string, unknown> {
  const copy = structuredClone(request);
  copy.instructions = `${cacheControlMarker(lineage, "v1")}\n${
    typeof copy.instructions === "string" ? copy.instructions : ""
  }`;
  return copy;
}

function applyApprovedEnvelope(
  request: Record<string, unknown>,
  cell: PromptThreadBrokerCell,
): Record<string, unknown> {
  const copy = structuredClone(request);
  if (copy.store !== undefined && copy.store !== false) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  copy.store = false;
  if (cell.requestedServiceTier) {
    if (
      copy.service_tier !== undefined
      && copy.service_tier !== cell.requestedServiceTier
    ) {
      throw new PromptThreadBrokerError("tier_mismatch");
    }
    copy.service_tier = cell.requestedServiceTier;
  }
  return copy;
}

/** Construction seam only: callers inject/stub dispatch; it never calls the network here. */
export function createPromptThreadOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 0 });
}

export function createPromptThreadOpenAIDispatch(
  apiKey: string,
): PromptThreadProviderDispatch {
  const client = createPromptThreadOpenAIClient(apiKey);
  return (request, options) => client.responses.create(
    request as unknown as ResponseCreateParamsNonStreaming,
    options,
  );
}

function validateFinalRequest(
  cell: PromptThreadBrokerCell,
  request: Record<string, unknown>,
  policy: Required<Pick<PromptThreadBrokerPolicy, "model" | "requestKind">>,
): void {
  if (typeof request.input !== "string") {
    throw new PromptThreadBrokerError("invalid_request");
  }
  if (
    request.model !== policy.model
    || request.store !== false
    || request.prompt_cache_options !== undefined
  ) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  if (
    cell.estimatedInputTokens !== undefined
    && (
      !isNonNegativeSafeInteger(cell.estimatedInputTokens)
      || estimateRequestInputTokens(request) > cell.estimatedInputTokens
    )
  ) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  if (
    cell.maxOutputTokens !== undefined
    && (
      !isNonNegativeSafeInteger(cell.maxOutputTokens)
      || !isNonNegativeSafeInteger(request.max_output_tokens)
      || request.max_output_tokens > cell.maxOutputTokens
    )
  ) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  if (policy.requestKind === "curator") {
    const text = asRecord(request.text);
    const format = asRecord(text?.format);
    if (
      request.input.length === 0 ||
      format?.type !== "json_schema" ||
      format.strict !== true
    ) {
      throw new PromptThreadBrokerError("invalid_request");
    }
    return;
  }
  if (request.input.length < 1_024 || request.prompt_cache_key !== cell.lineage) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  validateNativeFunctionTools(request);
}

function validateNativeFunctionTools(request: Record<string, unknown>): void {
  if (request.tools === undefined) {
    if (request.tool_choice !== undefined || request.parallel_tool_calls !== undefined) {
      throw new PromptThreadBrokerError("invalid_request");
    }
    return;
  }
  if (!Array.isArray(request.tools) || request.tools.length < 1) {
    throw new PromptThreadBrokerError("invalid_request");
  }
  const names = new Set<string>();
  for (const candidate of request.tools) {
    const tool = asRecord(candidate);
    if (
      tool?.type !== "function"
      || typeof tool.name !== "string"
      || tool.name.length < 1
      || tool.name.length > 64
      || tool.strict !== true
      || !asRecord(tool.parameters)
    ) {
      throw new PromptThreadBrokerError("invalid_request");
    }
    names.add(tool.name);
  }
  const choice = asRecord(request.tool_choice);
  if (
    choice?.type !== "function"
    || typeof choice.name !== "string"
    || !names.has(choice.name)
    || request.parallel_tool_calls !== false
  ) {
    throw new PromptThreadBrokerError("invalid_request");
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function estimateRequestInputTokens(request: Record<string, unknown>): number {
  const input = typeof request.input === "string" ? request.input : "";
  const instructions = typeof request.instructions === "string" ? request.instructions : "";
  return estimateTokensFromChars(input.length + instructions.length);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
