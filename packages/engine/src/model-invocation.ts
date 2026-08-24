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

/** Provider-independent message passed from gameplay to a model adapter. */
export interface ModelInvocationMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly ModelInvocationToolCall[];
}

/** Provider-independent function definition. */
export interface ModelInvocationTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ModelInvocationToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export type ModelInvocationResult =
  | { kind: "text" }
  | {
      kind: "structured";
      name: string;
      schema: Record<string, unknown>;
      strict: boolean;
    }
  | {
      kind: "tool";
      tools: readonly ModelInvocationTool[];
      choice: "auto" | "required" | { name: string };
      allowParallel?: boolean;
    };

/** Provider-neutral request for exposing a bounded reasoning summary. */
export type ModelReasoningSummaryMode = "auto" | "concise" | "detailed";

/**
 * The semantic request owned by Agent and House code. It deliberately contains
 * no SDK request types, endpoint choice, or untyped provider-options escape
 * hatch. Adapters compile this contract independently for each manifest entry.
 */
export interface ModelInvocation {
  messages: readonly ModelInvocationMessage[];
  result: ModelInvocationResult;
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
