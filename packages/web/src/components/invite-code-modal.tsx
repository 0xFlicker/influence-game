"use client";

import { useState } from "react";
import { useInvite } from "@/app/providers";

export function InviteCodeModal() {
  const { needsInvite, submitInvite, cancelInvite, inviteError, submitting } = useInvite();
  const [code, setCode] = useState("");

  if (!needsInvite) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-8 max-w-md w-full">
        <h2 className="text-xl font-bold text-white mb-2">Invite Code Required</h2>
        <p className="text-white/50 text-sm mb-6">
          Enter an invite code to sign in. Ask a friend who already plays for one.
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
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white text-center text-lg font-mono tracking-widest focus:outline-none focus:border-indigo-500/50 placeholder:text-white/20 placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
          />

          {inviteError && (
            <p className="text-red-400 text-sm mt-3">{inviteError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || code.trim().length === 0}
            className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white py-3 rounded-lg font-medium transition-colors"
          >
            {submitting ? "Verifying..." : "Continue"}
          </button>

          <button
            type="button"
            onClick={cancelInvite}
            className="w-full mt-2 text-white/40 hover:text-white/60 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
