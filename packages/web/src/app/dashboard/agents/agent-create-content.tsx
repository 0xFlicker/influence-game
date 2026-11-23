"use client";

import { parseCharacterHeadPosition } from "@influence/engine/character-portrait";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  createAgent,
  ApiError,
  getAgent,
  getAgentByCreationRequestId,
  getFreeQueueStatus,
  updateAgent,
  type AgentProfileWriteParams,
  type CreateAgentParams,
  type SavedAgent,
  type UpdateAgentParams,
} from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { getGameEntry } from "@/lib/game-entry";
import { gameHref } from "@/lib/game-links";
import { agentPreparationHref } from "@/lib/agent-entry";
import { AgentIssueNotice, agentIssue } from "./agent-issue";
import { AgentForm } from "./agent-form";
import { pinSeasonCreationTarget } from "./season-creation-target";
import {
  readEditorStorage,
  removeEditorStorage,
  writeEditorStorage,
} from "./agent-editor-storage";

export type AgentCreateFlow = "manage" | "join_game" | "daily_free";

export function AgentCreateRulesLink({
  werewolf = false,
}: { werewolf?: boolean } = {}) {
  return (
    <>
      {" "}
      <Link
        href={werewolf ? "/rules?game=werewolf" : "/rules"}
        className="influence-link"
      >
        Read the Rules
      </Link>{" "}
      before setting their strategy.
    </>
  );
}

