"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, listAgents, deleteAgent, type SavedAgent } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { agentPreparationHref } from "@/lib/agent-entry";
import { withManagementReturn } from "./agent-management-navigation";
import { AgentList, agentNeedsAttention, agentActivity } from "./agent-list";
import styles from "./agent-workspace.module.css";
import { AgentWorkspacePanel } from "./agent-workspace-panel";
import { AgentGenerations, useAgentGenerations } from "./agent-generations";
type Draft = { scope: string; name: string; updatedAt: string };
export function AgentsContent() {
  const generations = useAgentGenerations();
  const [attentionOpen, setAttentionOpen] = useState(false);
  const router = useRouter(),
    params = useSearchParams(),
    { authenticated, account } = useAuth();
  const [archive, setArchive] = useState<SavedAgent | null>(null),
    [archiving, setArchiving] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const collection = useQuery({
    queryKey: ["agent-collection", account?.id],
    enabled: authenticated,
    queryFn: async ({ signal }) => {
      const [agents, drafts] = await Promise.all([
        listAgents(signal),
        apiFetch<Draft[]>("/api/agent-profiles/drafts", { signal }),
      ]);
      return { agents, drafts };
    },
    refetchInterval: 5000,
    retry: false,
  });
  const agents = collection.data?.agents ?? [],
    drafts = collection.data?.drafts ?? [],
    loading = collection.isPending,
    error =
      actionError ?? collection.error?.message ?? generations.error?.message;
  const attention = agents.filter(agentNeedsAttention);
  const query = params.get("q") ?? "",
    attentionOnly = params.get("attention") === "1" && attention.length > 0;
  useEffect(() => {
    if (collection.isSuccess && !attention.length && params.get("attention") === "1") {
      const next = new URLSearchParams(params);
      next.delete("attention");
      router.replace("/dashboard/agents" + (next.size ? "?" + next : ""), { scroll: false });
    }
  }, [collection.isSuccess, attention.length, params, router]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace("/dashboard/agents" + (next.size ? "?" + next : ""), {
      scroll: false,
    });
  }
  async function fetchAgents() {
    generations.refresh();
    await collection.refetch();
  }
  const restored = useRef(false);
  useEffect(() => {
    if (collection.data && !restored.current) {
      restored.current = true;
      const at = params.get("at");
      if (at)
        document
          .getElementById("agent-" + at)
          ?.scrollIntoView({ block: "center" });
    }
  }, [collection.data, params]);
  function returnPath(id: string) {
    const next = new URLSearchParams(params);
    next.set("at", id);
    return "/dashboard/agents?" + next;
  }
  function edit(agent: SavedAgent) {
    router.push(
      withManagementReturn(
        "/dashboard/agents/" + agent.id + "/edit",
        returnPath(agent.id),
      ),
    );
  }
  async function confirmArchive() {
    if (!archive || archiving) return;
    setArchiving(true);
    try {
      await deleteAgent(archive.id);
      setArchive(null);
      await fetchAgents();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  }
  const reviewingAgents = agents.filter((agent) => agent.reviewState === "reviewing"),
    entryAgents = agents.filter(
      (agent) => agent.entryIntent && agent.reviewState === "accepted",
    ),
    filtered = agents.filter(
      (agent) =>
        (!attentionOnly || agentNeedsAttention(agent)) &&
        agent.name.toLowerCase().includes(query.toLowerCase()),
    );
  const activityCount = attention.length + reviewingAgents.length +
    generations.rows.length + entryAgents.length + Number(Boolean(error));
  const activityWorking = reviewingAgents.length > 0 || generations.rows.some(
    (row) => row.status === "queued" || row.status === "running",
  );
  useEffect(() => {
    if (!activityCount) setAttentionOpen(false);
  }, [activityCount]);
  const notifications = (
    <>
      <AgentGenerations
        rows={generations.rows}
        onCancelled={(row) => {
          generations.retire(row.id, row.source);
          setAttentionOpen(false);
          void collection.refetch();
        }}
      />
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void fetchAgents()}>
            Retry
          </button>
        </div>
      )}
      {reviewingAgents.length > 0 && (
        <section className={styles.activity} aria-label="Reviewing agents">
          <h2>Reviewing <small>{reviewingAgents.length}</small></h2>
          {reviewingAgents.map((agent) => (
            <div className={styles.attentionRow} key={agent.id}>
              <strong>{agent.name}</strong>
              <Link
                className="action"
                href={withManagementReturn(
                  "/dashboard/agents/" + agent.id + "/profile",
                  returnPath(agent.id),
                )}
              >
                View
              </Link>
            </div>
          ))}
        </section>
      )}
      {attention.length > 0 && (
        <section className={styles.attention}>
          <h2>
            Needs attention <small>{attention.length}</small>
          </h2>
          {attention.map((agent) => (
            <div className={styles.attentionRow} key={agent.id}>
              <div>
                <strong>{agent.name}</strong>
                <p className={styles.meta}>
                  {agentNeedsAttention(agent) && !agent.fullBodyReferenceUrl
                    ? "Full-body image missing"
                    : agentActivity(agent)}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  router.push(
                    withManagementReturn(
                      "/dashboard/agents/" +
                        agent.id +
                        "/edit" +
                        (agent.visualActivity?.id
                          ? "?imageRequest=" + agent.visualActivity.id
                          : ""),
                      returnPath(agent.id),
                    ),
                  )
                }
              >
                {agent.visualActivity?.status === "ready"
                  ? "Review"
                  : agent.visualActivity?.status === "failed"
                    ? "Retry"
                    : "Edit"}
              </button>
            </div>
          ))}
        </section>
      )}
      {entryAgents.map((agent) => (
        <section key={agent.id} className={styles.attentionRow}>
          <p>
            {agent.name} is ready. Continue to your selected{" "}
            {agent.entryIntent?.flow === "join_game" ? "game" : "season"}.
          </p>
          <Link
            className="action"
            href={agentPreparationHref(agent.id, agent.entryIntent!)}
          >
            Continue
          </Link>
        </section>
      ))}
    </>
  );
  return (
    <section className={styles.collection}>
      <Link href="/dashboard">← Dashboard</Link>
      <header className={styles.masthead}>
        <h1>Your agents</h1>
        {activityCount > 0 && (
          <button
            type="button"
            className={styles.managementActivity}
            data-working={activityWorking}
            data-activity-count={activityCount}
            aria-label="Activity"
            aria-describedby="agent-management-activity-count"
            aria-haspopup="dialog"
            aria-expanded={attentionOpen}
            title={`${activityCount} activity ${activityCount === 1 ? "item" : "items"}`}
            onClick={() => setAttentionOpen(true)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".25" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className={styles.managementActivityBadge} aria-hidden="true">
              {activityCount}
            </span>
            <span id="agent-management-activity-count" className="sr-only">
              {activityCount} activity {activityCount === 1 ? "item" : "items"}
            </span>
          </button>
        )}
      </header>
      <div className={styles.managementMain}>
        <div className={styles.toolbar}>
          <div>
            <button
              type="button"
              aria-pressed={!attentionOnly}
              onClick={() => filter("attention", "")}
            >
              All {agents.length}
            </button>
            {attention.length > 0 && (
              <button
                type="button"
                aria-pressed={attentionOnly}
                onClick={() => filter("attention", "1")}
              >
                Needs attention
              </button>
            )}
          </div>
          <input
            type="search"
            aria-label="Find an agent"
            placeholder="Find an agent…"
            value={query}
            onChange={(event) => filter("q", event.target.value)}
          />
        </div>
        {loading ? (
          <p role="status">Loading agents…</p>
        ) : (
          <AgentList
            agents={filtered}
            returnPath={returnPath}
            onEdit={edit}
            onDelete={setArchive}
            archivePending={archiving}
          />
        )}
        {!!drafts.length && (
          <section className={styles.drafts}>
            <h2>Drafts</h2>
            {drafts.map((draft) => (
              <div className={styles.draftRow} key={draft.scope}>
                <div>
                  <h3>{draft.name || "Untitled agent"}</h3>
                  <p className={styles.meta}>
                    Saved {new Date(draft.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Link
                  className="action"
                  href={
                    draft.scope.startsWith("edit:")
                      ? "/dashboard/agents/" + draft.scope.slice(5) + "/edit"
                      : "/agents/create?draft=" +
                        encodeURIComponent(draft.scope)
                  }
                >
                  Continue
                </Link>
              </div>
            ))}
          </section>
        )}
      </div>
      <AgentWorkspacePanel
        open={attentionOpen}
        title="Activity"
        onClose={() => setAttentionOpen(false)}
      >
        {notifications}
      </AgentWorkspacePanel>
      <AgentWorkspacePanel
        open={Boolean(archive)}
        title={archive ? `Archive ${archive.name}?` : "Archive agent"}
        onClose={() => setArchive(null)}
      >
        <p>Game history is retained.</p>
        <div className={styles.confirmationActions}>
          <button
            type="button"
            disabled={archiving}
            onClick={() => setArchive(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={archiving}
            onClick={() => void confirmArchive()}
          >
            {archiving ? "Archiving…" : "Archive"}
          </button>
        </div>
      </AgentWorkspacePanel>
    </section>
  );
}
