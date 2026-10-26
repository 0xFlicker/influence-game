import { createHash, randomUUID } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { compileAudioDelivery } from "./audio-delivery";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import type { ProviderProfileId } from "./model-catalog";
import { Phase, type UUID } from "./types";

const providerAdmissionGuard = new AsyncLocalStorage<() => void>();

/** Fence new attempts in a parallel session, including retries and context calls.
 * Already admitted attempts retain their transport and terminal evidence lifecycle.
 */
export function withProviderAdmissionGuard<T>(guard: () => void, call: () => Promise<T>): Promise<T> {
  return providerAdmissionGuard.run(guard, call);
}

export const PROVIDER_ATTEMPT_HEADER = "x-influence-provider-attempt-id";
const INTERNAL_TRANSPORT_HEADERS = new Set([
  PROVIDER_ATTEMPT_HEADER,
  "x-influence-no-flex-transport-retry",
]);

const CREDENTIAL_FIELD =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|secret)$/i;
const CREDENTIAL_FIELD_SUFFIX =
  /(?:^|[-_])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|client[-_]?secret|password|secret)$/i;
const CREDENTIAL_QUERY_PARAM =
  /^(?:api[-_]?key|access[-_]?token|token|key|secret|signature|sig)$/i;

export type ProviderAttemptFailureKind =
  | "refusal"
  | "rate_limit"
  | "service_error"
  | "transport_timeout"
  | "transport_error"
  | "authentication"
  | "configuration"
  | "request_error"
  | "context_overflow"
  | "cancellation"
  | "empty_output"
  | "malformed_output"
  | "wrong_tool"
  | "undecodable_structured_output";

export type ProviderActionCoordinateV1 =
  | { version: 1; kind: "episode_copy"; revision: number; }
  | { version: 1; kind: "house_cut_discovery"; sourceHash: string; windowId: string; editorialVersion: string; }
  | { version: 1; kind: "werewolf_action"; eventSequence: number; }
  | {
      version: 1;
      kind: "phase_call";
      phase: Phase;
      round: number;
      canonicalEventSequence: number;
      callSlot: number;
    }
  | {
      version: 1;
      kind: "diary_exchange";
      sessionEventSequence: number;
      playerId: UUID;
      exchangeOrdinal: number;
    }
  | {
      version: 1;
      kind: "alliance_huddle";
      scheduleId: string;
      exchangeOrdinal: number;
    }
  | {
      version: 1;
      kind: "durable_turn";
      turnId: string;
      subcallSlot: number;
    }
  | {
      version: 1;
      kind: "provider_health";
      providerProfileId: string;
      revision: number;
    };

export type ProviderSemanticCoordinateV1 = ProviderActionCoordinateV1 | {
  version: 1; kind: "context_compaction"; parent: ProviderActionCoordinateV1;
  sourceHash: string; revision: number; chunk: number;
};

/** Child summaries inherit the parent's authorization, never its acceptance slot. */
export function providerActionCoordinate(coordinate: ProviderLogicalCallCoordinate): ProviderLogicalCallCoordinate {
  if (coordinate.semantic.kind !== "context_compaction") return coordinate;
  const semantic = coordinate.semantic.parent;
  return { ...coordinate, semantic, ...(semantic.kind === "durable_turn" ? {
    durableTurn: { turnId: semantic.turnId, subcallSlot: semantic.subcallSlot },
  } : {}) };
}

export interface ProviderContextAttempt {
  catalogId: string; sourceHash: string; revision: number; outcome: string | null;
}
export interface ProviderContextIdentity { sourceHash: string; revision: number; maxAttempts: number; }

export interface ProviderLogicalCallCoordinate {
  gameId?: UUID;
  ownerEpoch?: string;
  actor: {
    id?: UUID;
    name: string;
    role: "player" | "juror" | "house" | "system" | "producer";
  };
  action: string;
  phase?: Phase;
  round?: number;
  /** Closed, versioned semantic identity for this one logical provider call. */
  semantic: ProviderSemanticCoordinateV1;
  /** Planned durable turn identity. Present only while a turn-scoped call is active. */
  durableTurn?: {
    turnId: string;
    subcallSlot: number;
  };
}

export function canonicalProviderSemanticCoordinate(
  coordinate: ProviderSemanticCoordinateV1,
): string {
  assertProviderSemanticCoordinate(coordinate);
  switch (coordinate.kind) {
    case "context_compaction":
      return JSON.stringify({ version: 1, kind: coordinate.kind,
        parent: JSON.parse(canonicalProviderSemanticCoordinate(coordinate.parent)),
        sourceHash: coordinate.sourceHash, revision: coordinate.revision, chunk: coordinate.chunk });
    case "episode_copy":
      return JSON.stringify({ version: 1, kind: coordinate.kind, revision: coordinate.revision });
    case "house_cut_discovery":
      return JSON.stringify({ version: 1, kind: coordinate.kind, sourceHash: coordinate.sourceHash, windowId: coordinate.windowId, editorialVersion: coordinate.editorialVersion });
    case "werewolf_action":
      return JSON.stringify({ version: 1, kind: coordinate.kind, eventSequence: coordinate.eventSequence });
    case "phase_call":
      return JSON.stringify({
        version: 1,
        kind: coordinate.kind,
        phase: coordinate.phase,
        round: coordinate.round,
        canonicalEventSequence: coordinate.canonicalEventSequence,
        callSlot: coordinate.callSlot,
      });
    case "diary_exchange":
      return JSON.stringify({
        version: 1,
        kind: coordinate.kind,
        sessionEventSequence: coordinate.sessionEventSequence,
        playerId: coordinate.playerId,
        exchangeOrdinal: coordinate.exchangeOrdinal,
      });
    case "alliance_huddle":
      return JSON.stringify({
        version: 1,
        kind: coordinate.kind,
        scheduleId: coordinate.scheduleId,
        exchangeOrdinal: coordinate.exchangeOrdinal,
      });
    case "durable_turn":
      return JSON.stringify({
        version: 1,
        kind: coordinate.kind,
        turnId: coordinate.turnId,
        subcallSlot: coordinate.subcallSlot,
      });
    case "provider_health":
      return JSON.stringify({
        version: 1,
        kind: coordinate.kind,
        providerProfileId: coordinate.providerProfileId,
        revision: coordinate.revision,
      });
  }
}

export function providerSemanticCoordinateHash(
  coordinate: ProviderSemanticCoordinateV1,
): string {
  return `sha256:${createHash("sha256")
    .update(canonicalProviderSemanticCoordinate(coordinate))
    .digest("hex")}`;
}

