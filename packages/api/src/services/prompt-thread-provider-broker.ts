import { createHash } from "node:crypto";
import OpenAI from "openai";
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

export type PromptThreadProviderDispatch = (request: Record<string, unknown>) => Promise<unknown>;
export interface PromptThreadBrokerPolicy {
  model?: string;
  requestKind?: "panel" | "curator";
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
    const injected = this.requestKind === "panel"
      ? injectCacheMarker(request.request)
      : structuredClone(request.request);
    const transformed = cell.controlReturnTurn ? applyCacheControl(injected) : injected;
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

  async dispatch(lock: RunMutationLock, input: PromptThreadBrokerRequest, send: PromptThreadProviderDispatch): Promise<{ response: unknown; receipt: PromptThreadBrokerReceipt }> {
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
    await appendCellTransition(lock, { cellId: prepared.cell.cellId, stage: "planned" });
    await atomicWriteArtifact(lock, `${base}/prepared-request.json`, preparedArtifact);
    await appendCellTransition(lock, { cellId: prepared.cell.cellId, stage: "started" });
    const startedAt = performance.now();
    let response: unknown;
    try {
      response = await send(prepared.request);
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

const CACHE_CONTROL_MARKER = "[influence-cache-prefix:v1]";
const CACHE_CONTROL_REPLACEMENT = "[influence-cache-prefix:x1]";

function applyCacheControl(request: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(request);
  const instructions = typeof copy.instructions === "string" ? copy.instructions : null;
  if (!instructions || !instructions.includes(CACHE_CONTROL_MARKER)) {
    throw new PromptThreadBrokerError("invalid_response");
  }
  copy.instructions = instructions.replace(CACHE_CONTROL_MARKER, CACHE_CONTROL_REPLACEMENT);
  return copy;
}

function injectCacheMarker(request: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(request);
  copy.instructions = `${CACHE_CONTROL_MARKER}\n${typeof copy.instructions === "string" ? copy.instructions : ""}`;
  return copy;
}

/** Construction seam only: callers inject/stub dispatch; it never calls the network here. */
export function createPromptThreadOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 0 });
}

function validateFinalRequest(
  cell: PromptThreadBrokerCell,
  request: Record<string, unknown>,
  policy: Required<PromptThreadBrokerPolicy>,
): void {
  if (typeof request.input !== "string") {
    throw new PromptThreadBrokerError("invalid_request");
  }
  if (request.model !== policy.model || request.prompt_cache_options !== undefined) {
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
  if (request.tools !== undefined || request.tool_choice !== undefined) {
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
