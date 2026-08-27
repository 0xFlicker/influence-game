import type {
  ModelReasoningEffort,
  ModelRequestCapabilities,
  ProviderProfileId,
} from "./model-catalog";
import type {
  LlmToolChoiceMode,
  OpenAIRequestServiceTier,
} from "./llm-client";
import type { ProviderAttemptAccountingFacts } from "./provider-execution";
import type { ExactStructuredOutputArtifact } from "./structured-output";

/** Provider-independent message passed from gameplay to a model adapter. */
export interface ModelInvocationMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly ModelInvocationToolCall[];
}

export interface ModelInvocationToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export type ModelInvocationResult<TStructuredValue = unknown> =
  | { kind: "text" }
  | {
      kind: "structured";
      artifact: ExactStructuredOutputArtifact<TStructuredValue>;
    }
  | {
      kind: "tool";
      artifact: ExactStructuredOutputArtifact<TStructuredValue>;
      description?: string;
      choice: "auto" | "required" | { name: string };
      allowParallel?: false;
    };

/** Provider-neutral request for exposing a bounded reasoning summary. */
export type ModelReasoningSummaryMode = "auto" | "concise" | "detailed";

/**
 * The semantic request owned by Agent and House code. It deliberately contains
 * no SDK request types, endpoint choice, or untyped provider-options escape
 * hatch. Adapters compile this contract independently for each manifest entry.
 */
export interface ModelInvocation<TStructuredValue = unknown> {
  messages: readonly ModelInvocationMessage[];
  result: ModelInvocationResult<TStructuredValue>;
  outputTokenLimit: number;
  reasoning?: {
    effort?: ModelReasoningEffort;
    summary?: ModelReasoningSummaryMode;
  };
  temperature?: number;
  promptCache?: {
    key: string;
    ttl?: "30m";
  };
}

export interface ProviderRuntimeDescriptor {
  catalogId: string;
  providerProfileId: ProviderProfileId;
  modelId: string;
  modelCapabilities: ModelRequestCapabilities;
  reasoningPolicy: "action-policy" | ModelReasoningEffort;
  toolChoiceMode: LlmToolChoiceMode;
  openAIReasoningSummary?: ModelReasoningSummaryMode;
  openAIServiceTier?: OpenAIRequestServiceTier;
}

export interface ProviderNativeRequest {
  transport: string;
  body: unknown;
}

export interface ProviderNormalizedToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface ProviderReasoningEvidence {
  content?: string;
  summary?: {
    mode: ModelReasoningSummaryMode;
    text: string;
    parts: readonly string[];
    outputItemIds?: readonly string[];
  };
}

/** Provider-neutral result consumed by gameplay validation and tracing. */
export interface ProviderModelOutcome {
  transport: string;
  nativeResponse: unknown;
  responseId?: string;
  requestId?: string;
  text?: string;
  toolCalls: readonly ProviderNormalizedToolCall[];
  refusal?: string;
  stopReason?: string;
  status?: string;
  reasoning?: ProviderReasoningEvidence;
  accounting?: ProviderAttemptAccountingFacts;
  serviceTier?: string;
}

export interface ProviderAdapterCompatibility {
  compatible: boolean;
  reason?: string;
}

export interface ProviderAdapterDispatchOptions {
  signal?: AbortSignal;
  maxRetries: 0;
  headers: Record<string, string>;
}

export interface LlmProviderAdapter {
  readonly id: string;
  validate(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderAdapterCompatibility;
  compile(
    invocation: ModelInvocation,
    runtime: ProviderRuntimeDescriptor,
  ): ProviderNativeRequest;
  dispatch(
    request: ProviderNativeRequest,
    options: ProviderAdapterDispatchOptions,
  ): Promise<ProviderModelOutcome>;
  classifyError(error: unknown, signal?: AbortSignal): import("./provider-execution").ProviderAttemptFailureOutcome;
}