export function durableProviderLogicalCallId(input: {
  gameId: string;
  turnId: string;
  subcallSlot: number;
}): string {
  const semantic: ProviderSemanticCoordinateV1 = {
    version: 1,
    kind: "durable_turn",
    turnId: input.turnId,
    subcallSlot: input.subcallSlot,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify({
    domain: "influence.provider.logical-call.v2",
    gameId: input.gameId,
    semantic: canonicalProviderSemanticCoordinate(semantic),
  })).digest("hex")}`;
}

/** Shared engine/journal identity, including standalone and Werewolf calls. */
export function providerLogicalCallId(gameId: string, coordinate: ProviderLogicalCallCoordinate): string {
  if (coordinate.semantic.kind === "durable_turn") return durableProviderLogicalCallId({
    gameId, turnId: coordinate.semantic.turnId, subcallSlot: coordinate.semantic.subcallSlot,
  });
  return hashCanonicalJson({ domain: "influence.provider.logical-call.v2", coordinate: {
    gameId, actor: { name: coordinate.actor.name,
      ...(coordinate.actor.id !== undefined && { id: coordinate.actor.id }),
      ...(coordinate.actor.role !== undefined && { role: coordinate.actor.role }) },
    action: coordinate.action,
    ...(coordinate.phase !== undefined && { phase: coordinate.phase }),
    ...(coordinate.round !== undefined && { round: coordinate.round }),
    semantic: canonicalProviderSemanticCoordinate(coordinate.semantic),
  } });
}

export function assertProviderSemanticCoordinate(
  coordinate: ProviderSemanticCoordinateV1,
): void {
  const exactFields = (fields: readonly string[]) => {
    if (!coordinate || typeof coordinate !== "object") {
      throw new Error("Provider semantic coordinate must be an object");
    }
    const actual = Object.keys(coordinate).sort();
    const expected = [...fields].sort();
    if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
      throw new Error("Provider semantic coordinate fields are not exact");
    }
  };
  const positiveInteger = (value: unknown, field: string) => {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new Error(`Provider semantic coordinate ${field} must be a positive safe integer`);
    }
  };
  const nonNegativeInteger = (value: unknown, field: string) => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new Error(`Provider semantic coordinate ${field} must be a non-negative safe integer`);
    }
  };
  const nonBlank = (value: unknown, field: string) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Provider semantic coordinate ${field} must be a non-blank string`);
    }
  };
  if (!coordinate || coordinate.version !== 1) {
    throw new Error("Provider semantic coordinate version must be 1");
  }
  switch (coordinate.kind) {
    case "context_compaction":
      exactFields(["version", "kind", "parent", "sourceHash", "revision", "chunk"]);
      if ((coordinate.parent as ProviderSemanticCoordinateV1)?.kind === "context_compaction") throw new Error("Nested context coordinates are invalid");
      assertProviderSemanticCoordinate(coordinate.parent);
      if (!/^sha256:[a-f0-9]{64}$/.test(coordinate.sourceHash)) throw new Error("Invalid context source hash");
      positiveInteger(coordinate.revision, "revision");
      nonNegativeInteger(coordinate.chunk, "chunk");
      return;
    case "episode_copy":
      exactFields(["version", "kind", "revision"]);
      nonNegativeInteger(coordinate.revision, "revision");
      return;
    case "house_cut_discovery":
      exactFields(["version", "kind", "sourceHash", "windowId", "editorialVersion"]);
      nonBlank(coordinate.sourceHash, "sourceHash");
      nonBlank(coordinate.windowId, "windowId");
      nonBlank(coordinate.editorialVersion, "editorialVersion");
      return;
    case "werewolf_action":
      exactFields(["version", "kind", "eventSequence"]);
      positiveInteger(coordinate.eventSequence, "eventSequence");
      return;
    case "phase_call":
      exactFields(["version", "kind", "phase", "round", "canonicalEventSequence", "callSlot"]);
      if (!Object.values(Phase).includes(coordinate.phase)) {
        throw new Error("Provider semantic coordinate phase_call phase is invalid");
      }
      nonNegativeInteger(coordinate.round, "round");
      nonNegativeInteger(coordinate.canonicalEventSequence, "canonicalEventSequence");
      positiveInteger(coordinate.callSlot, "callSlot");
      return;
    case "diary_exchange":
      exactFields(["version", "kind", "sessionEventSequence", "playerId", "exchangeOrdinal"]);
      nonNegativeInteger(coordinate.sessionEventSequence, "sessionEventSequence");
      nonBlank(coordinate.playerId, "playerId");
      positiveInteger(coordinate.exchangeOrdinal, "exchangeOrdinal");
      return;
    case "alliance_huddle":
      exactFields(["version", "kind", "scheduleId", "exchangeOrdinal"]);
      nonBlank(coordinate.scheduleId, "scheduleId");
      positiveInteger(coordinate.exchangeOrdinal, "exchangeOrdinal");
      return;
    case "durable_turn":
      exactFields(["version", "kind", "turnId", "subcallSlot"]);
      nonBlank(coordinate.turnId, "turnId");
      positiveInteger(coordinate.subcallSlot, "subcallSlot");
      return;
    case "provider_health":
      exactFields(["version", "kind", "providerProfileId", "revision"]);
      nonBlank(coordinate.providerProfileId, "providerProfileId");
      positiveInteger(coordinate.revision, "revision");
      return;
    default:
      throw new Error("Provider semantic coordinate kind is invalid");
  }
}

export interface ProviderPreparedRequest {
  /** Bounded provider-owned transport identifier (for example openai.responses). */
  transport: string;
  providerProfileId: ProviderProfileId;
  catalogId?: string;
  model: string;
  body: unknown;
  headers?: Headers | Record<string, string>;
  /** Credential values are redacted wherever a provider reflects them. */
  credentialValues?: readonly string[];
}

export interface SanitizedProviderRequestEvidence {
  transport: string;
  providerProfileId: ProviderProfileId;
  catalogId?: string;
  model: string;
  url?: string;
  headers?: Record<string, string>;
  body: unknown;
}

