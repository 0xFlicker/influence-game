import { ProviderUnavailableError, type ProviderUnavailableKind } from "./provider-execution";
import { RetrospectiveContractError } from "./retrospective";
import { RetrospectiveContextCapacityError } from "./retrospective-context";

export type RetrospectiveFailureCode = ProviderUnavailableKind | "capacity_unavailable" | "context_capacity_exceeded" | "invalid_context";
export type RetrospectiveFailureStage = "initialize" | "statement";

/** An exhausted required epilogue step has no rules-legal speech fallback. */
export class RetrospectiveExecutionError extends Error {
  constructor(readonly stage: RetrospectiveFailureStage, readonly code: RetrospectiveFailureCode, cause: unknown) {
    super(`Retrospective ${stage} paused: ${code}`, { cause });
    this.name = "RetrospectiveExecutionError";
  }
}

/** Cancellation and integrity/commit failures retain their existing owner-recovery semantics. */
export function throwRetrospectiveFailure(error: unknown, stage: RetrospectiveFailureStage, signal?: AbortSignal): never {
  signal?.throwIfAborted();
  if (error instanceof RetrospectiveContextCapacityError) throw new RetrospectiveExecutionError(stage, error.reason, error);
  if (error instanceof ProviderUnavailableError && error.outcome.kind !== "cancellation") throw new RetrospectiveExecutionError(stage, error.outcome.kind, error);
  if (error instanceof RetrospectiveContractError) throw new RetrospectiveExecutionError(stage, "invalid_context", error);
  throw error;
}
