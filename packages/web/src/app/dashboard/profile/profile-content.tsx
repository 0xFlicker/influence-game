"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  getAuthToken,
  getProfile,
  updateProfile,
  suggestProfileHandle,
  getMyInviteCodes,
  ApiError,
  type PlayerProfile,
  type InviteCodesResponse,
} from "@/lib/api";
import { derivePublicHandle } from "@/components/public-identity-onboarding-model";
import { playerProfileHref } from "@/lib/player-profile-links";

export function ProfileIdentitySummary({
  profile,
  onEdit,
}: {
  profile: Pick<
    PlayerProfile,
    "publicId" | "handle" | "displayName" | "publicIdentityOnboarding"
  >;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-text-primary text-lg font-semibold">{profile.displayName}</p>
        {profile.handle && <p className="influence-copy-muted text-sm">@{profile.handle}</p>}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="influence-button-secondary min-h-11 text-xs px-4 py-2 rounded-lg"
      >
        {profile.publicIdentityOnboarding.state === "complete"
          ? "Edit public identity"
          : "Complete your public profile"}
      </button>
      {profile.publicIdentityOnboarding.state === "complete" && (
        <Link
          href={playerProfileHref(profile)}
          className="influence-link min-h-11 px-3 py-2 text-sm"
        >
          View public profile
        </Link>
      )}
    </div>
  );
}

