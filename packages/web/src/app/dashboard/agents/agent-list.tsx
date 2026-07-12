"use client";

import Link from "next/link";
import type { AvatarCompletion, SavedAgent } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AgentAvatarPreview } from "@/components/agent-avatar-preview";
import { isAvatarCompletionPending, isAvatarCompletionUnavailable } from "./avatar-completion";

interface AgentListProps {
  agents: SavedAgent[];
  avatarCompletions?: Record<string, AvatarCompletion>;
  avatarGenerationBusy?: Record<string, boolean>;
  onGenerateAvatar?: (agent: SavedAgent) => void;
  onEdit: (agent: SavedAgent) => void;
  onDelete: (agent: SavedAgent) => void;
}

function getPersonaInfo(key: string | null) {
  if (!key) return undefined;
  return PERSONAS.find((p) => p.key === key);
}

function WinRate({ agent }: { agent: SavedAgent }) {
  if (agent.gamesPlayed === 0) {
    return <span className="influence-copy-muted text-xs">No games yet</span>;
  }
  const losses = agent.gamesPlayed - agent.gamesWon;
  const rate = Math.round((agent.gamesWon / agent.gamesPlayed) * 100);
  return (
    <span className="text-xs influence-copy">
      {agent.gamesWon}W / {losses}L
      <span className="influence-copy-muted ml-1">({rate}%)</span>
    </span>
  );
}

export function AgentList({
  agents,
  avatarCompletions = {},
  avatarGenerationBusy = {},
  onGenerateAvatar,
  onEdit,
  onDelete,
}: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="influence-empty-state rounded-xl p-8 text-center text-sm">
        No saved agents yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {agents.map((agent) => {
        const persona = getPersonaInfo(agent.personaKey);
        const avatarCompletion = avatarCompletions[agent.id];
        const isAvatarBusy = Boolean(avatarGenerationBusy[agent.id]);
        const isAvatarPending = avatarCompletion ? isAvatarCompletionPending(avatarCompletion) : false;
        const canGenerateAvatar = !agent.avatarUrl && onGenerateAvatar;
        return (
          <div
            key={agent.id}
            className="influence-panel rounded-xl p-4 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <AgentAvatarPreview
                  avatarUrl={agent.avatarUrl}
                  personaKey={agent.personaKey}
                  name={agent.name}
                  gamesPlayed={agent.gamesPlayed}
                  gamesWon={agent.gamesWon}
                  size="10"
                />

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-text-primary font-medium text-sm truncate">{agent.name}</h3>
                    {persona && (
                      <span className="influence-copy-muted text-xs shrink-0">{persona.name}</span>
                    )}
                  </div>
                  <p className="influence-copy text-xs mt-0.5 line-clamp-1">{agent.backstory}</p>
                  <div className="mt-1.5">
                    <WinRate agent={agent} />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                {canGenerateAvatar && (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => canGenerateAvatar(agent)}
                      disabled={
                        isAvatarBusy
                        || isAvatarPending
                        || avatarCompletion?.status === "completed"
                        || avatarCompletion?.status === "already_provided"
                        || isAvatarCompletionUnavailable(avatarCompletion)
                      }
                      className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {getAvatarGenerationButtonLabel(avatarCompletion, isAvatarBusy)}
                    </button>
                    {avatarCompletion && (
                      <p className="max-w-[13rem] text-right text-[11px] leading-snug influence-copy-muted">
                        {getAvatarGenerationStatusLabel(avatarCompletion)}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/agents/${agent.id}`}
                    className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg"
                  >
                    Analyze
                  </Link>
                  <button
                    onClick={() => onEdit(agent)}
                    className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(agent)}
                    className="influence-button-danger text-xs px-3 py-1.5 rounded-lg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getAvatarGenerationButtonLabel(completion: AvatarCompletion | undefined, isBusy: boolean): string {
  if (isBusy) return "Requesting...";
  if (!completion) return "Generate Portrait";
  if (isAvatarCompletionPending(completion)) return "Generating...";
  if (completion.status === "completed") return "Generated";
  if (isAvatarCompletionUnavailable(completion)) return "Unavailable";
  if (completion.failureCode === "quota_exhausted" || completion.failureCode === "rate_limited") return "Retry Portrait";
  if (completion.status === "failed") return "Retry Portrait";
  return "Generate Portrait";
}

function getAvatarGenerationStatusLabel(completion: AvatarCompletion): string {
  switch (completion.status) {
    case "accepted":
    case "queued":
    case "processing":
      return "Portrait generation is in progress.";
    case "completed":
      return "Portrait generated. Refreshing roster.";
    case "already_provided":
      return "Portrait already set.";
    case "skipped":
      return getSkippedAvatarStatusLabel(completion);
    case "failed":
      return getFailedAvatarStatusLabel(completion);
  }
}

function getSkippedAvatarStatusLabel(completion: AvatarCompletion): string {
  switch (completion.failureCode) {
    case "provider_not_configured":
      return "Avatar generation is not configured here.";
    case "quota_exhausted":
      return "Avatar generation quota was exhausted. Try again.";
    case "rate_limited":
      return "Avatar generation daily limit was reached. Try again.";
    case "avatar_already_provided":
      return "Portrait already set.";
    default:
      return completion.reason ?? "Portrait generation was skipped.";
  }
}

function getFailedAvatarStatusLabel(completion: AvatarCompletion): string {
  const phase = completion.failureStage ? ` (${avatarFailureStageLabel(completion.failureStage)})` : "";
  const retry = completion.retryable ? " Try again." : "";
  return `${completion.reason ?? "Portrait generation failed."}${phase}${retry}`;
}

function avatarFailureStageLabel(stage: NonNullable<AvatarCompletion["failureStage"]>): string {
  switch (stage) {
    case "provider_submit":
      return "provider start";
    case "provider_poll":
      return "provider status";
    case "asset_select":
      return "image result";
    case "asset_download":
      return "image download";
    case "avatar_store":
      return "storage";
    case "profile_update":
      return "profile update";
  }
}
