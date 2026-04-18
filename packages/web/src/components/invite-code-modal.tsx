"use client";

import { useState } from "react";
import { useInvite } from "@/app/providers";

export function InviteCodeModal() {
  const { needsInvite, submitInvite, inviteError, submitting } = useInvite();
  const [code, setCode] = useState("");

  if (!needsInvite) return null;

  return (
    <div className="fixed inset-0 influence-overlay flex items-center justify-center z-50 p-4">
      <div className="influence-modal rounded-xl p-8 max-w-md w-full">
        <h2 className="text-xl font-bold text-text-primary mb-2">Invite Code Required</h2>
        <p className="influence-copy text-sm mb-6">
          Enter an invite code to create your account. Ask a friend who already plays for one.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) submitInvite(code.trim());
          }}
        >
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABC12345"
            maxLength={12}
            autoFocus
            className="influence-field w-full rounded-lg px-4 py-3 text-center text-lg font-mono tracking-widest placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
          />

          {inviteError && (
            <p className="text-red-400 text-sm mt-3">{inviteError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || code.trim().length === 0}
            className="influence-button-primary w-full mt-4 py-3 rounded-lg font-medium"
          >
            {submitting ? "Verifying..." : "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}