export interface SanitizedProviderResponseEvidence {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface ProviderAttemptUsableOutcome {
  kind: "usable";
}

export interface ProviderAttemptFailureOutcome {
  kind: ProviderAttemptFailureKind;
  message: string;
  retryable: boolean;
  /** Sanitized transport diagnostics; never a model-authored decision. */
  httpStatus?: number;
  errorCode?: string;
  retryAfterMs?: number;
  /** Private feedback for a regenerated attempt; never accepted game state. */
  feedback?: LengthFeedback;
}

export interface LengthFeedback {
  draft: string;
  field: string;
  measured: number;
  allowed: number;
  overage: number;
  unit: "utf8_bytes" | "utf16_code_units" | "unicode_code_points";
  /** Exact rejected structured payload, private retry context only; never accepted game state. */
  rejectedDecision?: unknown;
}

export type ProviderAttemptOutcome =
  ProviderAttemptUsableOutcome | ProviderAttemptFailureOutcome;

export type ProviderAttemptDisposition =
  | "accepted"
  | "retry_scheduled"
  | "exhausted";

export interface ProviderAttemptUsageFacts {
  promptTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/**
 * Safe accounting facts captured before terminal hooks run. Raw prompts,
 * responses, tool arguments, and provider reasoning never enter this envelope.
 */
export interface ProviderAttemptAccountingFacts {
  usage?: ProviderAttemptUsageFacts;
  actualCostMicrousd?: number;
  actualCostSource?: "provider_actual" | "router_actual";
  providerNativeUnit?: string;
  providerNativeAmount?: string;
  effectiveServiceTier?: string;
}

export interface ProviderAttemptIntent {
  context?: ProviderContextIdentity;
  coordinate: ProviderLogicalCallCoordinate;
  attemptOrdinal: number;
  attemptId: string;
  preparedRequest: SanitizedProviderRequestEvidence;
  startedAt: string;
}

export interface ProviderAttemptRecord extends ProviderAttemptIntent {
  /** Private production metadata, never returned as the accepted gameplay value. */
  audioDelivery?: import("./audio-delivery").AcceptedAudioDelivery;
  completedAt: string;
  latencyMs: number;
  outcome: ProviderAttemptOutcome;
  disposition: ProviderAttemptDisposition;
  accounting?: ProviderAttemptAccountingFacts;
  requestId?: string;
  /** Exact sanitized HTTP request captured at the transport seam for evidence only. */
  rawRequest?: SanitizedProviderRequestEvidence;
  rawResponse?: SanitizedProviderResponseEvidence;
  /**
   * Bounded, JSON-safe value that validation accepted for gameplay. Durable
   * authorities use this to finish the logical call after owner recovery
   * without repeating an already accepted remote execution.
   */
  acceptedValue?: unknown;
  /** Stored only inside the existing private failure evidence object. */
  lengthFeedback?: LengthFeedback;
}

export interface ProviderAcceptedResult<TValue = unknown> {
  /** Present only when a durable terminal hook owns the accepted receipt. */
  attemptId?: string;
  attemptOrdinal: number;
  catalogId?: string;
  value: TValue;
}

export interface ProviderTerminalReceipt {
  acceptedAttemptId?: string;
}

export interface ProviderExecutionHooks {
  onReadLengthFeedback?(coordinate: ProviderLogicalCallCoordinate): Promise<LengthFeedback | undefined> | LengthFeedback | undefined;
  onReadContextAttempts?(coordinate: ProviderLogicalCallCoordinate): Promise<ProviderContextAttempt[]>;
  /** Return the previously accepted value for this stable logical call. */
  onReadAccepted?(
    coordinate: ProviderLogicalCallCoordinate,
  ): Promise<ProviderAcceptedResult | undefined> | ProviderAcceptedResult | undefined;
  /**
   * Durable authorities allocate ordinals before request preparation so a
   * reconstructed logical call continues its existing attempt chain.
   */
  onAllocateAttemptOrdinal?(
    coordinate: ProviderLogicalCallCoordinate,
  ): Promise<number> | number;
  /** Future durable authority hook. Throwing prevents the network dispatch. */
  onReserve?(intent: ProviderAttemptIntent): Promise<void> | void;
  /** Future durable terminal journal hook. */
  onTerminal?(
    record: ProviderAttemptRecord,
  ): Promise<ProviderTerminalReceipt | void> | ProviderTerminalReceipt | void;
}

export type ProviderCandidateValidation<T> =
  | { status: "usable"; value: T; audioDelivery?: import("./audio-delivery").AcceptedAudioDelivery }
  | {
      status: "unusable";
      kind: ProviderAttemptFailureKind;
      message: string;
      retryable?: boolean;
      feedback?: LengthFeedback;
    };

export type ProviderAcceptedValueValidation<T> =
  | { status: "valid"; value: T }
  | { status: "invalid"; message: string };

export interface ProviderDispatchRequestOptions {
  signal?: AbortSignal;
  maxRetries: 0;
  headers: Record<string, string>;
}

export interface ExecuteProviderCallOptions<TResponse, TValue> {
  beforeAttempt?(): Promise<void>;
  contextIdentity?(): ProviderContextIdentity | undefined;
  /** Only callers with a concrete adaptation path may retry overflow. */
  adaptContext?: boolean;
  preparedRequest:
    | ProviderPreparedRequest
    | ((attemptOrdinal: number) => ProviderPreparedRequest);
  maxAttempts: number;
  cancellationSignal?: AbortSignal;
  dispatch(context: {
    attemptOrdinal: number;
    attemptId: string;
    requestOptions: ProviderDispatchRequestOptions;
  }): Promise<TResponse>;
  validate(response: TResponse): ProviderCandidateValidation<TValue>;
  validateAcceptedValue?(value: unknown): ProviderAcceptedValueValidation<TValue>;
  classifyError?(
    error: unknown,
    signal?: AbortSignal,
  ): ProviderAttemptFailureOutcome;
  accounting?(response: TResponse): ProviderAttemptAccountingFacts | undefined;
  requestId?(response: TResponse): string | undefined;
  nativeResponse?(response: TResponse): unknown;
  onRetry?(record: ProviderAttemptRecord): Promise<void> | void;
}

export interface ProviderManifestCallEntry<TResponse, TValue>
  extends ExecuteProviderCallOptions<TResponse, TValue> {
  catalogId: string;
  compatibility?: () => { compatible: boolean; reason?: string };
}

export interface ExecuteProviderManifestCallOptions<TResponse, TValue> {
  entries: readonly ProviderManifestCallEntry<TResponse, TValue>[];
  /** Admission for fresh dispatch only; accepted journal replay needs no transport. */
  beforeDispatch?(): Promise<void>;
  cancellationSignal?: AbortSignal;
  validateAcceptedValue?(value: unknown): ProviderAcceptedValueValidation<TValue>;
}

export interface ProviderManifestCallResult<TValue> {
  value: TValue;
  catalogId: string;
  manifestPosition: number;
  acceptedAttemptId?: string;
  acceptedAttemptOrdinal: number;
}

export interface ProviderExecutionCoordinatorOptions {
  hooks?: ProviderExecutionHooks;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type ProviderEvidenceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface MutableTransportCapture {
  credentialValues: readonly string[];
  request?: SanitizedProviderRequestEvidence;
  response?: SanitizedProviderResponseEvidence;
}

const activeTransportCaptures = new Map<string, MutableTransportCapture>();

/** Stable canonical/private-decision correlation for one accepted attempt. */
export function providerAcceptedDecisionId(acceptedAttemptId: string): UUID {
  const bytes = createHash("sha256")
    .update("influence.provider.accepted-decision.v1\0")
    .update(acceptedAttemptId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ProviderUnavailableKind =
  | ProviderAttemptFailureKind
  | "budget_exhausted"
  | "circuit_open"
  | "journal_exhausted";

/** Gameplay-facing exhaustion shared by failed, disallowed, and over-budget manifests. */
export class ProviderUnavailableError extends Error {
  readonly outcome: { kind: ProviderUnavailableKind };

  constructor(message: string, kind: ProviderUnavailableKind) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.outcome = { kind };
  }
}

export class ProviderAttemptError extends ProviderUnavailableError {
  readonly record: ProviderAttemptRecord;
  declare readonly outcome: ProviderAttemptFailureOutcome;

  constructor(record: ProviderAttemptRecord) {
    const message =
      record.outcome.kind === "usable"
        ? "Provider attempt unexpectedly failed"
        : record.outcome.message;
    const kind = record.outcome.kind === "usable"
      ? "service_error"
      : record.outcome.kind;
    super(message, kind);
    this.name = "ProviderAttemptError";
    this.record = record;
    if (record.outcome.kind === "usable") {
      throw new Error("ProviderAttemptError requires a failed outcome");
    }
    this.outcome = record.outcome;
  }
}

/**
 * Durable reservation authorities throw this before a network dispatch when a
 * sealed fallback entry has spent its per-game call budget.
 */
export class ProviderCallBudgetExhaustedError extends ProviderUnavailableError {
  constructor(
    readonly catalogId: string,
    readonly usedCalls: number,
    readonly maxCallsPerGame: number,
  ) {
    super(
      `Provider call budget exhausted for ${catalogId}: ${usedCalls}/${maxCallsPerGame}`,
      "budget_exhausted",
    );
    this.name = "ProviderCallBudgetExhaustedError";
  }
}

/** A durable health authority rejected dispatch before network I/O. */
export class ProviderCircuitOpenError extends ProviderUnavailableError {
  constructor(
    readonly catalogId: string,
    readonly scopeKey: string,
    readonly revision: number,
    readonly haltManifest: boolean,
  ) {
    super(`Provider circuit is open for ${scopeKey}`, "circuit_open");
    this.name = "ProviderCircuitOpenError";
  }
}

/** A durable entry spent its bounded retry policy before an interrupted owner returned. */
export class ProviderJournalEntryExhaustedError extends ProviderUnavailableError {
  constructor(readonly catalogId: string) {
    super(`Provider entry ${catalogId} exhausted its durable retrospective retries; explicit recovery is required`, "journal_exhausted");
    this.name = "ProviderJournalEntryExhaustedError";
  }
}

/** A manifest entry cannot satisfy this invocation and is skipped without I/O. */
export class ProviderEntryIncompatibleError extends ProviderUnavailableError {
  constructor(
    readonly catalogId: string,
    readonly incompatibility: string,
  ) {
    super(
      `Provider entry ${catalogId} is incompatible: ${incompatibility}`,
      "configuration",
    );
    this.name = "ProviderEntryIncompatibleError";
  }
}

/** Durable replay data no longer satisfies the current semantic invocation. */
export class ProviderAcceptedValueIntegrityError extends Error {
  constructor(readonly integrityMessage: string) {
    super(`Accepted provider value failed replay validation: ${integrityMessage}`);
    this.name = "ProviderAcceptedValueIntegrityError";
  }
}

/** Provider exhaustion that an owning phase may legally replace with fallback. */
export function isProviderFallbackEligible(
  error: unknown,
): error is ProviderUnavailableError {
  return error instanceof ProviderUnavailableError
    && error.outcome.kind !== "cancellation";
}

export class ProviderExecutionCoordinator {
  private readonly cooldowns = new Map<string, number>();
  private readonly hooks?: ProviderExecutionHooks;
  private readonly wait: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  private readonly now: () => number;

  constructor(options: ProviderExecutionCoordinatorOptions = {}) {
    this.hooks = options.hooks;
    this.wait = options.wait ?? abortableDelay;
    this.now = options.now ?? Date.now;
  }

  startCall(
    coordinate: ProviderLogicalCallCoordinate,
  ): ProviderLogicalCallExecution {
    return new ProviderLogicalCallExecution(
      coordinate,
      this.hooks,
      this.wait,
      this.now,
      this.cooldowns,
    );
  }
}

export class ProviderLogicalCallExecution {
  private nextAttemptOrdinal = 1;
  private acceptedResult?: ProviderAcceptedResult;
  private contextAttempts: ProviderContextAttempt[] = [];
  private readonly contextCalls = new Map<string, ProviderLogicalCallExecution>();

  constructor(
    readonly coordinate: ProviderLogicalCallCoordinate,
    private readonly hooks: ProviderExecutionHooks | undefined,
    private readonly wait: (
      milliseconds: number,
      signal?: AbortSignal,
    ) => Promise<void>,
    private readonly now: () => number,
    private readonly cooldowns = new Map<string, number>(),
  ) {}

  async readContextAttempts(): Promise<ProviderContextAttempt[]> {
    return this.hooks?.onReadContextAttempts ? this.hooks.onReadContextAttempts(this.coordinate) : [...this.contextAttempts];
  }

  async readLengthFeedback(): Promise<LengthFeedback | undefined> {
    return this.hooks?.onReadLengthFeedback?.(this.coordinate);
  }

  startContextCall(sourceHash: string, revision: number, chunk: number): ProviderLogicalCallExecution {
    if (this.coordinate.semantic.kind === "context_compaction") throw new Error("Compaction cannot recursively adapt itself");
    const { durableTurn: _binding, ...parent } = this.coordinate;
    const key = `${sourceHash}:${revision}:${chunk}`;
    let call = this.contextCalls.get(key);
    if (!call) {
      call = new ProviderLogicalCallExecution({ ...parent, semantic: { version: 1, kind: "context_compaction",
        parent: this.coordinate.semantic, sourceHash, revision, chunk } }, this.hooks, this.wait, this.now, this.cooldowns);
      this.contextCalls.set(key, call);
    }
    return call;
  }

  /**
   * Traverse one game's sealed provider manifest. Each entry owns its bounded
   * retry/repair loop; an exhausted or rejected entry advances to the next
   * entry, while cancellation and local programming faults still fail fast.
   */
  async executeManifest<TResponse, TValue>(
    options: ExecuteProviderManifestCallOptions<TResponse, TValue>,
  ): Promise<ProviderManifestCallResult<TValue>> {
    if (options.entries.length === 0) {
      throw new Error("Provider manifest execution requires at least one entry");
    }

    const accepted = await this.readAccepted<TValue>(options.validateAcceptedValue);
    if (accepted) {
      const manifestPosition = options.entries.findIndex(
        (entry) => entry.catalogId === accepted.catalogId,
      );
      if (manifestPosition < 0) {
        throw new Error(
          `Accepted provider result references missing sealed entry ${accepted.catalogId ?? "unknown"}`,
        );
      }
      return {
        value: accepted.value,
        catalogId: options.entries[manifestPosition]!.catalogId,
        manifestPosition,
        ...(accepted.attemptId && { acceptedAttemptId: accepted.attemptId }),
        acceptedAttemptOrdinal: accepted.attemptOrdinal,
      };
    }

    options.cancellationSignal?.throwIfAborted();
    await options.beforeDispatch?.();
    let lastAttemptError: ProviderUnavailableError | undefined;
    let lastBudgetError: ProviderCallBudgetExhaustedError | undefined;
    let lastCircuitError: ProviderCircuitOpenError | undefined;
    let lastCompatibilityError: ProviderEntryIncompatibleError | undefined;
    let lastJournalError: ProviderJournalEntryExhaustedError | undefined;
    for (const [manifestPosition, entry] of options.entries.entries()) {
      options.cancellationSignal?.throwIfAborted();
      if ((this.cooldowns.get(entry.catalogId) ?? 0) > this.now()) {
        lastCircuitError = new ProviderCircuitOpenError(entry.catalogId, `entry:${entry.catalogId}`, 0, false);
        continue;
      }
      const compatibility = entry.compatibility?.();
      if (compatibility && !compatibility.compatible) {
        lastCompatibilityError = new ProviderEntryIncompatibleError(
          entry.catalogId,
          compatibility.reason ?? "unsupported invocation",
        );
        continue;
      }
      try {
        const value = await this.executeWithoutAcceptedReplay({
          ...entry,
          ...(options.cancellationSignal && {
            cancellationSignal: options.cancellationSignal,
          }),
        });
        const accepted = this.acceptedResult;
        if (!accepted) {
          throw new Error("Usable provider call did not retain its acceptance receipt");
        }
        return {
          value,
          catalogId: entry.catalogId,
          manifestPosition,
          ...(accepted.attemptId && { acceptedAttemptId: accepted.attemptId }),
          acceptedAttemptOrdinal: accepted.attemptOrdinal,
        };
      } catch (error) {
        if (error instanceof ProviderJournalEntryExhaustedError) {
          lastJournalError = error;
          continue;
        }
        if (error instanceof ProviderAttemptError) {
          lastAttemptError = error;
          continue;
        }
        if (error instanceof ProviderCallBudgetExhaustedError) {
          lastBudgetError = error;
          continue;
        }
        if (error instanceof ProviderCircuitOpenError) {
          if (error.haltManifest) throw error;
          lastCircuitError = error;
          continue;
        }
        if (error instanceof ProviderUnavailableError) { lastAttemptError = error; continue; }
        throw error;
      }
    }

    // A primary entry is intentionally uncapped, so a normal exhausted
    // manifest always has an attempt error. Preserve that gameplay-facing
    // typed outcome rather than replacing it with a later budget skip.
    throw lastAttemptError ?? lastJournalError ?? lastCircuitError ?? lastBudgetError ??
      lastCompatibilityError ??
      new Error("Provider manifest exhausted without an attempt");
  }

  async execute<TResponse, TValue>(
    options: ExecuteProviderCallOptions<TResponse, TValue>,
  ): Promise<TValue> {
    const accepted = await this.readAccepted<TValue>(options.validateAcceptedValue);
    if (accepted) return accepted.value;
    return this.executeWithoutAcceptedReplay(options);
  }

  private async readAccepted<TValue>(
    validateAcceptedValue?: (value: unknown) => ProviderAcceptedValueValidation<TValue>,
  ): Promise<ProviderAcceptedResult<TValue> | undefined> {
    const accepted = this.hooks?.onReadAccepted ? await this.hooks.onReadAccepted(this.coordinate) : this.acceptedResult;
    if (!accepted) return undefined;
    const validation = validateAcceptedValue?.(accepted.value);
    if (validation?.status === "invalid") {
      throw new ProviderAcceptedValueIntegrityError(validation.message);
    }
    const validated = {
      ...accepted,
      value: validation?.status === "valid"
        ? validation.value
        : accepted.value as TValue,
    };
    this.acceptedResult = validated;
    return validated;
  }

  getAcceptedResult(): ProviderAcceptedResult | undefined {
    return this.acceptedResult;
  }

  private async executeWithoutAcceptedReplay<TResponse, TValue>(
    options: ExecuteProviderCallOptions<TResponse, TValue>,
  ): Promise<TValue> {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
    let lastError: ProviderAttemptError | null = null;

    for (let localAttempt = 1; localAttempt <= maxAttempts; localAttempt++) {
      providerAdmissionGuard.getStore()?.();
      await options.beforeAttempt?.();
      const localAttemptOrdinal = this.nextAttemptOrdinal++;
      const attemptOrdinal = await this.hooks?.onAllocateAttemptOrdinal?.(
        this.coordinate,
      ) ?? localAttemptOrdinal;
      if (!Number.isSafeInteger(attemptOrdinal) || attemptOrdinal < 1) {
        throw new Error("Provider attempt ordinal authority returned an invalid value");
      }
      this.nextAttemptOrdinal = Math.max(
        this.nextAttemptOrdinal,
        attemptOrdinal + 1,
      );
      const attemptId = randomUUID();
      const startedAtMs = this.now();
      const preparedRequest =
        typeof options.preparedRequest === "function"
          ? options.preparedRequest(attemptOrdinal)
          : options.preparedRequest;
      const transportCapture: MutableTransportCapture = {
        credentialValues: preparedRequest.credentialValues ?? [],
      };
      const intent: ProviderAttemptIntent = {
        coordinate: this.coordinate,
        ...(options.contextIdentity?.() && { context: options.contextIdentity!() }),
        attemptOrdinal,
        attemptId,
        preparedRequest: sanitizePreparedRequest(preparedRequest),
        startedAt: new Date(startedAtMs).toISOString(),
      };
      transportCapture.request = intent.preparedRequest;

      providerAdmissionGuard.getStore()?.();
      await this.hooks?.onReserve?.(intent);
      activeTransportCaptures.set(attemptId, transportCapture);

      let capturedRecord: Omit<ProviderAttemptRecord, "disposition">;
      let usableResult: { value: TValue } | undefined;
      let dispatchResult!:
        | { status: "success"; response: TResponse }
        | {
            status: "failure";
            record: Omit<ProviderAttemptRecord, "disposition">;
          };
      try {
        const response = await options.dispatch({
          attemptOrdinal,
          attemptId,
          requestOptions: {
            maxRetries: 0,
            ...(options.cancellationSignal && {
              signal: options.cancellationSignal,
            }),
            headers: {
              [PROVIDER_ATTEMPT_HEADER]: attemptId,
              "x-influence-no-flex-transport-retry": "1",
            },
          },
        });
        dispatchResult = { status: "success", response };
      } catch (error) {
        if (error instanceof ProviderAttemptError) throw error;
        const completedAtMs = this.now();
        const classified = options.classifyError?.(
          error,
          options.cancellationSignal,
        ) ?? classifyProviderError(error, options.cancellationSignal);
        const rawResponse =
          transportCapture.response ??
          rawResponseFromError(error, transportCapture.credentialValues);
        const outcome = withTransportDiagnostics(classified, rawResponse, completedAtMs);
        const accounting = extractProviderAttemptAccounting(
          rawResponse.body,
          asRecord(error).accounting,
          asRecord(error).nativeResponse,
          error,
        );
        const requestId = sanitizeProviderRequestId(
          requestIdFromError(error, transportCapture.response),
          transportCapture.credentialValues,
        );
        dispatchResult = {
          status: "failure",
          record: {
            ...intent,
            ...(transportCapture.request && {
              rawRequest: transportCapture.request,
            }),
            completedAt: new Date(completedAtMs).toISOString(),
            latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
            outcome,
            ...(accounting && { accounting }),
            ...(requestId && { requestId }),
            rawResponse,
          },
        };
      } finally {
        activeTransportCaptures.delete(attemptId);
      }

      if (dispatchResult.status === "success") {
        // Validation is local application code, not a provider dispatch. Let
        // validator bugs fail fast instead of turning them into retries or
        // manifest failover.
        const validation = options.validate(dispatchResult.response);
        const completedAtMs = this.now();
        const requestId = sanitizeProviderRequestId(
          options.requestId?.(dispatchResult.response) ??
            requestIdFromResponse(
              dispatchResult.response,
              transportCapture.response,
            ),
          transportCapture.credentialValues,
        );
        if (validation.status === "usable") {
          const accounting = options.accounting?.(dispatchResult.response) ??
            extractProviderAttemptAccounting(
              dispatchResult.response,
              transportCapture.response?.body,
            );
          capturedRecord = {
            ...intent,
            ...(transportCapture.request && {
              rawRequest: transportCapture.request,
            }),
            completedAt: new Date(completedAtMs).toISOString(),
            latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
            outcome: { kind: "usable" },
            ...(validation.audioDelivery && { audioDelivery: {
              version: validation.audioDelivery.version,
              fields: validation.audioDelivery.fields.map(field => ({
                path: field.path,
                // Redaction changes offsets: rebuild the document from sanitized source.
                delivery: compileAudioDelivery(
                  String(sanitizeProviderEvidence(field.delivery.sourceText, transportCapture.credentialValues)),
                  field.delivery.context,
                ),
              })),
            } }),
            ...(accounting && { accounting }),
            ...(requestId && { requestId }),
            rawResponse: transportCapture.response ?? {
              body: sanitizeProviderEvidence(
                options.nativeResponse?.(dispatchResult.response) ?? dispatchResult.response,
                transportCapture.credentialValues,
              ),
            },
          };
          usableResult = { value: validation.value };
        } else {
          const outcome: ProviderAttemptFailureOutcome = {
            kind: validation.kind,
            message: validation.message,
            retryable:
              validation.retryable ?? defaultRetryable(validation.kind),
            ...(validation.feedback && { feedback: validation.feedback }),
          };
          const accounting = options.accounting?.(dispatchResult.response) ??
            extractProviderAttemptAccounting(
              dispatchResult.response,
              transportCapture.response?.body,
            );
          capturedRecord = {
            ...intent,
            ...(transportCapture.request && {
              rawRequest: transportCapture.request,
            }),
            completedAt: new Date(completedAtMs).toISOString(),
            latencyMs: Math.max(0, Math.round(completedAtMs - startedAtMs)),
            outcome,
            ...(accounting && { accounting }),
            ...(requestId && { requestId }),
            rawResponse: transportCapture.response ?? {
              body: sanitizeProviderEvidence(
                options.nativeResponse?.(dispatchResult.response) ??
                  dispatchResult.response,
                transportCapture.credentialValues,
              ),
            },
          };
        }
      } else {
        capturedRecord = dispatchResult.record;
      }

      const contextRetry = capturedRecord.outcome.kind === "context_overflow"
        && options.adaptContext === true && (capturedRecord.context?.revision ?? 0) < 3;
      const willRetry = contextRetry ||
        capturedRecord.outcome.kind !== "usable" &&
        capturedRecord.outcome.retryable &&
        !capturedRecord.outcome.retryAfterMs &&
        localAttempt < maxAttempts;
      const acceptedValue = usableResult && this.hooks?.onTerminal
        ? boundedAcceptedValue(sanitizeProviderEvidence(
            usableResult.value,
            transportCapture.credentialValues,
          ))
        : undefined;
      const record: ProviderAttemptRecord = {
        ...capturedRecord,
        ...(capturedRecord.outcome.kind !== "usable" && {
          outcome: {
            ...capturedRecord.outcome,
            message: sanitizeProviderOutcomeMessage(
              capturedRecord.outcome.message,
              transportCapture.credentialValues,
            ),
          },
        }),
        disposition:
          capturedRecord.outcome.kind === "usable"
            ? "accepted"
            : willRetry
              ? "retry_scheduled"
              : "exhausted",
        ...(acceptedValue !== undefined && {
          acceptedValue,
        }),
        ...(capturedRecord.outcome.kind !== "usable" && capturedRecord.outcome.feedback && {
          lengthFeedback: capturedRecord.outcome.feedback,
        }),
      };

      if (record.outcome.kind !== "usable" && record.outcome.retryable && record.outcome.retryAfterMs && record.preparedRequest.catalogId) {
        this.cooldowns.set(record.preparedRequest.catalogId, this.now() + record.outcome.retryAfterMs);
      }
      const terminalReceipt = await this.hooks?.onTerminal?.(record);
      const contextIdentity = record.context ?? (record.coordinate.semantic.kind === "context_compaction" ? record.coordinate.semantic : undefined);
      if (contextIdentity) this.contextAttempts.push({ catalogId: record.preparedRequest.catalogId!,
        sourceHash: contextIdentity.sourceHash, revision: contextIdentity.revision, outcome: record.outcome.kind });
      if (usableResult) {
        this.acceptedResult = {
          ...(terminalReceipt?.acceptedAttemptId && {
            attemptId: terminalReceipt.acceptedAttemptId,
          }),
          attemptOrdinal: record.attemptOrdinal,
          ...(record.preparedRequest.catalogId && {
            catalogId: record.preparedRequest.catalogId,
          }),
          value: usableResult.value,
        };
        return usableResult.value;
      }
      lastError = new ProviderAttemptError(record);
      if (record.outcome.kind === "usable") {
        throw new Error(
          "Failed provider attempt produced a usable terminal record",
        );
      }
      if (!willRetry) {
        throw lastError;
      }
      if (contextRetry) { localAttempt = 0; continue; }
      await options.onRetry?.(record);
      await this.wait(localAttempt * 1_000, options.cancellationSignal);
    }

    throw (
      lastError ??
      new Error("Provider call exhausted without a terminal outcome")
    );
  }
}

const MAX_ACCEPTED_PROVIDER_VALUE_BYTES = 1_048_576;

function boundedAcceptedValue(value: unknown): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error("Accepted provider value is not JSON serializable", {
      cause: error,
    });
  }
  if (serialized === undefined) {
    throw new Error("Accepted provider value cannot be undefined");
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_ACCEPTED_PROVIDER_VALUE_BYTES) {
    throw new Error(
      `Accepted provider value exceeds ${MAX_ACCEPTED_PROVIDER_VALUE_BYTES} bytes`,
    );
  }
  return JSON.parse(serialized) as unknown;
}

function sanitizeProviderOutcomeMessage(
  message: string,
  credentialValues: readonly string[],
): string {
  const withoutKnownCredentials = sanitizeProviderEvidence(
    message,
    credentialValues,
  ) as string;
  return withoutKnownCredentials
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|token|key|secret|signature|sig)=)[^&#\s]*/gi,
      "$1[REDACTED]",
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
      try {
        return sanitizeUrl(candidate, credentialValues);
      } catch {
        return candidate;
      }
    });
}

