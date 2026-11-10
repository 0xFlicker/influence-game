"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  listRoles,
  listUserRoles,
  listAdminUsers,
  assignRole,
  revokeRole,
  type AdminRole,
  type UserRoleAssignment,
  type AdminUser,
} from "@/lib/api";
import { TruncatedAddress } from "@/components/truncated-address";
import { formatRoleName, getRoleBadgeClass } from "@/lib/role-display";
import { compareSortValues, SortableColumnHeader, type SortDirection } from "./sortable-column-header";

type UserSortKey = "address" | "displayName" | "email" | "roles" | "joined";

function userSortValue(user: AdminUser, key: UserSortKey): string | null {
  switch (key) {
    case "address": return user.walletAddress;
    case "displayName": return user.displayName;
    case "email": return user.email;
    case "roles": return user.roles.length > 0 ? [...user.roles].sort().join(", ") : null;
    case "joined": return user.createdAt;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function RoleBadge({ name }: { name: string }) {
  const color = getRoleBadgeClass(name);
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>
      {formatRoleName(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Assign role form
// ---------------------------------------------------------------------------

function AssignRoleForm({
  roles,
  users,
  onAssigned,
  initialUserId,
}: {
  roles: AdminRole[];
  users: AdminUser[];
  onAssigned: () => void;
  initialUserId?: string | null;
}) {
  const [userId, setUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialUserId) {
      setUserId(initialUserId);
    }
  }, [initialUserId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = userId;
    if (!users.some(user => user.id === normalized)) {
      setError("Select an account");
      return;
    }
    if (!selectedRoleId) {
      setError("Select a role");
      return;
    }

    setSubmitting(true);
    try {
      await assignRole(normalized, selectedRoleId);
      setUserId("");
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
        <label className="block text-xs text-white/40 mb-1">Account</label>
        <select aria-label="Account" value={userId} onChange={e => setUserId(e.target.value)}
          className="w-full bg-zinc-950 border border-white/15 rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Select account...</option>
          {users.filter(user => user.walletAddress?.toLowerCase() !== "0x0000000000000000000000000000000000000000").map(user => (
            <option key={user.id} value={user.id}>{user.displayName ?? "Anonymous"} · {user.email ?? user.walletAddress ?? user.id}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[160px]">
        <label className="block text-xs text-white/40 mb-1">Role</label>
        <select
          aria-label="Role"
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          className="w-full appearance-none bg-zinc-950 border border-white/15 rounded-lg px-3 py-2 text-sm text-white shadow-inner shadow-black/20 focus:outline-none focus:border-indigo-500"
          style={{ colorScheme: "dark" }}
        >
          <option value="" className="bg-zinc-950 text-white">
            Select role...
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id} className="bg-zinc-950 text-white">
              {formatRoleName(r.name)}
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
// Account roles table
// ---------------------------------------------------------------------------

function UserRolesTable({
  assignments,
  users,
  onRevoke,
}: {
  assignments: UserRoleAssignment[];
  users: AdminUser[];
  onRevoke: (userId: string, roleId: string, roleName: string) => void;
}) {
  const [sortKey, setSortKey] = useState<"account" | "roles" | "grantedBy">("account");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  function handleSort(column: "account" | "roles" | "grantedBy") {
    setSortDirection(column === sortKey && sortDirection === "asc" ? "desc" : "asc");
    setSortKey(column);
  }

  const usersById = new Map<string, AdminUser>();
  for (const u of users) {
    if (u.id) {
      usersById.set(u.id, u);
    }
  }
  if (assignments.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        No role assignments yet. Use the form above to assign roles.
      </div>
    );
  }

  // Group by account
  const grouped = new Map<string, UserRoleAssignment[]>();
  for (const a of assignments) {
    const list = grouped.get(a.userId) ?? [];
    list.push(a);
    grouped.set(a.userId, list);
  }
  const sortedAssignments = [...grouped.entries()].sort(([aId, aRoles], [bId, bRoles]) => {
    function value(userId: string, roles: UserRoleAssignment[]): string | null {
      const user = usersById.get(userId);
      switch (sortKey) {
        case "account": return user?.displayName ?? user?.email ?? user?.walletAddress ?? userId;
        case "roles": return roles.map((role) => role.roleName).sort().join(", ");
        case "grantedBy": return roles[0]?.grantedBy ?? null;
      }
    }
    const aValue = value(aId, aRoles);
    const bValue = value(bId, bRoles);
    if (aValue === null || bValue === null) return aValue === null ? (bValue === null ? 0 : 1) : -1;
    return compareSortValues(aValue, bValue) * (sortDirection === "asc" ? 1 : -1)
      || aId.localeCompare(bId);
  });

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <SortableColumnHeader column="account" label="Account" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortableColumnHeader column="roles" label="Roles" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <SortableColumnHeader column="grantedBy" label="Granted By" sortKey={sortKey} direction={sortDirection} onSort={handleSort} />
            <th scope="col" className="py-3 px-4 text-right text-xs font-medium text-white/30">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedAssignments.map(([addr, roles]) => {
            const user = usersById.get(addr);
            const label = user?.displayName && !user.displayName.startsWith("0x")
              ? user.displayName
              : user?.email ?? null;
            return (
            <tr key={addr} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 text-sm">
                {label ? (
                  <div className="flex flex-col">
                    {user?.publicProfileId ? (
                      <Link href={`/profile/${encodeURIComponent(user.publicProfileId)}`} prefetch={false} className="text-white/70 hover:underline focus-visible:underline">{label}</Link>
                    ) : (
                      <span className="text-white/70">{label}</span>
                    )}
                    <span className="text-white/25 text-xs font-mono">
                      <TruncatedAddress address={addr} maxWidth="11ch" />
                    </span>
                  </div>
                ) : (
                  user?.publicProfileId ? (
                    <Link href={`/profile/${encodeURIComponent(user.publicProfileId)}`} prefetch={false} className="text-white/60 hover:underline focus-visible:underline">View profile</Link>
                  ) : (
                    <span className="text-white/60 font-mono">
                      <TruncatedAddress address={addr} maxWidth="11ch" />
                    </span>
                  )
                )}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users table
// ---------------------------------------------------------------------------

export function UsersTable({
  users,
  onQuickAssign,
}: {
  users: AdminUser[];
  onQuickAssign: (userId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<UserSortKey>("joined");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  function handleSort(column: UserSortKey) {
    setSortDirection(column === sortKey && sortDirection === "asc" ? "desc" : "asc");
    setSortKey(column);
  }

  if (users.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
        No registered users yet.
      </div>
    );
  }

  const sorted = [...users].sort((a, b) => {
    const aValue = userSortValue(a, sortKey);
    const bValue = userSortValue(b, sortKey);
    if (aValue === null || bValue === null) return aValue === null ? (bValue === null ? 0 : 1) : -1;
    return compareSortValues(aValue, bValue) * (sortDirection === "asc" ? 1 : -1)
      || a.id.localeCompare(b.id);
  });

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            {([
              ["address", "Address"], ["displayName", "Display Name"], ["email", "Email"],
              ["roles", "Roles"], ["joined", "Joined"],
            ] as const).map(([key, label]) => (
              <SortableColumnHeader
                key={key}
                column={key}
                label={label}
                sortKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
            ))}
            <th scope="col" className="py-3 px-4 text-right text-xs font-medium text-white/30">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((user) => (
            <tr key={user.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-4 text-white/60 text-sm font-mono">
                {user.walletAddress ? <TruncatedAddress address={user.walletAddress} maxWidth="11ch" /> : "—"}
              </td>
              <td className="py-3 px-4 text-white text-sm font-mono">
                {user.publicProfileId ? (
                  <Link href={`/profile/${encodeURIComponent(user.publicProfileId)}`} prefetch={false} className="hover:underline focus-visible:underline" aria-label={`View ${user.displayName ?? user.email ?? "user"} public profile`}>
                    {user.displayName
                      ? (user.displayName.startsWith("0x")
                          ? <TruncatedAddress address={user.displayName} maxWidth="11ch" />
                          : user.displayName)
                      : "View profile"}
                  </Link>
                ) : (user.displayName ?? "—")}
              </td>
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
                {user.walletAddress?.toLowerCase() !== "0x0000000000000000000000000000000000000000" && (
                  <button
                    onClick={() => onQuickAssign(user.id)}
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
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{
    userId: string;
    roleId: string;
    roleName: string;
  } | null>(null);
  const [prefillUserId, setPrefillUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [r, a, u] = await Promise.all([
        listRoles(),
        listUserRoles(),
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
      await revokeRole(revokeConfirm.userId, revokeConfirm.roleId);
      setRevokeConfirm(null);
      fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke role.");
    }
  }

  function handleRevokeClick(userId: string, roleId: string, roleName: string) {
    if (roleName === "sysop") {
      setRevokeConfirm({ userId, roleId, roleName });
    } else {
      revokeRole(userId, roleId).then(() => fetchAll()).catch((err) => {
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
          <AssignRoleForm users={users} roles={roles} onAssigned={fetchAll} initialUserId={prefillUserId} />
          {prefillUserId && (
            <p className="text-xs text-white/30 mt-2">
              Selected account: <span>{users.find(user => user.id === prefillUserId)?.displayName ?? "Anonymous"}</span>
            </p>
          )}
        </div>
      </section>

      {/* Account-role assignments */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Role Assignments ({assignments.length})
        </h2>
        <UserRolesTable
          assignments={assignments}
          users={users}
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
          onQuickAssign={(addr) => setPrefillUserId(addr)}
        />
      </section>

      {/* Confirm dialog for sysop revoke */}
      {revokeConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to revoke the sysop role from ${users.find(user => user.id === revokeConfirm.userId)?.displayName ?? "this account"}? This is a privileged role.`}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeConfirm(null)}
        />
      )}
    </div>
  );
}
