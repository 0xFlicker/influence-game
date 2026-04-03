"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAdminInviteSetting,
  setAdminInviteSetting,
  getAdminInviteCodes,
  adminRefillInviteCodes,
  type AdminInviteCode,
} from "@/lib/api";

export function InviteCodesPanel() {
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [codes, setCodes] = useState<AdminInviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "available" | "used">("all");
  const [error, setError] = useState<string | null>(null);

  // Refill state
  const [refillMin, setRefillMin] = useState("5");
  const [refillDays, setRefillDays] = useState("0");
  const [refilling, setRefilling] = useState(false);
  const [refillResult, setRefillResult] = useState<string | null>(null);

  const fetchSetting = useCallback(async () => {
    try {
      const res = await getAdminInviteSetting();
      setInviteRequired(res.inviteRequired);
    } catch {
      // ignore
    }
  }, []);

  const fetchCodes = useCallback(async () => {
    setError(null);
    try {
      const params = filter === "all" ? undefined : { status: filter as "available" | "used" };
      const res = await getAdminInviteCodes(params);
      setCodes(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invite codes");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  useEffect(() => {
    setLoading(true);
    fetchCodes();
  }, [fetchCodes]);

  async function handleToggle() {
    if (inviteRequired === null) return;
    setToggling(true);
    try {
      const res = await setAdminInviteSetting(!inviteRequired);
      setInviteRequired(res.inviteRequired);
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  }

  async function handleRefill() {
    setRefilling(true);
    setRefillResult(null);
    try {
      const res = await adminRefillInviteCodes(
        Number(refillMin) || 5,
        Number(refillDays) || undefined,
      );
      setRefillResult(`Refilled ${res.totalGenerated} codes across ${res.usersProcessed} users`);
      fetchCodes();
    } catch (err) {
      setRefillResult(err instanceof Error ? err.message : "Refill failed");
    } finally {
      setRefilling(false);
    }
  }

  const availableCount = codes.filter((c) => !c.usedById).length;
  const usedCount = codes.filter((c) => c.usedById).length;

  return (
    <div className="space-y-8">
      {/* Invite Requirement Toggle */}
      <section className="border border-white/10 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold">Invite Code Requirement</h2>
            <p className="text-white/40 text-sm mt-1">
              {inviteRequired === null
                ? "Loading..."
                : inviteRequired
                  ? "New signups require an invite code"
                  : "Signups are open (no invite code needed)"}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={inviteRequired === null || toggling}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
              inviteRequired ? "bg-indigo-600" : "bg-white/20"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                inviteRequired ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </section>

      {/* Bulk Refill */}
      <section className="border border-white/10 rounded-xl p-6">
        <h2 className="text-white font-semibold mb-3">Bulk Refill Codes</h2>
        <p className="text-white/40 text-sm mb-4">
          Ensure all eligible users have a minimum number of available invite codes.
        </p>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs text-white/40 mb-1">Min codes per user</label>
            <input
              type="number"
              min="1"
              max="100"
              value={refillMin}
              onChange={(e) => setRefillMin(e.target.value)}
              className="w-20 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">Min account age (days)</label>
            <input
              type="number"
              min="0"
              value={refillDays}
              onChange={(e) => setRefillDays(e.target.value)}
              className="w-20 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <button
            onClick={handleRefill}
            disabled={refilling}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {refilling ? "Refilling..." : "Refill"}
          </button>
        </div>
        {refillResult && (
          <p className="text-sm text-white/60 mt-3">{refillResult}</p>
        )}
      </section>

      {/* Codes Table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            All Codes
            {!loading && (
              <span className="ml-2 text-white/20">
                ({availableCount} available, {usedCount} used)
              </span>
            )}
          </h2>
          <div className="flex gap-1">
            {(["all", "available", "used"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                  filter === f
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="border border-red-900/40 bg-red-900/20 rounded-xl p-4 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading...
          </div>
        ) : codes.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No invite codes found.
          </div>
        ) : (
          <div className="border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Code</th>
                  <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Owner</th>
                  <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Status</th>
                  <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {codes.slice(0, 100).map((code) => (
                  <tr key={code.id} className="border-t border-white/5">
                    <td className="py-2.5 px-4 font-mono text-sm text-white">{code.code}</td>
                    <td className="py-2.5 px-4 text-sm text-white/60">
                      {code.ownerDisplayName || code.ownerId.slice(0, 8)}
                    </td>
                    <td className="py-2.5 px-4">
                      {code.usedById ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40">Used</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400">Available</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-white/40">
                      {new Date(code.usedAt ?? code.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {codes.length > 100 && (
              <div className="p-3 text-center text-xs text-white/30 border-t border-white/5">
                Showing first 100 of {codes.length} codes
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
