"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { SupportLink } from "@/components/generation-contact-modal";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import styles from "./agent-workspace.module.css";
export interface AgentGeneration {
  id: string;
  source: "reference" | "avatar" | "preparation" | "reservation";
  name: string;
  agentId: string | null;
  draftScope: string | null;
  status: "queued" | "running" | "stopped" | "ready";
  stage: string;
  createdAt: string;
  blocksGeneration: boolean;
}
export function useAgentGenerations() {
  const { authenticated, account } = useAuth();
  const owner = authenticated ? account?.id : null;
  const [state, setState] = useState<{
    owner: string | null | undefined;
    rows: AgentGeneration[];
    loaded: boolean;
  }>({ owner: null, rows: [], loaded: false });
  const [error, setError] = useAgentIssue("artwork");
  const [version, setVersion] = useState(0);
  const epoch = useRef(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const retire = useCallback(
    (id: string, source: AgentGeneration["source"]) => {
      ++epoch.current;
      setState((value) => ({
        ...value,
        rows: value.rows.filter(
          (row) => row.id !== id || row.source !== source,
        ),
      }));
      setVersion((value) => value + 1);
    },
    [],
  );

  useEffect(() => {
    const current = ++epoch.current;
    if (!owner) return;
    const controller = new AbortController();
    let fetching = false;
    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const rows = await apiFetch<AgentGeneration[]>(
          "/api/agent-profiles/generations",
          { signal: controller.signal },
        );
        if (!Array.isArray(rows)) throw new Error("Invalid image activity");
        if (current === epoch.current && !controller.signal.aborted) {
          setState({ owner, rows, loaded: true });
          setError(null);
        }
      } catch (cause) {
        if (current === epoch.current && !controller.signal.aborted)
          setError(cause, "generations_load_failed");
      } finally {
        fetching = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [owner, version, setError]);
  return {
    rows: owner && state.owner === owner ? state.rows : [],
    loading: !!owner && (!state.loaded || state.owner !== owner),
    error: owner ? error : null,
    refresh,
    retire,
  };
}
export function generationHref(row: AgentGeneration) {
  const params = new URLSearchParams();
  if (row.source === "reference") params.set("imageRequest", row.id);
  if (!row.agentId && row.draftScope) params.set("draft", row.draftScope);
  return (
    (row.agentId ? `/dashboard/agents/${row.agentId}/edit` : "/agents/create") +
    (params.size ? "?" + params.toString() : "")
  );
}
export function AgentGenerations({
  rows,
  onCancelled,
  onReview,
  currentAgentId,
  currentDraftScope,
  disabled = false,
}: {
  currentAgentId?: string;
  currentDraftScope?: string;
  rows: AgentGeneration[];
  onCancelled: (row: AgentGeneration) => void;
  onReview?: (row: AgentGeneration) => void;
  disabled?: boolean;
}) {
  const [target, setTarget] = useState<AgentGeneration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useAgentIssue("artwork");
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = rows.some(
    (row) => row.status === "queued" || row.status === "running",
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (target) dialog.current?.showModal();
    else dialog.current?.close();
  }, [target]);
  async function cancel() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        `/api/agent-profiles/generations/${encodeURIComponent(target.id)}/cancel`,
        { method: "POST", body: JSON.stringify({ source: target.source }) },
      );
      onCancelled(target);
      setTarget(null);
    } catch (cause) {
      setError(cause, "generation_cancel_failed");
    } finally {
      setBusy(false);
    }
  }
  const action = (row: AgentGeneration) =>
    row.status === "stopped"
      ? "Clear"
      : row.status === "ready"
        ? "Discard"
        : "Cancel";
  return (
    <>
      {!!rows.length && (
        <section className={styles.generations} aria-label="Image requests">
          <h2>
            Image requests <small>{rows.length}</small>
          </h2>
          {rows.map((row) => {
            const seconds = Math.max(
              0,
              Math.floor((now - Date.parse(row.createdAt)) / 1000),
            );
            const label =
              row.status === "queued"
                ? "Waiting to start"
                : row.status === "stopped"
                  ? "Generation stopped"
                  : row.status === "ready"
                    ? "Image ready"
                    : row.stage === "details"
                      ? "Preparing image"
                      : row.stage === "saving"
                        ? "Saving changes"
                        : row.stage === "background"
                          ? "Removing background"
                          : ["head", "portrait"].includes(row.stage)
                            ? "Preparing portrait"
                            : "Generating image";
            return (
              <div
                className={styles.generationRow}
                key={row.source + row.id}
                data-status={row.status}
              >
                <div>
                  <strong>{row.name}</strong>
                  <p role="status">
                    {label}
                    {["queued", "running"].includes(row.status) && (
                      <span className={styles.meta} aria-hidden="true">
                        {" "}
                        · {Math.floor(seconds / 60)}:
                        {String(seconds % 60).padStart(2, "0")}
                      </span>
                    )}
                  </p>
                </div>
                <div className={styles.generationActions}>
                  {row.source !== "reservation" &&
                    (row.status === "ready" &&
                    onReview &&
                    (row.agentId
                      ? row.agentId === currentAgentId
                      : row.draftScope === currentDraftScope) ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onReview(row)}
                      >
                        Review
                      </button>
                    ) : (
                      <Link href={generationHref(row)}>
                        {row.status === "ready" ? "Review" : "View"}
                      </Link>
                    ))}
                  {!(
                    row.source === "preparation" &&
                    row.status === "running" &&
                    row.stage === "saving"
                  ) && (
                    <button
                      type="button"
                      disabled={disabled || busy}
                      aria-label={`${action(row)} image for ${row.name}`}
                      onClick={() => {
                        setError(null);
                        setTarget(row);
                      }}
                    >
                      {action(row)}
                    </button>
                  )}
                  {row.status === "stopped" && (
                    <SupportLink
                      className={styles.supportLink}
                      agentId={row.agentId ?? undefined}
                      requestId={row.id}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
      <dialog
        ref={dialog}
        className={styles.generationDialog}
        aria-label={
          target?.status === "ready"
            ? "Discard image?"
            : target?.status === "stopped"
              ? "Clear request?"
              : "Cancel image?"
        }
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setTarget(null);
        }}
      >
        <h2>
          {target?.status === "ready"
            ? "Discard image?"
            : target?.status === "stopped"
              ? "Clear request?"
              : "Cancel image?"}
        </h2>
        <p>
          Your character edits and saved artwork stay.
          {target?.status === "running"
            ? " A started generation may still use a credit."
            : ""}
        </p>
        {error && <AgentIssueNotice issue={error} requestId={target?.id} />}
        <div className={styles.footerActions}>
          <button type="button" disabled={busy} onClick={() => setTarget(null)}>
            Back
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void cancel()}
          >
            {target ? action(target) : "Cancel"}
          </button>
        </div>
      </dialog>
    </>
  );
}
