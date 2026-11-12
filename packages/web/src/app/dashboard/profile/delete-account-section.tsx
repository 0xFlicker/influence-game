"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ApiError, deleteMyAccount } from "@/lib/api";
import { clearDeletedAccountAnalytics } from "@/lib/product-analytics";

export function DeleteAccountSection() {
  const { logout } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const submitting = useRef(false);

  async function removeAccount() {
    if (submitting.current || confirmation !== "DELETE") return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
    } catch (error) {
      setReauthenticate(error instanceof ApiError && error.code === "REAUTH_REQUIRED");
      setError(error instanceof Error ? error.message : "Could not delete your account. Try again.");
      submitting.current = false;
      setBusy(false);
      return;
    }
    // The server has committed deletion. Browser cleanup failure must never
    // present it as a failed deletion or invite a second destructive request.
    try { clearDeletedAccountAnalytics(); } catch { console.warn("Could not reset local analytics identity"); }
    try { await logout(); } finally { window.location.assign("/account-deleted"); }
  }

  return <section className="influence-panel rounded-xl p-6">
    <h2 className="influence-section-title mb-3">Delete account</h2>
    <p className="influence-copy text-sm">Permanently close your account and remove your account and agent profiles from public view.</p>
    {!expanded ? <button type="button" className="influence-button-secondary mt-4 min-h-11 rounded-lg px-4 py-2 text-sm" onClick={() => setExpanded(true)}>Delete my account</button> : <div className="mt-4 space-y-4">
      <p className="influence-copy text-sm">Your agents’ names, portraits, results, and spoken lines remain in game history, without your owner attribution. Games and competitions you have already entered may still start and finish. This does not delete games.</p>
      <p className="influence-copy text-sm">You will be signed out everywhere. Cleanup with connected services continues in the background. This cannot be undone; signing up again will not restore your agents or account.</p>
      <label className="block text-sm">
        <span className="influence-copy-strong">Type DELETE to confirm</span>
        <input className="influence-field mt-2 min-h-11 w-full rounded-lg px-4 py-2" value={confirmation} onInput={event => setConfirmation(event.currentTarget.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {reauthenticate ? <button type="button" className="influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm" onClick={() => { void logout(); }}>Sign out to sign in again</button> : <button type="button" className="min-h-11 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm text-red-200 disabled:opacity-50" disabled={busy || confirmation !== "DELETE"} onClick={() => { void removeAccount(); }}>{busy ? "Deleting account…" : "Permanently delete account"}</button>}
        <button type="button" className="influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm" disabled={busy} onClick={() => { setExpanded(false); setConfirmation(""); setError(null); }}>Cancel</button>
      </div>
    </div>}
  </section>;
}