const MAX_PROVIDER_REQUEST_ID_LENGTH = 256;

function sanitizeProviderRequestId(
  requestId: string | undefined,
  credentialValues: readonly string[],
): string | undefined {
  if (!requestId) return undefined;
  const sanitized = sanitizeProviderOutcomeMessage(requestId, credentialValues)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, MAX_PROVIDER_REQUEST_ID_LENGTH);
  return sanitized || undefined;
}

export function sanitizeProviderEvidence(
  value: unknown,
  credentialValues: readonly string[] = [],
): unknown {
  const seen = new WeakSet<object>();
  const secrets = credentialValues.filter((secret) => secret.length > 0);

  const sanitize = (input: unknown): unknown => {
    if (typeof input === "string") {
      const withoutKnownCredentials = secrets.reduce(
        (text, secret) => text.split(secret).join("[REDACTED]"),
        input,
      );
      return withoutKnownCredentials.replace(
        /([?&](?:api[-_]?key|access[-_]?token|token|key|secret|signature|sig)=)[^&#\s]*/gi,
        "$1[REDACTED]",
      );
    }
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(sanitize);

    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !isCredentialField(key))
        .map(([key, nested]) => [key, sanitize(nested)]),
    );
  };

  return sanitize(value);
}

function extractProviderAttemptAccounting(
  ...candidates: unknown[]
): ProviderAttemptAccountingFacts | undefined {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const normalizedAccountingUsage = asRecord(record.usage);
    if (
      Object.keys(normalizedAccountingUsage).length > 0 &&
      (
        "promptTokens" in normalizedAccountingUsage ||
        "completionTokens" in normalizedAccountingUsage ||
        "totalTokens" in normalizedAccountingUsage
      )
    ) {
      return candidate as ProviderAttemptAccountingFacts;
    }
    const body = asRecord(record.body);
    const response = Object.keys(body).length > 0 ? body : record;
    const usage = asRecord(response.usage);
    if (Object.keys(usage).length === 0) continue;

    const promptDetails = asRecord(usage.prompt_tokens_details);
    const inputDetails = asRecord(usage.input_tokens_details);
    const completionDetails = asRecord(usage.completion_tokens_details);
    const outputDetails = asRecord(usage.output_tokens_details);
    const promptTokens = nonnegativeInteger(
      usage.prompt_tokens ?? usage.input_tokens,
    );
    const cachedTokens = nonnegativeInteger(
      promptDetails.cached_tokens ?? inputDetails.cached_tokens,
    );
    const cacheWriteTokens = nonnegativeInteger(
      promptDetails.cache_write_tokens ?? inputDetails.cache_write_tokens,
    );
    const completionTokens = nonnegativeInteger(
      usage.completion_tokens ?? usage.output_tokens,
    );
    const reasoningTokens = nonnegativeInteger(
      completionDetails.reasoning_tokens ?? outputDetails.reasoning_tokens,
    );
    const totalTokens = nonnegativeInteger(usage.total_tokens) ??
      (promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined);
    const normalizedUsage: ProviderAttemptUsageFacts = {
      ...(promptTokens !== undefined && { promptTokens }),
      ...(cachedTokens !== undefined && { cachedTokens }),
      ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
      ...(reasoningTokens !== undefined && { reasoningTokens }),
      ...(totalTokens !== undefined && { totalTokens }),
    };
    const routerBilling = asRecord(usage.imgnai ?? usage.routerBilling);
    const directMicrousd = nonnegativeInteger(
      routerBilling.cost_microusd ?? routerBilling.costMicrousd,
    );
    const costUsd = firstFiniteNumber(
      routerBilling.providerCostUsd,
      routerBilling.provider_cost_usd,
      routerBilling.cost_usd,
      routerBilling.costUsd,
      routerBilling.total_usd,
      routerBilling.totalUsd,
      routerBilling.amount_usd,
      routerBilling.amountUsd,
      routerBilling.usd,
    );
    const actualCostMicrousd = directMicrousd ??
      (costUsd === undefined
        ? undefined
        : Math.max(0, Math.round(costUsd * 1_000_000)));
    const nativeCredits = firstFiniteNumber(
      routerBilling.credits_charged,
      routerBilling.creditsCharged,
      routerBilling.credits,
    );
    const nativeAmount = firstFiniteNumber(routerBilling.amount);
    const nativeUnit = readString(routerBilling.unit).slice(0, 40);
    const effectiveServiceTier = readString(response.service_tier).slice(0, 40);

    const accounting: ProviderAttemptAccountingFacts = {
      ...(Object.keys(normalizedUsage).length > 0 && {
        usage: normalizedUsage,
      }),
      ...(actualCostMicrousd !== undefined && {
        actualCostMicrousd,
        actualCostSource: "router_actual" as const,
      }),
      ...(nativeCredits !== undefined
        ? {
            providerNativeUnit: "katana_credit",
            providerNativeAmount: String(nativeCredits),
          }
        : nativeAmount !== undefined && nativeUnit
          ? {
              providerNativeUnit: nativeUnit,
              providerNativeAmount: String(nativeAmount),
            }
          : {}),
      ...(effectiveServiceTier && { effectiveServiceTier }),
    };
    return Object.keys(accounting).length > 0 ? accounting : undefined;
  }
  return undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(number) || number < 0) return undefined;
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) ? rounded : undefined;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

