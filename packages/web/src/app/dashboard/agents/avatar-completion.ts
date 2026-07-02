import type { AvatarCompletion } from "@/lib/api";

export function isAvatarCompletionPending(completion: AvatarCompletion): boolean {
  return completion.status === "accepted" || completion.status === "queued" || completion.status === "processing";
}

export function isAvatarCompletionUnavailable(completion: AvatarCompletion | undefined): boolean {
  return completion?.failureCode === "provider_not_configured";
}
