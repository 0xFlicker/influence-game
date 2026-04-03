"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  getAuthToken,
  getProfile,
  updateProfile,
  getMyInviteCodes,
  type PlayerProfile,
  type InviteCodesResponse,
} from "@/lib/api";

export function ProfileContent() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
          setNameInput(p.displayName ?? "");
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
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateProfile(nameInput);
      setProfile(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        Loading...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="border border-red-900/40 bg-red-900/10 rounded-xl p-8 text-center">
        <p className="text-red-400 text-sm">{error ?? "Profile not found"}</p>
      </div>
    );
  }

  const winRate =
    profile.gamesPlayed > 0
      ? Math.round((profile.gamesWon / profile.gamesPlayed) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-1">Profile</h1>
        <p className="text-white/40 text-sm">
          Your account settings and ELO rating.
        </p>
      </div>

      {/* Display Name */}
      <section className="border border-white/10 rounded-xl p-6">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
          Display Name
        </h2>
        {editing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={50}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500/50"
              placeholder="Enter display name"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving || nameInput.trim().length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setNameInput(profile.displayName ?? "");
                  setSaveError(null);
                }}
                className="text-white/50 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
            {saveError && (
              <p className="text-red-400 text-xs">{saveError}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-white text-lg font-semibold">
              {profile.displayName ?? "Anonymous"}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="text-xs border border-white/15 hover:border-white/30 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit
            </button>
          </div>
        )}
      </section>

      {/* ELO Stats */}
      <section className="border border-white/10 rounded-xl p-6">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
          Rating
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <p className="text-3xl font-bold text-white font-mono">
              {profile.rating}
            </p>
            <p className="text-xs text-white/30 mt-1">Current ELO</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white/60 font-mono">
              {profile.peakRating}
            </p>
            <p className="text-xs text-white/30 mt-1">Peak ELO</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white font-mono">
              {profile.gamesPlayed}
            </p>
            <p className="text-xs text-white/30 mt-1">Games Played</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-yellow-400 font-mono">
              {profile.gamesPlayed > 0 ? `${winRate}%` : "-"}
            </p>
            <p className="text-xs text-white/30 mt-1">
              Win Rate ({profile.gamesWon}W)
            </p>
          </div>
        </div>
      </section>

      {/* Account Info */}
      <section className="border border-white/10 rounded-xl p-6">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
          Account
        </h2>
        <div className="space-y-3 text-sm">
          {profile.walletAddress && (
            <div className="flex items-center justify-between">
              <span className="text-white/40">Wallet</span>
              <span className="text-white/70 font-mono text-xs">
                {profile.walletAddress.slice(0, 6)}...
                {profile.walletAddress.slice(-4)}
              </span>
            </div>
          )}
          {profile.email && (
            <div className="flex items-center justify-between">
              <span className="text-white/40">Email</span>
              <span className="text-white/70">{profile.email}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-white/40">Member since</span>
            <span className="text-white/70">
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </section>

      {/* Invite Codes */}
      {inviteCodes && (
        <section className="border border-white/10 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
            Invite Codes
          </h2>
          <p className="text-sm text-white/50 mb-4">
            Share these codes with friends so they can sign up.
            You have <span className="text-white font-medium">{inviteCodes.totalAvailable}</span> available
            {inviteCodes.totalUsed > 0 && <>, <span className="text-white/40">{inviteCodes.totalUsed} used</span></>}.
          </p>
          {inviteCodes.available.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {inviteCodes.available.map((ic) => (
                <button
                  key={ic.code}
                  onClick={() => {
                    navigator.clipboard.writeText(ic.code);
                    setCopiedCode(ic.code);
                    setTimeout(() => setCopiedCode(null), 2000);
                  }}
                  className="font-mono text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white transition-colors text-center"
                  title="Click to copy"
                >
                  {copiedCode === ic.code ? "Copied!" : ic.code}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-white/30 text-sm">No invite codes available.</p>
          )}
        </section>
      )}

      {/* Link to leaderboard */}
      <div className="text-center">
        <Link
          href="/games/free"
          className="text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
        >
          View Leaderboard →
        </Link>
      </div>
    </div>
  );
}
