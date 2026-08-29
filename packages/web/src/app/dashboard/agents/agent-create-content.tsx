"use client";

import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import {
  createAgent,
  ApiError,
  getAgent,
  getAgentByCreationRequestId,
  getGame,
  joinFreeQueue,
  joinGame,
  updateAgent,
  type AgentProfileWriteParams,
  type CreateAgentParams,
  type SavedAgent,
  type UpdateAgentParams,
} from "@/lib/api";
import { AgentForm } from "./agent-form";
import { readEditorStorage, removeEditorStorage, writeEditorStorage } from "./agent-editor-storage";

export type AgentCreateFlow = "manage" | "join_game" | "daily_free";

export function AgentCreateContent({
  flow = "manage",
  gameId,
}: {
  flow?: AgentCreateFlow;
  gameId?: string;
}) {
  const router = useRouter();
  const createdAgentId = useRef<string | null>(null);
  const createBaseline = useRef<AgentProfileWriteParams | null>(null);

  async function handleCreate(
    params: AgentProfileWriteParams,
    { creationRequestId }: { creationRequestId: string },
  ) {
    const createParams: CreateAgentParams = { ...params, creationRequestId };
    const continuationKey = `influence:agent-create-continuation:${creationRequestId}`;
    const baselineKey = `influence:agent-create-baseline:${creationRequestId}`;
    const storedContinuation = readEditorStorage(continuationKey);
    const storedAgentId = storedContinuation.ok ? storedContinuation.value : null;
    if (storedAgentId && !isUuid(storedAgentId)) removeEditorStorage(continuationKey);
    const continuationAgentId = createdAgentId.current
      ?? (storedAgentId && isUuid(storedAgentId) ? storedAgentId : null);
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

    let joinTarget: Awaited<ReturnType<typeof getGame>> | null = null;
    if (agent) {
      const baseline = createBaseline.current ?? readCreateBaseline(baselineKey);
      if (!baseline) {
        throw new Error("This Agent was created, but the original save snapshot is unavailable. Open the saved Agent to continue editing safely.");
      }
      const update = buildRecoveredUpdate(baseline, params, agent);
      if (Object.keys(update).length > 0) {
        agent = await updateAgent(agent.id, {
          ...update,
          ...(agent.profileRevisionId ? { expectedRevisionId: agent.profileRevisionId } : {}),
        });
      }
    } else {
      if (flow === "join_game") {
        if (!gameId) throw new Error("The game to join is no longer available.");
        joinTarget = await getGame(gameId);
        if (joinTarget.status !== "waiting") {
          throw new Error("This game is no longer accepting players.");
        }
      }
      createBaseline.current = params;
      if (!writeEditorStorage(baselineKey, JSON.stringify(params))) {
        throw new Error("Creation recovery is unavailable in this browser. Check browser storage before creating the Agent.");
      }
      agent = await createAgent(createParams);
    }
    createBaseline.current = params;
    writeEditorStorage(baselineKey, JSON.stringify(params));
    createdAgentId.current = agent.id;
    writeEditorStorage(continuationKey, agent.id);
    if (flow === "join_game" && gameId) {
      await joinGame(gameId, { agentProfileId: agent.id });
      const joinedGame = joinTarget ?? await getGame(gameId);
      removeEditorStorage(continuationKey);
      removeEditorStorage(baselineKey);
      router.replace(`/games/${encodeURIComponent(joinedGame.slug)}`);
      return;
    }
    if (flow === "daily_free") {
      await joinFreeQueue(agent.id);
      removeEditorStorage(continuationKey);
      removeEditorStorage(baselineKey);
      window.dispatchEvent(new Event("free-queue:changed"));
      router.replace("/games/free");
      return;
    }
    removeEditorStorage(continuationKey);
    removeEditorStorage(baselineKey);
    router.replace("/dashboard/agents");
  }

  const context = flow === "join_game"
    ? {
        title: "Create an Agent and join",
        description: "Build a saved competitor, then enter the selected game.",
        submitLabel: "Create & join",
        cancelPath: gameId ? `/dashboard?joinGameId=${encodeURIComponent(gameId)}` : "/dashboard",
      }
    : flow === "daily_free"
      ? {
          title: "Create an Agent for Daily Free",
          description: "Build a saved competitor and enter the next Daily Free game.",
          submitLabel: "Create & enter",
          cancelPath: "/games/free",
        }
      : {
          title: "Create Agent",
          description: "Build a saved competitor you can develop across games.",
          submitLabel: "Create Agent",
          cancelPath: "/dashboard/agents",
        };

  return (
    <div>
      <header className="mb-7 sm:mb-9">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/40">
          <Link href="/dashboard" className="transition-colors hover:text-text-primary">Dashboard</Link>
          <span aria-hidden="true">/</span>
          <Link href="/dashboard/agents" className="transition-colors hover:text-text-primary">Agents</Link>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">{context.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">{context.description}</p>
      </header>
      <AgentForm
        draftScope={`create:${flow}:${gameId ?? "none"}`}
        onSubmit={handleCreate}
        onCancel={() => router.replace(context.cancelPath)}
        submitLabel={context.submitLabel}
      />
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readCreateBaseline(key: string): AgentProfileWriteParams | null {
  const stored = readEditorStorage(key);
  if (!stored.ok || !stored.value) return null;
  try {
    const parsed = JSON.parse(stored.value) as Partial<AgentProfileWriteParams>;
    return typeof parsed.name === "string"
      && typeof parsed.personality === "string"
      && typeof parsed.gender === "string"
      ? parsed as AgentProfileWriteParams
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
  const fields = ["name", "personality", "backstory", "strategyStyle", "personaKey", "gender", "avatarUrl"] as const;
  for (const field of fields) {
    const baseValue = comparableValue(baseline[field]);
    const localValue = comparableValue(local[field]);
    if (localValue === baseValue) continue;
    const remoteValue = comparableValue(remote[field]);
    if (remoteValue !== baseValue && remoteValue !== localValue) {
      throw new Error(`The saved Agent's ${fieldLabel(field)} changed in another session. Open the Agent editor to merge those changes safely.`);
    }
    Object.assign(update, { [field]: local[field] });
  }
  if (local.avatarGenerationRequestId !== baseline.avatarGenerationRequestId) {
    update.avatarGenerationRequestId = local.avatarGenerationRequestId;
  }
  return update;
}

function comparableValue(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function fieldLabel(field: string): string {
  return field === "strategyStyle" ? "Strategy" : field === "personaKey" ? "base persona" : field;
}
