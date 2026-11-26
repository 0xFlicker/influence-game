"use client";

import { useState } from "react";
import { useInvite } from "@/app/providers";
import { useMiniApp } from "@/components/farcaster-miniapp-provider";
import { useSignupPromptOutlet } from "@/components/signup-admission";
import { SignupAvailabilityGate } from "@/components/signup-availability";

export function InviteCodeModal() {
  const {
    needsInvite,
    dismissInvite,
    submitInvite,
    inviteError,
    submitting,
    logout,
  } = useInvite();
  const { suppressWebsiteAuthChrome } = useMiniApp();
  const { showing: showingSignupStep, outletRef: signupOutletRef } = useSignupPromptOutlet("invite");
  const [code, setCode] = useState("");

  if (!needsInvite) return null;

  return (
    <div className="house-auth-backdrop fixed inset-0 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Signup invite"
        className="house-auth-panel max-h-full w-full max-w-lg overflow-y-auto rounded-3xl p-6 sm:p-8">
        <div hidden={showingSignupStep}>
          <h2 className="text-xl font-bold text-text-primary mb-2">Invite Code Required</h2>
          <SignupAvailabilityGate>
            <p className="influence-copy text-sm mb-6">
              Enter an invite code to create your account. Ask a friend who already plays for one.
            </p>
            <form onSubmit={event => {
              event.preventDefault();
              if (code.trim()) void submitInvite(code.trim());
            }}>
              <input
                aria-label="Invite code"
                type="text"
                value={code}
                onChange={event => setCode(event.target.value.toUpperCase())}
                placeholder="e.g. ABC12345"
                maxLength={12}
                autoFocus
                className="influence-field w-full rounded-lg px-4 py-3 text-center text-lg font-mono tracking-widest placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
              />
              {inviteError && <p role="alert" className="text-red-400 text-sm mt-3">{inviteError}</p>}
              <button
                type="submit"
                disabled={submitting || code.trim().length === 0}
                className="influence-button-primary w-full mt-4 py-3 rounded-lg font-medium"
              >
                {submitting ? "Verifying…" : "Submit"}
              </button>
            </form>
          </SignupAvailabilityGate>
          <div className={`mt-3 grid gap-3 ${suppressWebsiteAuthChrome ? "grid-cols-1" : "grid-cols-2"}`}>
            <button
              type="button"
              onClick={dismissInvite}
              className="influence-button-secondary rounded-lg py-3 text-sm font-medium"
            >
              Close
            </button>
            {!suppressWebsiteAuthChrome && (
              <button
                type="button"
                onClick={() => void logout()}
                disabled={submitting}
                className="influence-button-secondary rounded-lg py-3 text-sm font-medium"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
        <div ref={signupOutletRef} />
      </div>
    </div>
  );
}
