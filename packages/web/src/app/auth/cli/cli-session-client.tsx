"use client";

import { useEffect, useRef, useState } from "react";
import { parseCliSessionHandoff, type CliSessionRequest } from "@influence/engine/cli-session-contract";
import { AUTH_GENERATION_KEY, useAuth } from "@/hooks/use-auth";
import { apiFetch, ApiError, AUTH_TOKEN_KEY, getAuthToken, type AuthMe } from "@/lib/api";

type HandoffState = { scope: string; phase: "idle" | "checking" | "sending" | "done" | "error"; message?: string };
class CliHandoffError extends Error {}

export function CliSessionClient({ request }: { request: CliSessionRequest }) {
  const { ready, authenticated, account, openSignIn } = useAuth();
  const scope = JSON.stringify([request.apiOrigin, request.callbackUrl, request.state, authenticated, account?.id]);
  const [handoff, setHandoff] = useState<HandoffState>({ scope, phase: "idle" });
  const active = useRef<AbortController | null>(null);
  const openedSignIn = useRef(false);
  const phase = handoff.scope === scope ? handoff.phase : "idle";
  const busy = phase === "checking" || phase === "sending";

  useEffect(() => {
    const invalidate = () => {
      active.current?.abort(); active.current = null;
      setHandoff({ scope, phase: "idle" });
    };
    const onStorage = (event: StorageEvent) => {
      if ([AUTH_GENERATION_KEY, AUTH_TOKEN_KEY, "influence_auth_broadcast"].includes(event.key ?? "")) invalidate();
    };
    window.addEventListener("auth:session-ready", invalidate);
    window.addEventListener("auth:session-cleared", invalidate);
    window.addEventListener("auth:expired", invalidate);
    window.addEventListener("storage", onStorage);
    return () => {
      active.current?.abort(); active.current = null;
      window.removeEventListener("auth:session-ready", invalidate);
      window.removeEventListener("auth:session-cleared", invalidate);
      window.removeEventListener("auth:expired", invalidate);
      window.removeEventListener("storage", onStorage);
    };
  }, [scope]);

  useEffect(() => {
    if (!ready || authenticated || openedSignIn.current) return;
    openedSignIn.current = true;
    queueMicrotask(openSignIn);
  }, [ready, authenticated, openSignIn]);

  async function authorize() {
    if (!ready || !authenticated || !account || busy || phase === "done") return;
    const token = getAuthToken();
    if (!token) { openSignIn(); return; }
    const generation = localStorage.getItem(AUTH_GENERATION_KEY);
    const controller = new AbortController();
    active.current?.abort(); active.current = controller;
    const current = () => active.current === controller && getAuthToken() === token && localStorage.getItem(AUTH_GENERATION_KEY) === generation;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let callbackStarted = false;
    setHandoff({ scope, phase: "checking" });
    try {
      // Keep the app's configured browser transport; the waiting CLI verifies
      // this same session at the exact requested API before acknowledging it.
      const me = await apiFetch<AuthMe>("/api/auth/me", { signal: controller.signal, credentials: "omit", redirect: "error" });
      if (!current()) return;
      if (me.id !== account.id) throw new CliHandoffError("The API session belongs to a different account. Sign in again.");
      const body = parseCliSessionHandoff({ apiOrigin: request.apiOrigin, state: request.state, token });
      setHandoff({ scope, phase: "sending" });
      callbackStarted = true;
      const response = await fetch(request.callbackUrl, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok) throw new CliHandoffError("The waiting terminal rejected this request. Restart the CLI and use its new sign-in link.");
      const acknowledgement: unknown = await response.json();
      if (!current()) return;
      if (!acknowledgement || typeof acknowledgement !== "object" || !("ok" in acknowledgement) || acknowledgement.ok !== true) {
        throw new CliHandoffError("The terminal did not confirm sign-in. Check the terminal before retrying.");
      }
      setHandoff({ scope, phase: "done" });
    } catch (error) {
      if (!current()) return;
      const message = error instanceof ApiError && error.status === 401 ? "Your session expired. Sign in again, then authorize the CLI."
        : controller.signal.aborted ? "The sign-in request timed out. Check the terminal, then retry if it is still waiting."
        : error instanceof TypeError ? callbackStarted ? "Could not reach the waiting terminal. If it closed, restart the CLI and use its new sign-in link." : "Could not verify the API session. Check the connection and retry."
        : error instanceof ApiError ? "The API could not verify this session. Sign in again or retry."
        : error instanceof CliHandoffError ? error.message : "Could not complete CLI sign-in. Check the terminal and retry.";
      setHandoff({ scope, phase: "error", message });
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        if (!current()) setHandoff({ scope, phase: "idle" });
        active.current = null;
      }
    }
  }

  return <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
    <section className="influence-panel space-y-6 rounded-xl p-8" aria-labelledby="cli-session-title">
      <div className="space-y-3">
        <p className="influence-table-header text-xs font-semibold uppercase tracking-wider">The House · local CLI</p>
        <h1 id="cli-session-title" className="influence-phase-title text-3xl font-bold">Authorize local CLI</h1>
        <p className="influence-copy">Give the waiting terminal your current House session for this API:</p>
        <p className="influence-copy break-all font-mono text-sm">{request.apiOrigin}</p>
        <p className="influence-copy-muted text-sm">Only continue if you started this command. The CLI keeps the permissions of your account.</p>
      </div>
      {!ready ? <p role="status" className="influence-copy">Preparing sign-in…</p>
        : !authenticated ? <button type="button" className="influence-button-primary min-h-11 rounded-lg px-4 py-2 text-sm" onClick={openSignIn}>Open sign in</button>
        : phase === "done" ? <p role="status" className="influence-copy">CLI authorized. Return to your terminal. You can close this tab.</p>
        : <>
          <p className="influence-copy">Signed in as {account?.displayName}.</p>
          <button type="button" disabled={busy} className="influence-button-primary min-h-11 rounded-lg px-4 py-2 text-sm" onClick={() => void authorize()}>
            {phase === "checking" ? "Checking API session…" : phase === "sending" ? "Authorizing terminal…" : phase === "error" ? "Retry authorization" : "Authorize local CLI"}
          </button>
        </>}
      {handoff.scope === scope && handoff.message && <p role="alert" className="influence-copy">{handoff.message}</p>}
    </section>
  </main>;
}
