"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { assignRole, listRoles, revokeRole, type AdminRole } from "@/lib/api";
import { formatRoleName } from "@/lib/role-display";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AccountRoleEditor({ publicId, accountName, assigned, onChange }: {
  publicId: string;
  accountName: string;
  assigned: string[];
  onChange: (roleName: string, assigned: boolean) => void;
}) {
  const selectId = useId();
  const [catalog, setCatalog] = useState<AdminRole[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmSysop, setConfirmSysop] = useState<AdminRole | null>(null);

  useEffect(() => {
    let current = true;
    void listRoles().then(roles => {
      if (current) setCatalog(roles);
    }, failure => {
      if (current) setError(errorMessage(failure, "Could not load roles."));
    });
    return () => { current = false; };
  }, []);

  async function change(role: AdminRole, grant: boolean) {
    if (pending) return;
    setPending(true);
    setError("");
    setStatus("");
    try {
      if (grant) {
        await assignRole({ publicId }, role.id);
        setSelectedId("");
      } else {
        await revokeRole({ publicId }, role.id);
        setConfirmSysop(null);
      }
      onChange(role.name, grant);
      setStatus(`${formatRoleName(role.name)} ${grant ? "assigned" : "revoked"}.`);
    } catch (failure) {
      setError(errorMessage(failure, "Could not update roles."));
    } finally {
      setPending(false);
    }
  }

  const available = catalog?.filter(role => !assigned.includes(role.name)) ?? [];
  const selected = available.find(role => role.id === selectedId);
  const active = catalog?.filter(role => assigned.includes(role.name)) ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected) void change(selected, true);
  }

  return <div className="space-y-3">
    {!catalog && !error && <p className="text-sm text-white/70" role="status">Loading roles…</p>}
    {catalog && <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor={selectId} className="block text-sm font-medium">Role to assign</label>
        <select id={selectId} value={selected?.id ?? ""} disabled={pending || !available.length}
          onChange={event => setSelectedId(event.target.value)}
          className="influence-field mt-2 min-h-11 w-full rounded-lg bg-neutral-950 px-3 text-sm">
          <option value="">{available.length ? "Select role" : "All roles assigned"}</option>
          {available.map(role => <option value={role.id} key={role.id}>{formatRoleName(role.name)}</option>)}
        </select>
      </div>
      <button type="submit" className="influence-button-primary min-h-11 rounded-lg px-4 text-sm" disabled={!selected || pending}>Assign role</button>
    </form>}
    {active.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Revoke assigned roles">
      {active.map(role => <li key={role.id}>
        <button type="button" disabled={pending} className="influence-button-secondary min-h-11 rounded-lg px-3 text-sm"
          onClick={() => {
            if (role.name === "sysop") {
              setError("");
              setStatus("");
              setConfirmSysop(role);
            } else void change(role, false);
          }}>Revoke {formatRoleName(role.name)}</button>
      </li>)}
    </ul>}
    {error && !confirmSysop && <p className="text-sm text-red-300" role="alert">{error}</p>}
    {status && <p className="text-sm text-white/75" role="status">{status}</p>}
    {confirmSysop && <ConfirmActionDialog title="Revoke Sysop role?" confirmLabel={pending ? "Revoking…" : "Revoke Sysop"}
      danger disabled={pending} busy={pending}
      onConfirm={() => void change(confirmSysop, false)} onClose={() => { setConfirmSysop(null); setError(""); }}>
      <p className="break-words">Remove the Sysop role from {accountName}?</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </ConfirmActionDialog>}
  </div>;
}