export function AgentCreateContent({
  flow = "manage",
  gameId,
  seasonId,
  seasonSlug,
  draftScope,
  imageRequest,
  ideaRequest,
}: {
  ideaRequest?: string;
  imageRequest?: string;
  draftScope?: string;
  flow?: AgentCreateFlow;
  gameId?: string;
  seasonId?: string;
  seasonSlug?: string;
}) {
  const router = useRouter();
  const { authenticated, ready, account } = useAuth();
  const target = useQuery({
    queryKey: ["agent-create-target", gameId, account?.publicId],
    queryFn: ({ signal }) => getGameEntry(gameId!, signal),
    enabled: flow === "join_game" && !!gameId && ready,
    retry: false,
  });
  const [mode, setMode] = useState<"assistant" | "advanced">("assistant");
  const createdAgentId = useRef<string | null>(null);
  const createBaseline = useRef<AgentProfileWriteParams | null>(null);

  async function handleCreate(
    params: AgentProfileWriteParams,
    { creationRequestId }: { creationRequestId: string },
  ) {
    if (flow === "join_game" && !gameId) throw new Error("Choose the game you want to join.");
    const targetSeasonId =
      flow === "daily_free"
        ? (seasonId ?? (await getFreeQueueStatus()).acceptingSeasonId)
        : undefined;
    if (flow === "daily_free" && !targetSeasonId)
      throw new Error(
        "There is no accepting season. Your agent draft is retained.",
      );
    const expectedSeasonId = targetSeasonId
      ? pinSeasonCreationTarget(creationRequestId, targetSeasonId)
      : undefined;
    const entryIntent =
      flow === "join_game" && gameId
        ? { flow: "join_game" as const, gameId }
        : flow === "daily_free" && expectedSeasonId
          ? {
              flow: "daily_free" as const,
              seasonId: expectedSeasonId,
              ...(seasonSlug ? { season: seasonSlug } : {}),
            }
          : undefined;
    const createParams: CreateAgentParams = {
      ...params,
      creationRequestId,
      entryIntent,
    };
    const continuationKey = `influence:agent-create-continuation:${creationRequestId}`;
    const baselineKey = `influence:agent-create-baseline:${creationRequestId}`;
    const storedContinuation = readEditorStorage(continuationKey);
    const storedAgentId = storedContinuation.ok
      ? storedContinuation.value
      : null;
    if (storedAgentId && !isUuid(storedAgentId))
      removeEditorStorage(continuationKey);
    const continuationAgentId =
      createdAgentId.current ??
      (storedAgentId && isUuid(storedAgentId) ? storedAgentId : null);
    let agent = null;
    if (continuationAgentId) {
      try {
        agent = await getAgent(continuationAgentId);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        createdAgentId.current = null;
        removeEditorStorage(continuationKey);
      }
    }
    agent ??= await getAgentByCreationRequestId(creationRequestId);

    if (agent) {
      const baseline =
        createBaseline.current ?? readCreateBaseline(baselineKey);
      if (!baseline) {
        throw new Error(
          "This Agent was created, but the original save snapshot is unavailable. Open the saved Agent to continue editing safely.",
        );
      }
      const update = buildRecoveredUpdate(baseline, params, agent);
      if (Object.keys(update).length > 0) {
        agent = await updateAgent(agent.id, {
          ...update,
          submissionId: params.submissionId,
          expectedContentRevisionId:
            agent.latestContentRevisionId ?? agent.contentRevisionId ?? null,
          ...(agent.profileRevisionId
            ? { expectedRevisionId: agent.profileRevisionId }
            : {}),
        });
      }
    } else {
      createBaseline.current = params;
      if (!writeEditorStorage(baselineKey, JSON.stringify(params))) {
        throw new Error(
          "Creation recovery is unavailable in this browser. Check browser storage before creating the Agent.",
        );
      }
      agent = await createAgent(createParams);
    }
    createBaseline.current = params;
    writeEditorStorage(baselineKey, JSON.stringify(params));
    createdAgentId.current = agent.id;
    writeEditorStorage(continuationKey, agent.id);

    removeEditorStorage(continuationKey);
    removeEditorStorage(baselineKey);
    router.replace(entryIntent
      ? agentPreparationHref(agent.id, entryIntent)
      : "/dashboard/agents");
    return agent;
  }

  const context =
    flow === "join_game"
      ? {
          title: "Create an Agent and join",
          description:
            "Build a saved competitor, then enter the selected game.",
          submitLabel: "Create & join",
          cancelPath: gameId ? gameHref(target.data?.slug ?? gameId) : "/games",
        }
      : flow === "daily_free"
        ? {
            title: "Create your season agent",
            description: "Your new agent will join the selected season.",
            submitLabel: "Create & enter",
            cancelPath: seasonSlug
              ? `/seasons?season=${encodeURIComponent(seasonSlug)}`
              : "/seasons",
          }
        : {
            title: "Create Agent",
            description:
              "Build a saved competitor you can develop across games.",
            submitLabel: "Create",
            cancelPath: "/dashboard/agents",
          };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {target.error && (
        <AgentIssueNotice
          issue={agentIssue("entry_load_failed", "entry")}
          onAction={() => {
            void target.refetch();
          }}
        />
      )}
      <AgentForm
        publicPreview
        ideaRequest={ideaRequest}
        imageRequest={imageRequest}
        guided={mode === "assistant"}
        onAdvanced={() => setMode("advanced")}
        onAssistant={() => setMode("assistant")}
        draftScope={
          draftScope ?? `create:${flow}:${gameId ?? seasonId ?? "none"}`
        }
        onSubmit={handleCreate}
        onCancel={() =>
          router.replace(authenticated ? context.cancelPath : "/games")
        }
        submitLabel={context.submitLabel}
      />
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function readCreateBaseline(key: string): AgentProfileWriteParams | null {
  const stored = readEditorStorage(key);
  if (!stored.ok || !stored.value) return null;
  try {
    const parsed = JSON.parse(stored.value) as Partial<AgentProfileWriteParams>;
    return typeof parsed.name === "string" &&
      typeof parsed.personality === "string" &&
      typeof parsed.gender === "string"
      ? (parsed as AgentProfileWriteParams)
      : null;
  } catch {
    return null;
  }
}

export function buildRecoveredUpdate(
  baseline: AgentProfileWriteParams,
  local: AgentProfileWriteParams,
  remote: SavedAgent,
): UpdateAgentParams {
  const update: UpdateAgentParams = {};
  const fields = [
    "modelPreference",
    "voiceId",
    "name",
    "personality",
    "backstory",
    "strategyStyle",
    "werewolfStrategyStyle",
    "personaKey",
    "gender",
    "avatarUrl",
    "performanceInstructions",
    "fullBodyReferenceUrl",
    "visualDesign",
    "portraitCrop",
    "headPosition",
  ] as const;
  for (const field of fields) {
    const baseValue = comparableValue(baseline[field], field);
    const localValue = comparableValue(local[field], field);
    if (localValue === baseValue) continue;
    const remoteValue = comparableValue(remote[field], field);
    if (remoteValue === localValue) continue;
    if (remoteValue !== baseValue) {
      throw new Error(
        `The saved Agent's ${fieldLabel(field)} changed in another session. Open the Agent editor to merge those changes safely.`,
      );
    }
    Object.assign(update, { [field]: local[field] });
  }
  return update;
}

function comparableValue(value: unknown, field?: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const comparable =
    field === "headPosition" ? parseCharacterHeadPosition(value) : value;
  return typeof comparable === "object"
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(comparable).sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
    : String(comparable);
}

function fieldLabel(field: string): string {
  return field === "strategyStyle"
    ? "Strategy"
    : field === "personaKey"
      ? "base persona"
      : field;
}