export function createProviderEvidenceFetch(
  baseFetch: ProviderEvidenceFetch = fetch,
  credentialValues: readonly string[] = [],
): typeof fetch {
  return (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const incoming =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input.toString(), init);
    const attemptId = incoming.headers.get(PROVIDER_ATTEMPT_HEADER);
    const capture = attemptId
      ? activeTransportCaptures.get(attemptId)
      : undefined;
    const outgoingHeaders = new Headers(incoming.headers);
    for (const header of INTERNAL_TRANSPORT_HEADERS)
      outgoingHeaders.delete(header);
    const outgoing = new Request(incoming, { headers: outgoingHeaders });

    if (capture) {
      const actualCredentialValues = uniqueCredentialValues([
        ...credentialValues,
        ...capture.credentialValues,
      ]);
      capture.credentialValues = actualCredentialValues;
      capture.request = {
        transport: capture.request?.transport ??
          (new URL(outgoing.url).pathname.endsWith("/responses")
            ? "openai.responses"
            : "openai-compatible.chat_completions"),
        providerProfileId:
          capture.request?.providerProfileId ?? "custom-openai-compatible",
        ...(capture.request?.catalogId && { catalogId: capture.request.catalogId }),
        model: capture.request?.model ?? "unknown",
        url: sanitizeUrl(outgoing.url, actualCredentialValues),
        headers: sanitizeHeaders(outgoing.headers, actualCredentialValues),
        body: await sanitizeBodyText(
          await outgoing.clone().text(),
          actualCredentialValues,
        ),
      };
    }

    const response = await baseFetch(outgoing);
    if (capture) {
      const actualCredentialValues = uniqueCredentialValues([
        ...credentialValues,
        ...capture.credentialValues,
      ]);
      capture.credentialValues = actualCredentialValues;
      capture.response = {
        status: response.status,
        headers: sanitizeHeaders(response.headers, actualCredentialValues),
        body: await sanitizeBodyText(
          await response.clone().text(),
          actualCredentialValues,
        ),
      };
    }
    return response;
  }) as typeof fetch;
}

function uniqueCredentialValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

/**
 * Responses may encode a terminal provider failure inside an HTTP-200 body.
 * Classify that envelope before action-specific output decoding so every
 * Responses caller observes the same refusal/retry semantics.
 */
export function classifyResponsesTerminalOutcome(
  response: unknown,
): ProviderAttemptFailureOutcome | undefined {
  const record = asRecord(response);
  const status = readString(record.status).toLowerCase();
  const error = asRecord(record.error);
  const incompleteDetails = asRecord(record.incomplete_details);
  const code = (
    readString(error.code) ||
    readString(record.code) ||
    readString(incompleteDetails.reason)
  ).toLowerCase();
  const message =
    readString(error.message) ||
    readString(record.message) ||
    readString(incompleteDetails.reason) ||
    `Responses request ended with status ${status || "unknown"}`;

  if (status === "completed" || (!status && Object.keys(error).length === 0)) {
    return undefined;
  }
  if (status === "incomplete") {
    if (
      /invalid_prompt|content_filter|policy|refusal|rate_limit|too_many_requests|server_error|service_unavailable|internal_error|timeout|timed_out/.test(
        code,
      )
    ) {
      return classifyProviderFailureDetails({ code, message });
    }
    return {
      kind: "undecodable_structured_output",
      message,
      retryable: true,
    };
  }
  if (status === "failed" || Object.keys(error).length > 0) {
    return classifyProviderFailureDetails({ code, message });
  }
  if (status === "cancelled" || status === "queued" || status === "in_progress") {
    return { kind: "service_error", message, retryable: true };
  }
  return undefined;
}

