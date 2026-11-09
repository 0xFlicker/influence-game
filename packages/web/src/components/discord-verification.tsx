"use client";

import Link from "next/link";
import Image from "next/image";
import styles from "./discord-verification.module.css";
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

function ConnectionMark({ connected = false }: { connected?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {connected ? <path d="m5 12 4 4L19 6" /> : <path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1) scale(.9)" />}
  </svg>;
}

function AccountPair({ accountName, discordName, connected = false, disconnecting = false }: { accountName?: string; discordName?: string; connected?: boolean; disconnecting?: boolean }) {
  return <div className={styles.accounts}>
    <div className={styles.account}>
      <Image src="/logo.png" width={48} height={48} alt="" className={styles.houseIcon} />
      <span className={styles.accountLabel}>The House</span>
      <strong>{accountName ?? "Your account"}</strong>
      <span className={styles.accountDetail}>{accountName ? "Signed in" : "Your player identity"}</span>
    </div>
    <span className={`${styles.bridge} ${connected ? styles.connected : ""}`}><ConnectionMark connected={connected} /></span>
    <div className={styles.account}>
      <span className={styles.discordIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.6 1.2a18.3 18.3 0 0 0-5.6 0l-.6-1.2a19.8 19.8 0 0 0-4.9 1.5C.6 9 .1 13.5.4 17.9a20 20 0 0 0 6 3l1.2-2a13.4 13.4 0 0 1-1.9-.9l.5-.4a14.2 14.2 0 0 0 11.6 0l.5.4-1.9.9 1.2 2a20 20 0 0 0 6-3c.4-5.1-.8-9.5-3.3-13.5ZM8.2 15.2c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z" /></svg></span>
      <span className={styles.accountLabel}>Discord</span>
      <strong>{discordName ? `@${discordName}` : "Your community"}</strong>
      <span className={styles.accountDetail}>{disconnecting ? "Removing access" : connected ? "Connected" : discordName ? "Ready to connect" : "Choose your account"}</span>
    </div>
  </div>;
}

function Introduction({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <div className={styles.introduction}><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p className={styles.description}>{children}</p></div>;
}

export function DiscordVerification() {
  const { ready, authenticated, account, openSignIn, openCreateAccount } = useAuth();
  return <div className={styles.shell}>
    <header className={styles.header}>
      <Link href="/" className={styles.wordmark}><Image src="/logo.png" width={32} height={32} alt="" />The House</Link>
      <span>Community access</span>
    </header>
    <main className={styles.main}>
      <section className={styles.panel} aria-label="Connect your accounts">
        {!ready ? <><Introduction eyebrow="The House × Discord" title="A place for your people.">One connection. Your House identity, inside the community.</Introduction><p className={styles.loading} role="status">Loading your account…</p></> : !authenticated || !account ? <>
          <Introduction eyebrow="The House × Discord" title="A place for your people.">Bring your House identity into Discord. Connect once to receive your community and staff roles.</Introduction>
          <AccountPair />
          <div className={styles.actions}>
            <button className={styles.primary} onClick={openSignIn}>Sign in to The House <span aria-hidden="true">↗</span></button>
            <p className={styles.secondaryPrompt}>New to The House? <button className={styles.textButton} onClick={openCreateAccount}>Create account</button></p>
          </div>
        </> : <DiscordSession key={account.publicId} accountId={account.publicId} accountName={account.handle ? `@${account.handle}` : account.displayName ?? "your House account"} />}
        <p className={styles.privacy}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>Private connection. No access to your messages.</p>
      </section>
      <Link href="/dashboard?tab=profile" className={styles.back}><span aria-hidden="true">←</span> Back to your account</Link>
    </main>
  </div>;
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
  const completed = Boolean(connection && !connection.disconnecting && connection.syncStatus === "synced");
  const title = review ? "Make it official." : connection?.disconnecting ? "Closing the connection." : connection ? completed ? "You’re in." : "One last thing…" : "Your people are waiting.";
  const description = review ? "Two accounts. One identity in the community. Confirm these are the accounts you want to connect."
    : connection?.disconnecting ? "Your House account stays with you. We’re removing the server roles attached to this connection."
    : connection ? completed ? "Your accounts are connected. Welcome to The House community." : "Your accounts are connected. We’re getting your Discord roles ready."
    : "Connect Discord to your House account to receive your community and staff roles.";
  return <div>
    <Introduction eyebrow={completed ? "Connection complete" : "The House × Discord"} title={title}>{description}</Introduction>
    <AccountPair accountName={accountName} discordName={review?.username ?? connection?.username} connected={Boolean(connection && !connection.disconnecting)} disconnecting={connection?.disconnecting} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {review ? <div className={styles.actions}>
      <button disabled={busy} className={styles.primary} onClick={confirm}>Confirm connection <span aria-hidden="true">↗</span></button>
      <button disabled={busy} className={styles.textButton} onClick={start}>Use a different Discord account</button>
    </div> : connection ? <>
      <div className={styles.delivery}>
        <p role="status" className={styles.deliveryStatus}><span className={`${styles.statusDot} ${completed ? styles.statusComplete : ""}`} />{connection.disconnecting ? "Disconnecting: removing your managed server roles." : completed ? "Your last requested role update is complete." : "Your account is connected. Server roles are waiting to be applied."}</p>
        {!connection.disconnecting && <div className={styles.roles} aria-label="Current House roles">{connection.roles.map(role => <span key={role} className={`${styles.role} ${role === "sysop" ? styles.sysop : ""}`}>{role === "sysop" && <span aria-hidden="true">✦ </span>}House {role.charAt(0).toUpperCase() + role.slice(1)}</span>)}</div>}
        {!connection.disconnecting && <p className={styles.deliveryHint}>{completed ? "These are your current House roles. Refresh to apply any changes." : "Usually ready within a minute. You can leave this page open."}</p>}
        {connection.syncedAt && <p className={styles.timestamp}>Last role refresh: {new Date(connection.syncedAt).toLocaleString()}</p>}
        {connection.lastError && <p role="status" className={styles.notice}>{connection.lastError === "member_missing" ? "Join The House Discord, then refresh your roles." : connection.lastError === "member_pending" ? "Complete the server's membership screening in Discord, then refresh your roles." : "Server roles could not be updated yet. We will retry; contact support if this continues."}</p>}
      </div>
      {!connection.disconnecting && <div className={styles.actions}>
        <a className={styles.primary} href={HOUSE_DISCORD_URL} rel="noreferrer">Open The House Discord <span aria-hidden="true">↗</span></a>
        <div className={styles.management}>
          <button disabled={busy} className={styles.textButton} onClick={() => void run(async () => setStatus(await post<Status>("refresh", {})))}>Refresh roles</button>
          <span aria-hidden="true">·</span>
          <button disabled={busy} className={styles.textButton} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
        </div>
      </div>}
      {confirmDisconnect && !connection.disconnecting && <section className={styles.disconnect} aria-label="Confirm disconnection">
        <h2>Disconnect @{connection.username}?</h2>
        <p>House bot access ends immediately. Server roles will be removed before you can connect another account.</p>
        <div className={styles.management}>
          <button disabled={busy} className={styles.danger} onClick={() => void run(async () => { setStatus(await post<Status>("disconnect", {})); setConfirmDisconnect(false); })}>Confirm disconnect</button>
          <button disabled={busy} className={styles.textButton} onClick={() => setConfirmDisconnect(false)}>Cancel</button>
        </div>
      </section>}
    </> : !status && !error ? <p role="status" className={styles.loading}>Checking your Discord connection…</p> : <div className={styles.actions}><button disabled={busy} className={styles.primary} onClick={start}>Connect Discord <span aria-hidden="true">↗</span></button><p className={styles.deliveryHint}>You’ll review both accounts before connecting.</p></div>}
    {busy && <p role="status" className={styles.loading}>Working…</p>}
  </div>;
}

function message(error: unknown) { return error instanceof Error ? error.message : "Could not complete verification. Please try again."; }