export function InviteCodesSection({
  inviteCodes,
  copiedCode,
  onCopy,
}: {
  inviteCodes: InviteCodesResponse | null;
  copiedCode: string | null;
  onCopy: (code: string) => void;
}) {
  if (!inviteCodes || inviteCodes.available.length === 0) return null;

  return (
    <section className="influence-panel rounded-xl p-6">
      <h2 className="influence-section-title mb-4">Invite Codes</h2>
      <p className="influence-copy text-sm mb-4">
        Share these codes with friends so they can sign up.
        You have <span className="text-text-primary font-medium">{inviteCodes.totalAvailable}</span> available
        {inviteCodes.totalUsed > 0 && <>, <span className="influence-copy-muted">{inviteCodes.totalUsed} used</span></>}.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {inviteCodes.available.map((inviteCode) => (
          <button
            type="button"
            key={inviteCode.code}
            onClick={() => onCopy(inviteCode.code)}
            className="influence-button-secondary font-mono text-sm rounded-lg px-3 py-2 text-center"
            title="Click to copy"
          >
            {copiedCode === inviteCode.code ? "Copied!" : inviteCode.code}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ProfileContent() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [handleDirty, setHandleDirty] = useState(false);
  const nameInputRef = useRef("");
  const handleDirtyRef = useRef(false);
  const savingRef = useRef(false);
  const suggestionEpochRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [handleSuggestion, setHandleSuggestion] = useState<string | null>(null);

  // Invite codes
  const [inviteCodes, setInviteCodes] = useState<InviteCodesResponse | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    function fetchProfile() {
      if (!getAuthToken()) return;
      setLoading(true);
      getProfile()
        .then((p) => {
          setProfile(p);
          setNameInput(p.displayName === "Anonymous" ? "" : p.displayName);
          nameInputRef.current = p.displayName === "Anonymous" ? "" : p.displayName;
          setHandleInput(p.handle ?? (p.displayName === "Anonymous" ? "" : derivePublicHandle(p.displayName)));
          setHandleDirty(p.handle !== null);
          handleDirtyRef.current = p.handle !== null;
        })
        .catch((err) => {
          console.warn("[ProfileContent] Failed to load profile:", err);
          setError("Failed to load profile.");
        })
        .finally(() => setLoading(false));

      getMyInviteCodes()
        .then(setInviteCodes)
        .catch(() => {});
    }

    fetchProfile();
    window.addEventListener("auth:session-ready", fetchProfile);
    return () => window.removeEventListener("auth:session-ready", fetchProfile);
  }, []);

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    suggestionEpochRef.current += 1;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateProfile(nameInput, handleInput);
      setProfile(updated);
      setNameInput(updated.displayName);
      nameInputRef.current = updated.displayName;
      setHandleInput(updated.handle ?? "");
      setHandleDirty(updated.handle !== null);
      handleDirtyRef.current = updated.handle !== null;
      setEditing(false);
      window.dispatchEvent(new CustomEvent("auth:identity-updated", { detail: updated }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "HANDLE_TAKEN") {
        const suggestion = typeof err.payload?.suggestion === "string"
          ? err.payload.suggestion
          : null;
        if (!handleDirty && suggestion) {
          setHandleInput(suggestion);
        } else {
          setHandleSuggestion(suggestion);
        }
      }
      setSaveError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
        Loading...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="rounded-xl p-8 text-center border border-red-400/30 bg-red-400/10">
        <p className="text-red-400 text-sm">{error ?? "Profile not found"}</p>
      </div>
    );
  }

  const winRate =
    profile.gamesPlayed > 0
      ? Math.round((profile.gamesWon / profile.gamesPlayed) * 100)
      : 0;
  const handleChanged = profile.handle !== null
    && handleInput.trim().toLowerCase() !== profile.handle.toLowerCase();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="influence-phase-title text-3xl font-bold mb-1">Profile</h1>
        <p className="influence-copy text-sm">
          Your account settings and ELO rating.
        </p>
      </div>

      {/* Public identity */}
      <section className="influence-panel rounded-xl p-6">
        <h2 className="influence-section-title mb-4">
          Public identity
        </h2>
        {editing ? (
          <div className="space-y-3">
            <label className="block">
              <span className="influence-copy-muted text-xs">Display name</span>
              <input
                type="text"
                disabled={saving}
                value={nameInput}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setNameInput(nextName);
                  nameInputRef.current = nextName;
                  if (!handleDirtyRef.current) setHandleInput(derivePublicHandle(nextName));
                  setSaveError(null);
                  setHandleSuggestion(null);
                }}
                onBlur={() => {
                  if (handleDirtyRef.current || nameInput.trim().length === 0) return;
                  const requestedDisplayName = nameInput;
                  const suggestionEpoch = ++suggestionEpochRef.current;
                  void suggestProfileHandle(requestedDisplayName)
                    .then((suggestion) => {
                      if (
                        suggestionEpoch === suggestionEpochRef.current
                        && !handleDirtyRef.current
                        && nameInputRef.current === requestedDisplayName
                      ) {
                        setHandleInput(suggestion);
                      }
                    })
                    .catch(() => {});
                }}
                maxLength={50}
                className="influence-field mt-1 min-h-11 w-full rounded-lg px-4 py-2.5 text-sm"
                placeholder="Enter display name"
              />
            </label>
            <label className="block">
              <span className="influence-copy-muted text-xs">Handle</span>
              <div className="influence-field mt-1 flex min-h-11 items-center rounded-lg px-4">
                <span className="influence-copy-muted">@</span>
                <input
                  type="text"
                  disabled={saving}
                  value={handleInput}
                  onChange={(event) => {
                    setHandleInput(event.target.value);
                    setHandleDirty(true);
                    handleDirtyRef.current = true;
                    setSaveError(null);
                    setHandleSuggestion(null);
                  }}
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm text-text-primary outline-none"
                  placeholder="your-handle"
                />
              </div>
            </label>
            {handleChanged && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                Changing your handle breaks links that use @{profile.handle}. Your public UUID link stays stable.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || nameInput.trim().length === 0 || handleInput.trim().length === 0}
                className="influence-button-primary px-4 py-2 rounded-lg text-sm font-medium"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  suggestionEpochRef.current += 1;
                  setEditing(false);
                  const displayName = profile.displayName === "Anonymous"
                    ? ""
                    : profile.displayName;
                  setNameInput(displayName);
                  nameInputRef.current = displayName;
                  setHandleInput(
                    profile.handle
                      ?? (profile.displayName === "Anonymous"
                        ? ""
                        : derivePublicHandle(profile.displayName)),
                  );
                  setHandleDirty(profile.handle !== null);
                  handleDirtyRef.current = profile.handle !== null;
                  setSaveError(null);
                  setHandleSuggestion(null);
                }}
                disabled={saving}
                className="influence-copy hover:text-text-primary text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
            {saveError && (
              <p role="alert" className="text-red-400 text-xs">
                {saveError}
                {handleSuggestion && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="influence-link"
                      onClick={() => {
                        setHandleInput(handleSuggestion);
                        setHandleDirty(true);
                        handleDirtyRef.current = true;
                        setHandleSuggestion(null);
                      }}
                    >
                      Use @{handleSuggestion}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <ProfileIdentitySummary profile={profile} onEdit={() => setEditing(true)} />
        )}
      </section>

      {/* Account rating stats */}
      <section className="influence-panel rounded-xl p-6">
        <h2 className="influence-section-title mb-4">
          Account Free-Track Rating
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <p className="text-3xl font-bold text-text-primary font-mono">
              {profile.rating}
            </p>
            <p className="influence-copy-muted text-xs mt-1">Current Account ELO</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-text-primary/65 font-mono">
              {profile.peakRating}
            </p>
            <p className="influence-copy-muted text-xs mt-1">Peak Account ELO</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-text-primary font-mono">
              {profile.gamesPlayed}
            </p>
            <p className="influence-copy-muted text-xs mt-1">Games Played</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-yellow-400 font-mono">
              {profile.gamesPlayed > 0 ? `${winRate}%` : "-"}
            </p>
            <p className="influence-copy-muted text-xs mt-1">
              Win Rate ({profile.gamesWon}W)
            </p>
          </div>
        </div>
      </section>

      {/* Account Info */}
      <section className="influence-panel rounded-xl p-6">
        <h2 className="influence-section-title mb-4">
          Account
        </h2>
        <div className="space-y-3 text-sm">
          {profile.walletAddress && (
            <div className="flex items-center justify-between">
              <span className="influence-copy-muted">Wallet</span>
              <span className="influence-copy-strong font-mono text-xs">
                {profile.walletAddress.slice(0, 6)}...
                {profile.walletAddress.slice(-4)}
              </span>
            </div>
          )}
          {profile.email && (
            <div className="flex items-center justify-between">
              <span className="influence-copy-muted">Email</span>
              <span className="influence-copy-strong">{profile.email}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="influence-copy-muted">Member since</span>
            <span className="influence-copy-strong">
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </section>

      {/* Invite Codes */}
      <InviteCodesSection
        inviteCodes={inviteCodes}
        copiedCode={copiedCode}
        onCopy={(code) => {
          navigator.clipboard.writeText(code);
          setCopiedCode(code);
          setTimeout(() => setCopiedCode(null), 2000);
        }}
      />

      {/* Link to leaderboard */}
      <div className="text-center">
        <Link href="/games/free" className="influence-link text-sm">View Leaderboard →</Link>
      </div>
    </div>
  );
}
