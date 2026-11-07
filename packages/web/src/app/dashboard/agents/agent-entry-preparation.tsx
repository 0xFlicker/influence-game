"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAgent, getAgentVisualUpdate, joinFreeQueue, listAgents, startAgentVisualUpdate, type AgentVisualUpdate, type SavedAgent } from "@/lib/api";
import { getGameEntry } from "@/lib/game-entry";
import { gameHref } from "@/lib/game-links";
import { joinGame } from "@/lib/api";
import { joinWerewolfLobby } from "@/lib/werewolf-api";
import { agentEditForEntryHref, agentEntryIntentKey, agentPreparationHref, hasFullBodyAgentArt, type AgentEntryIntent } from "@/lib/agent-entry";

const stages: Record<string, string> = { details: "Preparing missing details…", body: "Creating full-body image…", head: "Locating the head…", portrait: "Preparing portrait…", saving: "Saving agent…" };

/** A single shareable link lets each owner choose the Agent they need to update. */
export function AgentPreparationHome() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void listAgents().then(setAgents).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load your Agents.")); }, []);
  return <section className="influence-panel rounded-2xl p-6 text-white sm:p-8">
    <h1 className="text-3xl font-semibold">Give your Agent a full-body image</h1>
    <p className="mt-3 text-sm leading-6 text-white/70">Choose the Agent you want to update. Automatic completion fills missing details and creates art using your generation allowance. You can edit the Agent yourself instead.</p>
    {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
    {!agents && !error && <p role="status" className="mt-5">Loading Agents…</p>}
    {agents?.length === 0 && <p className="mt-5">You have no saved Agents yet. <Link href="/agents/create" className="underline">Create one</Link>.</p>}
    <div className="mt-6 grid gap-3">{agents?.map(agent => <Link key={agent.id} href={agentPreparationHref(agent.id, { flow: "update" })} className="flex min-h-14 items-center justify-between rounded-lg border border-white/15 p-4 hover:border-amber-200/60"><span>{agent.name}</span><span className="text-sm text-amber-200">{hasFullBodyAgentArt(agent) ? "Image ready" : "Update image →"}</span></Link>)}</div>
  </section>;
}