/**
 * Some OpenAI-compatible routers embed a provider failure inside an HTTP 200
 * chat completion choice (`finish_reason: "error"` with a choice `error`).
 * That is a provider attempt failure, not a model outcome: classify it so
 * the coordinator retries/falls back instead of decoding it as empty output.
 */
export function classifyChatCompletionTerminalOutcome(
  response: unknown,
): ProviderAttemptFailureOutcome | undefined {
  const record = asRecord(response);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = asRecord(choices[0]);
  const error = Object.keys(asRecord(choice.error)).length > 0 ? asRecord(choice.error) : asRecord(record.error);
  const finishReason = readString(choice.finish_reason).toLowerCase();
  if (finishReason !== "error" && Object.keys(error).length === 0) return undefined;
  const metadata = asRecord(error.metadata);
  const numericCode = typeof error.code === "number" && Number.isSafeInteger(error.code) ? error.code : undefined;
  const code = (readString(error.code) || readString(metadata.error_type) || (numericCode !== undefined ? String(numericCode) : "")).toLowerCase();
  const message = readString(error.message) || "Chat completion ended with an embedded provider error";
  return classifyProviderFailureDetails({ ...(numericCode !== undefined && { status: numericCode }), code, message });
}

function sanitizePreparedRequest(
  request: ProviderPreparedRequest,
): SanitizedProviderRequestEvidence {
  const sanitizedHeaders = request.headers
    ? sanitizeHeaders(
        new Headers(request.headers),
        request.credentialValues ?? [],
      )
    : undefined;
  return {
    transport: request.transport,
    providerProfileId: request.providerProfileId,
    ...(request.catalogId && { catalogId: request.catalogId }),
    model: request.model,
    ...(sanitizedHeaders &&
      Object.keys(sanitizedHeaders).length > 0 && {
        headers: sanitizedHeaders,
      }),
    body: sanitizeProviderEvidence(request.body, request.credentialValues),
  };
}

