import type { AvatarCompletion } from "@/lib/api";

export function isAvatarCompletionPending(completion: AvatarCompletion): boolean {
  return completion.status === "accepted" || completion.status === "queued" || completion.status === "processing";
}

export function isAvatarCompletionUnavailable(completion: AvatarCompletion | undefined): boolean {
  return completion?.failureCode === "provider_not_configured";
}

export function isSameAvatarCompletion(
  a: AvatarCompletion | null | undefined,
  b: AvatarCompletion,
): boolean {
  return a?.status === b.status
    && a.generationRequestId === b.generationRequestId
    && a.avatarUrl === b.avatarUrl
    && a.failureCode === b.failureCode
    && a.failureStage === b.failureStage
    && a.retryable === b.retryable
    && a.reason === b.reason;
}
