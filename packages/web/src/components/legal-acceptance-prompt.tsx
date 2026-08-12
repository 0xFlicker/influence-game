"use client";

import { useState } from "react";
import { AccountLegalConsent } from "@/components/account-legal-consent";
import { acceptCurrentLegalTerms } from "@/lib/api";
import { FALSE_FLOOR } from "@/lib/product-identity";

export function LegalAcceptancePrompt({
  onAccepted,
  onLogout,
}: {
  onAccepted: () => void;
  onLogout: () => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueToInfluence() {
    if (!accepted || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptCurrentLegalTerms();
      onAccepted();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not record your acceptance. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="influence-page flex min-h-screen items-center justify-center px-6 py-16">
      <section
        aria-labelledby="legal-acceptance-title"
        className="influence-panel w-full max-w-lg space-y-6 rounded-xl p-8"
      >
        <div className="space-y-3">
          <p className="influence-table-header text-xs font-semibold uppercase tracking-wider">
            Terms of Use
          </p>
          <h1
            id="legal-acceptance-title"
            className="influence-phase-title text-3xl font-bold"
          >
            Review and accept
          </h1>
          <p className="influence-copy">
            The House is provided by {FALSE_FLOOR.name}. Please review and
            accept the Terms of Use to continue.
          </p>
        </div>

        <AccountLegalConsent
          checked={accepted}
          disabled={busy}
          onChange={setAccepted}
        />

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={!accepted || busy}
            onClick={() => void continueToInfluence()}
            className="influence-button-primary min-h-11 rounded-lg px-4 py-2 text-sm"
          >
            {busy ? "Saving…" : "Accept and continue"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onLogout()}
            className="influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
