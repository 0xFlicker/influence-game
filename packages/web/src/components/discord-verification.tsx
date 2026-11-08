"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { HOUSE_DISCORD_URL } from "@/lib/product-identity";
import { DISCORD_ATTEMPT_KEY, DISCORD_CALLBACK_KEY, newDiscordBrowserNonce, readDiscordCallback, type DiscordBrowserAttempt } from "@/lib/discord-verification";

interface Connection {
  username: string; disconnecting: boolean; roles: string[];
  syncStatus: "synced" | "pending" | "retrying"; lastError: string | null; syncedAt: string | null;
}
interface Status { connection: Connection | null }
interface Review { username: string; attempt: DiscordBrowserAttempt }
const getStatus = () => apiFetch<Status>("/api/discord/connection", { cache: "no-store" });
function post<T>(path: string, value: object) { return apiFetch<T>(`/api/discord/${path}`, { method: "POST", body: JSON.stringify(value) }); }

export function DiscordVerification() {
  const { ready, authenticated, account, openSignIn, openCreateAccount } = useAuth();
  return <main className="mx-auto w-full max-w-xl px-5 py-12">
    <section className="influence-panel space-y-5 rounded-xl p-6">
      <h1 className="influence-section-title text-2xl">Connect Discord</h1>
      <p className="influence-copy">Connect your Discord identity to your House account to receive your community and staff roles.</p>
      {!ready ? <p role="status">Loading your account…</p> : !authenticated || !account ? <>
        <p className="influence-copy">Sign in to the House account you want to connect.</p>
        <div className="flex flex-wrap gap-3">
          <button className="influence-button-primary rounded-lg px-4 py-3" onClick={openSignIn}>Sign in</button>
          <button className="influence-button-secondary rounded-lg px-4 py-3" onClick={openCreateAccount}>Create account</button>
        </div>
      </> : <DiscordSession key={account.publicId} accountId={account.publicId} accountName={account.handle ? `@${account.handle}` : account.displayName ?? "your House account"} />}
      <Link href="/dashboard?tab=profile" className="influence-link inline-block py-2">Back to your account</Link>
    </section>
  </main>;
}

function DiscordSession({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const initialization = useRef<Promise<{ status: Status; review: Review | null }> | null>(null);
  useEffect(() => {
    let active = true;
    initialization.current ??= (async () => {
      const current = await getStatus();
      if (current.connection) return { status: current, review: null };
      const saved = readDiscordCallback(sessionStorage, accountId);
      if (!saved) return { status: current, review: null };
      const identity = await post<{ username: string }>("exchange", { ...saved.callback, nonce: saved.attempt.nonce });
      return { status: current, review: { username: identity.username, attempt: saved.attempt } };
    })();
    void initialization.current.then(value => { if (active) { setStatus(value.status); setReview(value.review); } })
      .catch((cause: unknown) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [accountId]);

  const pending = status?.connection && status.connection.syncStatus !== "synced";
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await apiFetch<Status>("/api/discord/connection", { signal: controller.signal, cache: "no-store" });
        if (!controller.signal.aborted) { setStatus(value); timer = setTimeout(poll, 5000); }
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    };
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function clearAttempt() { sessionStorage.removeItem(DISCORD_ATTEMPT_KEY); sessionStorage.removeItem(DISCORD_CALLBACK_KEY); }
  function start() { void run(async () => {
    clearAttempt(); setReview(null);
    const nonce = newDiscordBrowserNonce();
    const result = await post<{ state: string; authorizationUrl: string }>("start", { nonce });
    sessionStorage.setItem(DISCORD_ATTEMPT_KEY, JSON.stringify({ state: result.state, nonce, accountId }));
    location.assign(result.authorizationUrl);
  }); }
  function confirm() { if (review) void run(async () => {
    const result = await post<Status>("confirm", { state: review.attempt.state, nonce: review.attempt.nonce });
    clearAttempt(); setReview(null); setStatus(result);
  }); }
  const connection = status?.connection;
  return <div className="space-y-4">
    <p className="influence-copy">House account: <strong>{accountName}</strong></p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {review ? <>
      <p className="influence-copy">Connect Discord <strong>@{review.username}</strong> to <strong>{accountName}</strong>?</p>
      <p className="influence-copy-muted text-sm">Your Discord connection stays private. This gives The House your Discord identity, without access to your messages.</p>
      <button disabled={busy} className="influence-button-primary rounded-lg px-4 py-3" onClick={confirm}>Confirm connection</button>
      <button disabled={busy} className="influence-link block py-2" onClick={start}>Use a different Discord account</button>
    </> : connection ? <>
      <p className="influence-copy">Connected to <strong>@{connection.username}</strong>.</p>
      <p role="status" className="influence-copy">{connection.disconnecting ? "Disconnecting: removing your managed server roles." : connection.syncStatus === "synced" ? "Your last requested role update is complete. Refresh roles to apply any House role changes." : "Your account is connected. Server roles are waiting to be applied."}</p>
      {!connection.disconnecting && <p className="influence-copy-muted">Current House roles: {connection.roles.join(", ")}</p>}
      {connection.syncedAt && <p className="influence-copy-muted text-sm">Last role refresh: {new Date(connection.syncedAt).toLocaleString()}</p>}
      {connection.lastError && <p role="status" className="influence-copy">{connection.lastError === "member_missing" ? "Join The House Discord, then refresh your roles." : connection.lastError === "member_pending" ? "Complete the server's membership screening in Discord, then refresh your roles." : "Server roles could not be updated yet. We will retry; contact support if this continues."}</p>}
      <a className="influence-link block py-2" href={HOUSE_DISCORD_URL} rel="noreferrer">Open The House Discord</a>
      {!connection.disconnecting && <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="influence-button-secondary rounded-lg px-4 py-3" onClick={() => void run(async () => setStatus(await post<Status>("refresh", {})))}>Refresh roles</button>
        <button disabled={busy} className="influence-link px-3 py-2" onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
      </div>}
      {confirmDisconnect && !connection.disconnecting && <div className="space-y-3">
        <p>Disconnect @{connection.username}? House bot access ends immediately. Server roles will be removed before you can connect another account.</p>
        <button disabled={busy} className="influence-button-secondary rounded-lg px-4 py-3" onClick={() => void run(async () => { setStatus(await post<Status>("disconnect", {})); setConfirmDisconnect(false); })}>Confirm disconnect</button>
        <button disabled={busy} className="influence-link px-3 py-2" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
      </div>}
    </> : !status && !error ? <p role="status">Checking your Discord connection…</p> : <button disabled={busy} className="influence-button-primary rounded-lg px-4 py-3" onClick={start}>Connect Discord</button>}
    {busy && <p role="status">Working…</p>}
  </div>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Could not complete verification. Please try again."; }