export function AgentEntryPreparation({ agentId, intent }: { agentId: string; intent: AgentEntryIntent }) {
  const router = useRouter();
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [update, setUpdate] = useState<AgentVisualUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const joining = useRef(false);
  const intentKey = agentEntryIntentKey(agentId, intent);
  const destination = intent.flow === "join_game" ? `/games/${encodeURIComponent(intent.gameId)}` : intent.flow === "daily_free" ? intent.season ? `/seasons?season=${encodeURIComponent(intent.season)}` : "/seasons" : "/dashboard/agents";

  const enter = useCallback(async () => {
    if (joining.current) return;
    joining.current = true; setBusy(true); setError(null);
    try {
      if (intent.flow === "join_game") {
        const game = await getGameEntry(intent.gameId);
        if (game.gameKind === "werewolf") await joinWerewolfLobby(intent.gameId, agentId);
        else await joinGame(intent.gameId, { agentProfileId: agentId });
        sessionStorage.removeItem(intentKey);
        router.replace(gameHref(game.slug));
      } else if (intent.flow === "daily_free") {
        await joinFreeQueue(agentId, intent.seasonId);
        sessionStorage.removeItem(intentKey);
        window.dispatchEvent(new Event("free-queue:changed"));
        router.replace(destination);
      } else {
        sessionStorage.removeItem(intentKey);
        setDone(true);
      }
    } catch (cause) {
      sessionStorage.removeItem(intentKey);
      setError(cause instanceof Error ? cause.message : "Could not enter. Your Agent update is saved; try joining again.");
    } finally { joining.current = false; setBusy(false); }
  }, [agentId, destination, intent, intentKey, router]);

  useEffect(() => {
    const entryErrorKey = `${intentKey}:entry-error`;
    const savedEntryError = sessionStorage.getItem(entryErrorKey);
    if (savedEntryError) {
      setError(`Your Agent was saved, but entry did not succeed: ${savedEntryError}`);
      sessionStorage.removeItem(entryErrorKey);
    }
  }, [intentKey]);

  useEffect(() => {
    let cancelled = false;
    let reading = false;
    async function read() {
      if (reading) return;
      reading = true;
      try {
        const [nextAgent, nextUpdate] = await Promise.all([getAgent(agentId), getAgentVisualUpdate(agentId)]);
        if (cancelled) return;
        setAgent(nextAgent); setUpdate(nextUpdate); setLoadError(null);
        if (nextAgent.ownerContent?.submitted?.disposition === "rejected") sessionStorage.removeItem(intentKey);
        if (hasFullBodyAgentArt(nextAgent) && sessionStorage.getItem(intentKey) === "yes") void enter();
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Could not load this Agent.");
      } finally {
        reading = false;
      }
    }
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 2500);
    window.addEventListener("focus", read);
    window.addEventListener("online", read);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", read); window.removeEventListener("online", read); };
  }, [agentId, enter, intentKey]);

  async function complete() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      sessionStorage.setItem(intentKey, "yes");
      setUpdate(await startAgentVisualUpdate(agentId));
    } catch (cause) {
      sessionStorage.removeItem(intentKey);
      setError(cause instanceof Error ? cause.message : "Could not start the update.");
    } finally { setBusy(false); }
  }

  const working = update?.job?.status === "queued" || update?.job?.status === "processing";
  const held = update?.job?.status === "held" || Boolean(agent?.ownerContent?.submitted?.held);
  const missing = agent ? [
    !agent.fullBodyReferenceUrl && "full-body image",
    !agent.avatarUrl && "portrait",
    !agent.visualDesign?.trim() && "visual design",
    !agent.performanceInstructions?.trim() && "performance details",
    !agent.strategyStyle?.trim() && "Influence strategy",
    !agent.werewolfStrategyStyle?.trim() && "Werewolf strategy",
  ].filter(Boolean) : [];
  return <section className="influence-panel rounded-2xl p-6 text-white sm:p-8" aria-labelledby="prepare-agent-title">
    <p className="text-xs uppercase tracking-[.2em] text-amber-200/70">Your Agent</p>
    <h1 id="prepare-agent-title" className="mt-2 text-3xl font-semibold">{agent ? `Prepare ${agent.name}` : "Preparing your Agent"}</h1>
    <p className="mt-3 text-sm leading-6 text-white/70">A full-body image is required before a new game or Daily Free entry. We’ll fill missing details, create the image and portrait, and save the Agent{intent.flow === "update" ? "." : `, then enter ${intent.flow === "join_game" ? "the game" : "Daily Free"}.`} Existing details stay as they are.</p>
    <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-3" aria-label="Completion steps">
      <li className="rounded-lg border border-white/15 bg-white/5 px-4 py-3"><span className="mr-2 text-amber-200">01</span>Fill missing details</li>
      <li className="rounded-lg border border-white/15 bg-white/5 px-4 py-3"><span className="mr-2 text-amber-200">02</span>Create full-body art</li>
      <li className="rounded-lg border border-white/15 bg-white/5 px-4 py-3"><span className="mr-2 text-amber-200">03</span>{intent.flow === "update" ? "Save Agent" : "Save, then enter"}</li>
    </ol>
    {agent && missing.length > 0 && <p className="mt-4 text-sm text-white/70">Missing: {missing.join(", ")}.</p>}
    <p className="mt-3 text-sm text-amber-100/75">Automatic completion uses your account’s text and image generation allowance. A seat is confirmed after the update is published and the entry succeeds.</p>
    {done && <p role="status" className="mt-6">Agent updated. Their full-body image is ready.</p>}
    {agent && hasFullBodyAgentArt(agent) && intent.flow === "update" && !done && <p role="status" className="mt-6">This Agent already has a full-body image.</p>}
    {working ? <p role="status" aria-live="polite" className="mt-6">{update?.job?.status === "queued" ? "Starting update…" : stages[update?.job?.stage ?? ""] ?? "Updating Agent…"}</p>
      : held ? <p role="status" className="mt-6">Update saved and awaiting review. We’ll enter after it is published while this page is open. You can return later to check.</p>
      : agent?.ownerContent?.submitted?.disposition === "rejected" ? <p role="alert" className="mt-6">This update was not approved. Edit the Agent to revise it.</p>
      : update?.job?.errorCode === "review_rejected" ? <p role="alert" className="mt-6">This update was not approved. Edit the Agent to revise it.</p>
      : null}
    {update?.job?.message && <p role="status" className="mt-3 text-sm text-amber-200">{update.job.message}</p>}
    {(error || loadError) && <p role="alert" className="mt-4 text-sm text-red-300">{error || loadError}</p>}
    <div className="mt-6 flex flex-wrap gap-3">
      {agent && hasFullBodyAgentArt(agent)
        ? intent.flow !== "update" && <button className="influence-button-primary min-h-11 rounded-lg px-5" disabled={busy} onClick={() => void enter()}>{busy ? "Joining…" : intent.flow === "join_game" ? "Join game" : "Enter Daily Free"}</button>
        : !working && !held && update?.job?.errorCode !== "review_rejected" && <button className="influence-button-primary min-h-11 rounded-lg px-5" disabled={busy || !agent || !update} onClick={() => void complete()}>{busy ? "Starting…" : update?.job?.status === "failed" || update?.job?.status === "conflict" ? "Retry completion" : intent.flow === "update" ? "Complete Agent" : "Complete & join"}</button>}
      <Link className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-5" href={agentEditForEntryHref(agentId, intent)}>Edit Agent</Link>
      <Link className="inline-flex min-h-11 items-center text-sm underline" href={destination}>Back</Link>
    </div>
  </section>;
}
