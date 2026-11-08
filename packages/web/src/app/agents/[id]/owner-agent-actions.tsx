"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAuthToken, listAgents, type SavedAgent } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { agentEditRequestKey, findAgentDrafts, writeEditorStorage } from "@/app/dashboard/agents/agent-editor-storage";

type OwnerState = { kind: "loading" | "visitor" } | { kind: "error"; ownerId: string; knownOwner: boolean } | { kind: "owner"; ownerId: string; agent: SavedAgent; scopes: string[] };

function draftHref(agentId: string, scope: string): string {
  const base = `/dashboard/agents/${encodeURIComponent(agentId)}/edit`;
  const reviewPrefix = `review:${agentId}:`;
  return scope.startsWith(reviewPrefix) ? `${base}?sourceReviewId=${encodeURIComponent(scope.slice(reviewPrefix.length))}` : base;
}

export function OwnerAgentActions({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { ready, authenticated, account } = useAuth();
  const router = useRouter();
  const accountId = account?.id;
  const [state, setState] = useState<OwnerState>({ kind: "loading" });
  const [request, setRequest] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(() => {
    const epoch = ++generation.current;
    if (!ready) return;
    if (!authenticated || !accountId) { setState({ kind: "visitor" }); return; }
    if (!getAuthToken()) { setState({ kind: "error", ownerId: accountId, knownOwner: false }); return; }
    let active = true;
    setState({ kind: "loading" });
    void listAgents().then(agents => {
      if (!active || epoch !== generation.current) return;
      const agent = agents.find(entry => entry.id === agentId);
      if (!agent) { setState({ kind: "visitor" }); return; }
      const drafts = findAgentDrafts(accountId, agentId);
      if (!drafts.ok) { setState({ kind: "error", ownerId: accountId, knownOwner: true }); return; }
      setState({ kind: "owner", ownerId: accountId, agent, scopes: drafts.scopes });
    }).catch(() => { if (active && epoch === generation.current) setState({ kind: "error", ownerId: accountId, knownOwner: false }); });
    return () => { active = false; };
  }, [accountId, agentId, authenticated, ready]);
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const initial = window.setTimeout(() => { cancel = load(); }, 0);
    const onSession = () => { cancel?.(); cancel = load(); };
    window.addEventListener("auth:session-ready", onSession);
    window.addEventListener("pageshow", onSession);
    return () => { invalidate(); window.clearTimeout(initial); cancel?.(); window.removeEventListener("auth:session-ready", onSession); window.removeEventListener("pageshow", onSession); };
  }, [invalidate, load]);

  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "owner" || state.ownerId !== accountId || !accountId || !request.trim()) return;
    const drafts = findAgentDrafts(accountId, agentId);
    if (!drafts.ok) { setState({ kind: "error", ownerId: accountId, knownOwner: true }); return; }
    if (drafts.scopes.length) { setState({ ...state, scopes: drafts.scopes }); return; }
    if (!writeEditorStorage(agentEditRequestKey(accountId, agentId), request.trim())) {
      setMessage("Your request could not be carried to the editor. Check browser storage or open the editor directly.");
      return;
    }
    router.push(`${draftHref(agentId, `edit:${agentId}`)}?profileRequest=1`);
  }
  if (!authenticated || !accountId || state.kind === "visitor" || state.kind === "loading") return null;
  if (state.kind === "error") return state.ownerId === accountId ? <section className="influence-panel rounded-xl p-5" role="status"><p>We couldn’t check your editing state in this tab.</p>{state.knownOwner && <Link className="influence-link mt-2 inline-block" href={`/dashboard/agents/${encodeURIComponent(agentId)}/edit`}>Edit</Link>}<button type="button" onClick={() => load()} className="influence-link ml-4">Retry</button></section> : null;
  if (state.kind !== "owner") return null;
  if (state.ownerId !== accountId) return null;
  if (state.scopes.length) return <section className="influence-panel rounded-xl p-5">
    <h2 className="text-lg font-semibold">Finish your draft</h2>
    <p className="influence-copy mt-1 text-sm">Continue the saved draft before starting another edit.</p>
    <div className="mt-3 space-y-3">{state.scopes.map(scope => <div key={scope} className="flex flex-wrap items-center gap-4">
      <Link className="influence-link" href={draftHref(agentId, scope)}>Continue</Link>

    </div>)}</div>
    {message && <p role="alert" className="mt-2 text-sm text-red-300">{message}</p>}
  </section>;
  return <section className="influence-panel rounded-xl p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">✦ What would you like to change?</h2><p className="influence-copy mt-1 text-sm">Describe an update to {agentName}.</p></div>
      <Link className="influence-link text-sm" href={draftHref(agentId, `edit:${agentId}`)}>Edit</Link>
    </div>
    <form onSubmit={start} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <label className="sr-only" htmlFor="profile-agent-request">Describe an update to {agentName}</label>
      <input id="profile-agent-request" className="influence-field min-h-11 min-w-0 flex-1 rounded-lg px-4" value={request} onInput={event => { setRequest(event.currentTarget.value); setMessage(null); }} maxLength={2000} placeholder="Tell the assistant what to change…" />
      <button className="influence-button-primary min-h-11 rounded-lg px-5" type="submit" disabled={!request.trim()}>Continue</button>
    </form>
    <p className="influence-copy-muted mt-2 text-xs">Review changes in the editor before saving.</p>
    {message && <p role="alert" className="mt-2 text-sm text-red-300">{message}</p>}
  </section>;
}