function sanitizeHeaders(
  headers: Headers,
  credentialValues: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()]
      .filter(
        ([key]) =>
          !isCredentialField(key) &&
          !INTERNAL_TRANSPORT_HEADERS.has(key.toLowerCase()),
      )
      .map(([key, value]): [string, string] => [
        key.toLowerCase(),
        sanitizeProviderEvidence(value, credentialValues) as string,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function sanitizeBodyText(
  body: string,
  credentialValues: readonly string[],
): Promise<unknown> {
  if (!body) return "";
  try {
    return sanitizeProviderEvidence(JSON.parse(body), credentialValues);
  } catch {
    return sanitizeProviderEvidence(body, credentialValues);
  }
}

function sanitizeUrl(
  value: string,
  credentialValues: readonly string[],
): string {
  const url = new URL(value);
  for (const [key, parameterValue] of [...url.searchParams.entries()]) {
    if (
      CREDENTIAL_QUERY_PARAM.test(key) ||
      credentialValues.some(
        (credential) => credential.length > 0 && parameterValue.includes(credential),
      )
    )
      url.searchParams.set(key, "[REDACTED]");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

export function classifyProviderError(
  error: unknown,
  cancellationSignal?: AbortSignal,
): ProviderAttemptFailureOutcome {
  const record = asRecord(error);
  const name = readString(record.name);
  const constructorName =
    error instanceof Error ? error.constructor.name : "";
  const message = readString(record.message) || String(error);
  const status =
    readNumber(record.status) ?? readNumber(asRecord(record.response).status);
  const errorBody = asRecord(record.error);
  const code = (
    readString(record.code) ||
    readString(errorBody.code) ||
    readString(asRecord(errorBody.error).code)
  ).toLowerCase();
  const lowerMessage = message.toLowerCase();

  if (cancellationSignal?.aborted) {
    return { kind: "cancellation", message, retryable: false };
  }
  if (
    name === "APIUserAbortError" ||
    constructorName === "APIUserAbortError" ||
    name === "AbortError"
  ) {
    return { kind: "transport_timeout", message, retryable: true };
  }
  if (
    name === "APITimeoutError" ||
    status === 408 ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return { kind: "transport_timeout", message, retryable: true };
  }
  if (name === "APIConnectionError" || name === "TypeError") {
    return { kind: "transport_error", message, retryable: true };
  }
  return classifyProviderFailureDetails({ status, code, message });
}

function classifyProviderFailureDetails(input: {
  status?: number;
  code?: string;
  message: string;
}): ProviderAttemptFailureOutcome {
  const code = input.code?.toLowerCase() ?? "";
  const lowerMessage = input.message.toLowerCase();
  if (["context_length_exceeded", "context_window_exceeded", "prompt_too_long", "input_too_long"].includes(code)
    || ((input.status === 400 || input.status === 413) && (
      /maximum context length|exceeds? (?:the )?(?:model.s? )?context (?:window|length)|prompt is too long|input tokens exceed/.test(lowerMessage)
    ))) return { kind: "context_overflow", message: input.message, retryable: false };

  if (
    code.includes("invalid_prompt") ||
    code.includes("content_filter") ||
    code.includes("policy") ||
    code.includes("refusal") ||
    lowerMessage.includes("invalid prompt") ||
    lowerMessage.includes("content filter") ||
    lowerMessage.includes("model refused") ||
    lowerMessage.includes("refusal")
  ) {
    return { kind: "refusal", message: input.message, retryable: false };
  }
  if (
    input.status === 401 ||
    input.status === 403 ||
    code.includes("invalid_api_key") ||
    code.includes("authentication") ||
    code.includes("unauthorized")
  ) {
    return { kind: "authentication", message: input.message, retryable: false };
  }
  if (
    input.status === 429 ||
    code.includes("rate_limit") ||
    code.includes("too_many_requests")
  ) {
    return { kind: "rate_limit", message: input.message, retryable: true };
  }
  if (
    input.status === 408 ||
    code.includes("timeout") ||
    code.includes("timed_out") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return { kind: "transport_timeout", message: input.message, retryable: true };
  }
  if (
    (input.status !== undefined && input.status >= 500) ||
    code.includes("server_error") ||
    code.includes("service_unavailable") ||
    code.includes("internal_error")
  ) {
    return { kind: "service_error", message: input.message, retryable: true };
  }
  if (
    code.includes("model_not_found") ||
    code.includes("unknown_model") ||
    code.includes("unsupported") ||
    code.includes("invalid_parameter") ||
    code.includes("invalid_schema") ||
    code.includes("invalid_tool")
  ) {
    return { kind: "configuration", message: input.message, retryable: false };
  }
  if (
    input.status !== undefined
    && input.status >= 400
    && input.status < 500
  ) {
    return { kind: "request_error", message: input.message, retryable: false };
  }
  return { kind: "service_error", message: input.message, retryable: true };
}

function defaultRetryable(kind: ProviderAttemptFailureKind): boolean {
  return (
    kind === "rate_limit" ||
    kind === "service_error" ||
    kind === "transport_timeout" ||
    kind === "transport_error" ||
    kind === "empty_output" ||
    kind === "malformed_output" ||
    kind === "wrong_tool" ||
    kind === "undecodable_structured_output"
  );
}

/** Retry-After can be seconds or an HTTP date; invalid/elapsed values do not delay a route. */
function withTransportDiagnostics(
  outcome: ProviderAttemptFailureOutcome,
  response: SanitizedProviderResponseEvidence,
  now: number,
): ProviderAttemptFailureOutcome {
  const body = asRecord(response.body);
  const error = asRecord(body.error);
  const code = readString(error.code) || readString(body.code) || readString(error.type);
  const errorCode = /^[a-zA-Z0-9_.:-]{1,128}$/.test(code) ? code : undefined;
  const header = response.headers?.["retry-after"]?.trim();
  const delay = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now : NaN;
  const retryAfterMs = outcome.retryable && Number.isFinite(delay) && delay > 0 && delay <= 8.64e15 - now
    ? Math.ceil(delay) : undefined;
  const details = [response.status !== undefined ? `HTTP ${response.status}` : undefined,
    errorCode, retryAfterMs ? `retry after ${retryAfterMs / 1000}s` : undefined,
    response.headers?.["cf-ray"] ? `ray ${response.headers["cf-ray"]}` : undefined].filter(Boolean);
  return { ...outcome,
    ...(response.status !== undefined && { httpStatus: response.status }),
    ...(errorCode && { errorCode }), ...(retryAfterMs && { retryAfterMs }),
    // A captured structured body is more useful than the SDK's no-body summary.
    ...(details.length && { message: `${outcome.message.includes("(no body)") && errorCode ? "Provider request failed" : outcome.message} [${details.join("; ")}]` }),
  };
}

function rawResponseFromError(
  error: unknown,
  credentialValues: readonly string[] = [],
): SanitizedProviderResponseEvidence {
  const record = asRecord(error);
  const response = asRecord(record.response);
  const nativeResponse = record.nativeResponse;
  const status = readNumber(record.status) ?? readNumber(response.status);
  const headers = headersFromUnknown(
    record.headers ?? response.headers,
    credentialValues,
  );
  const rawBody = nativeResponse ?? record.body ??
    record.error ??
    response.body ?? {
      name: readString(record.name),
      message: readString(record.message) || String(error),
      ...(readString(record.code) && { code: readString(record.code) }),
    };
  let sanitizedBody: unknown;
  try {
    sanitizedBody = sanitizeProviderEvidence(rawBody, credentialValues);
  } catch {
    sanitizedBody = safeProviderEvidenceSnapshot(rawBody, credentialValues);
  }
  return {
    ...(status !== undefined && { status }),
    ...(headers && Object.keys(headers).length > 0 && { headers }),
    body: sanitizedBody,
  };
}

function safeProviderEvidenceSnapshot(
  value: unknown,
  credentialValues: readonly string[],
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return sanitizeProviderEvidence(value, credentialValues);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const safe: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (isCredentialField(key)) continue;
    if (!("value" in descriptor)) {
      safe[key] = "[Unavailable during native response decoding]";
      continue;
    }
    try {
      safe[key] = sanitizeProviderEvidence(
        descriptor.value,
        credentialValues,
      );
    } catch {
      safe[key] = "[Unavailable during native response decoding]";
    }
  }
  return safe;
}

function headersFromUnknown(
  value: unknown,
  credentialValues: readonly string[],
): Record<string, string> | undefined {
  if (value instanceof Headers) return sanitizeHeaders(value, credentialValues);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return sanitizeHeaders(
    new Headers(value as Record<string, string>),
    credentialValues,
  );
}

function requestIdFromResponse(
  response: unknown,
  rawResponse?: SanitizedProviderResponseEvidence,
): string | undefined {
  const record = asRecord(response);
  return (
    readString(record._request_id) ||
    readString(record.request_id) ||
    rawResponse?.headers?.["x-request-id"] ||
    rawResponse?.headers?.["request-id"]
  );
}

function requestIdFromError(
  error: unknown,
  rawResponse?: SanitizedProviderResponseEvidence,
): string | undefined {
  const record = asRecord(error);
  return (
    readString(record.request_id) ||
    readString(record.requestId) ||
    rawResponse?.headers?.["x-request-id"] ||
    rawResponse?.headers?.["request-id"]
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isCredentialField(key: string): boolean {
  return CREDENTIAL_FIELD.test(key) || CREDENTIAL_FIELD_SUFFIX.test(key);
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
