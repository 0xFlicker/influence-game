"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { SupportLink } from "@/components/generation-contact-modal";
import styles from "./agent-workspace.module.css";

export type AgentIssueScope =
  | "draft"
  | "assistant"
  | "artwork"
  | "portrait"
  | "voice"
  | "save"
  | "load"
  | "entry";
type Recovery = "retry" | "discard" | "reload" | "sign_in" | "none";
const copy = {
  account_changed: ["Your account changed.", "reload"],
  sign_in: ["Sign in to continue.", "sign_in"],
  unavailable: ["This agent is unavailable.", "reload"],
  draft_pending: ["Resume or discard your draft.", "discard"],
  request_unavailable: ["Re-enter your request.", "none"],
  assistant_timeout: ["Character update timed out.", "none"],
  draft_conflict: ["Draft changed in another tab.", "reload"],
  draft_unreadable: ["This draft can’t be opened.", "discard"],
  draft_failed: ["Couldn’t save draft.", "retry"],
  draft_load_failed: ["Couldn’t load draft.", "reload"],
  draft_local_unavailable: ["Browser recovery is unavailable.", "none"],
  discard_failed: ["Couldn’t discard draft.", "discard"],
  assistant_failed: ["Couldn’t update character.", "none"],
  assistant_input: ["Describe your changes first.", "none"],
  image_pending: ["Finish or discard the current image.", "discard"],
  artwork_recovery_required: ["Image generation stopped.", "discard"],
  artwork_not_found: ["Image request is unavailable.", "discard"],
  artwork_changed: ["Artwork changed in another tab.", "reload"],
  artwork_select_failed: ["Couldn’t select artwork.", "none"],
  artwork_discard_failed: ["Couldn’t discard artwork.", "none"],
  artwork_failed: ["Couldn’t create image.", "retry"],
  background_failed: ["Couldn’t finish image.", "retry"],
  portrait_failed: ["Couldn’t save portrait.", "retry"],
  image_load_failed: ["Couldn’t load artwork.", "retry"],
  voice_failed: ["Couldn’t play sample.", "none"],
  save_failed: ["Couldn’t save agent.", "retry"],
  save_conflict: ["Agent changed. Reopen to compare.", "reload"],
  load_failed: ["Couldn’t load agent.", "retry"],
  entry_load_failed: ["Couldn’t load game entry.", "retry"],
  generation_unavailable: ["Generation is unavailable.", "none"],
  entry_failed: ["Couldn’t enter. Your agent is saved.", "retry"],
  generation_exhausted: ["Generation limit reached.", "none"],
  generation_paused: ["Generation is paused.", "none"],
  generation_pending: ["An image is already generating.", "none"],
  generations_load_failed: ["Couldn’t load image requests.", "reload"],
  generation_cancel_failed: ["Couldn’t cancel image.", "none"],
  generation_busy: ["Generation is busy.", "none"],
  generation_throttled: ["Please wait before generating again.", "none"],
  generation_recovery_required: ["Generation needs support.", "none"],
} as const satisfies Record<string, readonly [string, Recovery]>;
export type AgentIssueCode = keyof typeof copy;
export interface AgentIssue {
  requestId?: string;
  scope: AgentIssueScope;
  code: AgentIssueCode;
  message: string;
  recovery: Recovery;
}
const defaults: Record<AgentIssueScope, AgentIssueCode> = {
  draft: "draft_failed",
  assistant: "assistant_failed",
  artwork: "artwork_failed",
  portrait: "portrait_failed",
  voice: "voice_failed",
  save: "save_failed",
  load: "load_failed",
  entry: "entry_failed",
};
export function agentIssue(
  cause: unknown,
  scope: AgentIssueScope,
  fallback: AgentIssueCode = defaults[scope],
): AgentIssue {
  let code = fallback;
  if (typeof cause === "string" && Object.hasOwn(copy, cause))
    code = cause as AgentIssueCode;
  else if (
    cause instanceof Error &&
    ["TimeoutError", "AbortError"].includes(cause.name) &&
    scope === "assistant"
  )
    code = "assistant_timeout";
  else if (cause instanceof ApiError) {
    if (cause.code && Object.hasOwn(copy, cause.code))
      code = cause.code as AgentIssueCode;
    else if (cause.code === "request_conflict") code = "artwork_changed";
    else if (cause.status === 401) code = "sign_in";
    else if (cause.status === 403) code = "unavailable";
    else if (cause.status === 404 && scope === "artwork")
      code = "artwork_not_found";
    else if (cause.status === 409 && scope === "draft") code = "draft_conflict";
    else if (cause.status === 409 && scope === "save") code = "save_conflict";
  }
  return {
    scope,
    code,
    message: copy[code][0],
    recovery: copy[code][1],
    ...(cause instanceof ApiError &&
    typeof cause.payload?.requestId === "string"
      ? { requestId: cause.payload.requestId }
      : {}),
  };
}
export function useAgentIssue(scope: AgentIssueScope) {
  const [issue, setIssue] = useState<AgentIssue | null>(null);
  const update = useCallback(
    (cause: unknown, fallback?: AgentIssueCode) =>
      setIssue(cause == null ? null : agentIssue(cause, scope, fallback)),
    [scope],
  );
  return [issue, update] as const;
}

/** One short message. Technical evidence remains in the retained request, not the UI. */
export function AgentIssueNotice({
  issue,
  onAction,
  agentId,
  requestId,
}: {
  issue: AgentIssue;
  onAction?: () => void;
  agentId?: string;
  requestId?: string;
}) {
  const labels = {
    retry: "Retry",
    discard: "Discard",
    reload: "Reload",
    sign_in: "Sign in",
    none: "",
  };
  return (
    <div role="alert" className={styles.issue} data-agent-issue={issue.scope}>
      <span>{issue.message}</span>
      <div className={styles.issueActions}>
        {onAction && issue.recovery !== "none" && (
          <button type="button" onClick={onAction}>
            {labels[issue.recovery]}
          </button>
        )}
        <SupportLink
          className={styles.supportLink}
          agentId={agentId}
          requestId={issue.requestId ?? requestId}
          issueCode={issue.code}
        />
      </div>
    </div>
  );
}
