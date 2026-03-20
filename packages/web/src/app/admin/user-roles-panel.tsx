"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listRoles,
  listAddressRoles,
  listAdminUsers,
  assignRole,
  revokeRole,
  type AdminRole,
  type AddressRoleAssignment,
  type AdminUser,
} from "@/lib/api";
import { TruncatedAddress } from "@/components/truncated-address";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleBadgeColors: Record<string, string> = {
  sysop: "bg-red-900/40 text-red-400",
  admin: "bg-blue-900/40 text-blue-400",
  player: "bg-green-900/40 text-green-400",
};

function RoleBadge({ name }: { name: string }) {
  const color = roleBadgeColors[name] ?? "bg-white/10 text-white/60";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>
      {name}
    </span>
  );
}

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ---------------------------------------------------------------------------
// Assign role form
// ---------------------------------------------------------------------------

function AssignRoleForm({
  roles,
  onAssigned,
}: {
  roles: AdminRole[];
  onAssigned: () => void;
}) {
  const [address, setAddress] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = address.trim().toLowerCase();
    if (!isValidAddress(normalized)) {
      setError("Invalid wallet address (must be 0x + 40 hex chars)");
      return;
    }
    if (!selectedRoleId) {
      setError("Select a role");
      return;
    }

    setSubmitting(true);
    try {
      await assignRole(normalized, selectedRoleId);
      setAddress("");
      setSelectedRoleId("");
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
      <div className="flex-1 min-w-[280px]">
        <label className="block text-xs text-white/40 mb-1">Wallet Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x..."
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500"
        />
      </div>
      <div className="min-w-[160px]">
        <label className="block text-xs text-white/40 mb-1">Role</label>
        <select
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">Select role...</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {submitting ? "Assigning..." : "Assign Role"}
      </button>
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Address roles table
// ---------------------------------------------------------------------------

function AddressRolesTable({
  assignments,
  onRevoke,
}: {
  assignments: AddressRoleAssignment[];
  onRevoke: (walletAddress: string, roleId: string, roleName: string) => void;
}) {
  if (assignments.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        No role assignments yet. Use the form above to assign roles.
      </div>
    );
  }

  // Group by wallet address
  const grouped = new Map<string, AddressRoleAssignment[]>();
  for (const a of assignments) {
    const list = grouped.get(a.walletAddress) ?? [];
    list.push(a);
    grouped.set(a.walletAddress, list);
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Address</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Roles</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Granted By</th>
            <th className="text-right py-3 px-4 text-xs text-white/30 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...grouped.entries()].map(([addr, roles]) => (
            <tr key={addr} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 text-white/60 text-sm font-mono">
                <TruncatedAddress address={addr} maxWidth="11ch" />
              </td>
              <td className="py-3 px-4">
                <div className="flex gap-1 flex-wrap">
                  {roles.map((r) => (
                    <RoleBadge key={r.roleId} name={r.roleName} />
                  ))}
                </div>
              </td>
              <td className="py-3 px-4 text-white/40 text-xs font-mono">
                {roles[0]?.grantedBy ? <TruncatedAddress address={roles[0].grantedBy} maxWidth="11ch" /> : "—"}
              </td>
              <td className="py-3 px-4 text-right">
                <div className="flex justify-end gap-1">
                  {roles.map((r) => (
                    <button
                      key={r.roleId}
                      onClick={() => onRevoke(addr, r.roleId, r.roleName)}
                      className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                      title={`Revoke ${r.roleName}`}
                    >
                      Revoke {r.roleName}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users table
// ---------------------------------------------------------------------------

function UsersTable({
  users,
  onQuickAssign,
}: {
  users: AdminUser[];
  onQuickAssign: (walletAddress: string) => void;
}) {
  if (users.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        No registered users yet.
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Address</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Display Name</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Email</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Roles</th>
            <th className="text-left py-3 px-4 text-xs text-white/30 font-medium">Joined</th>
            <th className="text-right py-3 px-4 text-xs text-white/30 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 text-white/60 text-sm font-mono">
                {user.walletAddress ? <TruncatedAddress address={user.walletAddress} maxWidth="11ch" /> : "—"}
              </td>
              <td className="py-3 px-4 text-white text-sm">{user.displayName ?? "—"}</td>
              <td className="py-3 px-4 text-white/50 text-sm">{user.email ?? "—"}</td>
              <td className="py-3 px-4">
                <div className="flex gap-1 flex-wrap">
                  {user.roles.length > 0
                    ? user.roles.map((r) => <RoleBadge key={r} name={r} />)
                    : <span className="text-xs text-white/20">none</span>
                  }
                </div>
              </td>
              <td className="py-3 px-4 text-white/40 text-xs">
                {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </td>
              <td className="py-3 px-4 text-right">
                {user.walletAddress && (
                  <button
                    onClick={() => onQuickAssign(user.walletAddress!)}
                    className="text-xs text-indigo-400/70 hover:text-indigo-400 transition-colors"
                  >
                    + Assign role
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
        <p className="text-white text-sm mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-sm bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function UserRolesPanel() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [assignments, setAssignments] = useState<AddressRoleAssignment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{
    walletAddress: string;
    roleId: string;
    roleName: string;
  } | null>(null);
  const [prefillAddress, setPrefillAddress] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [r, a, u] = await Promise.all([
        listRoles(),
        listAddressRoles(),
        listAdminUsers(),
      ]);
      setRoles(r);
      setAssignments(a);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load RBAC data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleRevoke() {
    if (!revokeConfirm) return;
    try {
      await revokeRole(revokeConfirm.walletAddress, revokeConfirm.roleId);
      setRevokeConfirm(null);
      fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke role.");
    }
  }

  function handleRevokeClick(walletAddress: string, roleId: string, roleName: string) {
    if (roleName === "sysop") {
      setRevokeConfirm({ walletAddress, roleId, roleName });
    } else {
      revokeRole(walletAddress, roleId).then(() => fetchAll()).catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to revoke role.");
      });
    }
  }

  if (loading) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-6 border border-red-900/40 bg-red-900/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Assign role form */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Assign Role
        </h2>
        <div className="border border-white/10 rounded-xl p-5">
          <AssignRoleForm roles={roles} onAssigned={fetchAll} />
          {prefillAddress && (
            <p className="text-xs text-white/30 mt-2">
              Pre-filled address: <span className="font-mono">{prefillAddress}</span>
            </p>
          )}
        </div>
      </section>

      {/* Address-role assignments */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Role Assignments ({assignments.length})
        </h2>
        <AddressRolesTable
          assignments={assignments}
          onRevoke={handleRevokeClick}
        />
      </section>

      {/* Users */}
      <section>
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Registered Users ({users.length})
        </h2>
        <UsersTable
          users={users}
          onQuickAssign={(addr) => setPrefillAddress(addr)}
        />
      </section>

      {/* Confirm dialog for sysop revoke */}
      {revokeConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to revoke the sysop role from ${revokeConfirm.walletAddress}? This is a privileged role.`}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeConfirm(null)}
        />
      )}
    </div>
  );
}
