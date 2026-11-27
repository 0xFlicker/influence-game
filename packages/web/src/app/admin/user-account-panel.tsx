"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, listAdminUsers, type AdminUser } from "@/lib/api";
import { formatRoleName } from "@/lib/role-display";
import { usePermissions } from "@/hooks/use-permissions";
import { TypedConfirmationDialog } from "@/components/confirm-action-dialog";
import { AccountRoleEditor } from "./account-role-editor";
import type { HouseParticipation } from "@influence/engine/house-participation";

const inputStyle = "min-h-11 w-full rounded-lg border border-white/25 bg-black/30 px-3 text-white focus-visible:outline-2 focus-visible:outline-indigo-300";
const panelStyle = "rounded-xl border border-white/10 bg-white/[0.025] p-5";
const buttonStyle = "influence-button-secondary min-h-11 rounded-lg px-4";
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
const accountPath = (publicId: string) => `/api/admin/accounts/${encodeURIComponent(publicId)}`;
const message = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function updateRoles(roles: string[], name: string, assigned: boolean) {
  return assigned ? [...new Set([...roles, name])] : roles.filter(role => role !== name);
}

function JoinedDate({ value }: { value: string }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Join date unavailable</span>;
  return <time dateTime={date.toISOString()}>Joined {dateLabel(value)}</time>;
}

export function UserDirectory() {
  const router = useRouter();
  const { roles } = usePermissions();
  const operator = roles.includes("admin") || roles.includes("sysop");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [editingRolesFor, setEditingRolesFor] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void listAdminUsers().then(rows => { if (current) setUsers(rows); }, error => { if (current) setLoadError(message(error)); });
    return () => { current = false; };
  }, []);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLookupError("");
    try {
      const { publicId } = await apiFetch<{ publicId: string }>("/api/admin/accounts/lookup", {
        method: "POST", body: JSON.stringify({ email }),
      });
      router.push(`/admin/users/${publicId}`);
    } catch (error) { setLookupError(message(error)); }
    finally { setBusy(false); setEmail(""); }
  }

  const query = search.trim().toLowerCase();
  const visible = users
    ?.filter(user => [user.displayName, user.handle, user.publicId].some(value => value?.toLowerCase().includes(query)))
    .sort((a, b) => {
      const direction = order === "newest" ? -1 : 1;
      const aDate = Date.parse(a.createdAt);
      const bDate = Date.parse(b.createdAt);
      const sortedA = Number.isFinite(aDate) ? aDate * direction : Infinity;
      const sortedB = Number.isFinite(bDate) ? bDate * direction : Infinity;
      return sortedA - sortedB || a.publicId.localeCompare(b.publicId);
    });
  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">Users</h1>
    {operator && <form className={panelStyle} onSubmit={lookup} data-analytics-private>
      <label htmlFor="account-email" className="block font-medium">Find by email</label>
      <div className="mt-3 flex flex-wrap gap-3">
        <input id="account-email" type="email" value={email} onChange={event => setEmail(event.target.value)}
          required maxLength={320} autoComplete="off" className={`${inputStyle} max-w-md`} />
        <button disabled={busy} className="influence-button-primary min-h-11 rounded-lg px-4">{busy ? "Looking up…" : "Find user"}</button>
      </div>
      {lookupError && <p role="alert" className="mt-3 text-red-300">{lookupError}</p>}
    </form>}
    <section aria-label="Account directory" className={panelStyle}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="directory-search" className="block text-sm font-medium">Filter by name, handle, or ID</label>
          <input id="directory-search" value={search} onChange={event => setSearch(event.target.value)}
            className={`${inputStyle} mt-2`} />
        </div>
        <div className="min-w-0 flex-1 basis-44 sm:max-w-52">
          <label htmlFor="directory-order" className="block text-sm font-medium">Sort by joined date</label>
          <select id="directory-order" value={order} onChange={event => setOrder(event.target.value === "oldest" ? "oldest" : "newest")}
            className={`${inputStyle} mt-2 bg-neutral-950 text-sm`}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>
      {loadError ? <p role="alert" className="mt-4 text-red-300">{loadError}</p>
        : !visible ? <p role="status" className="mt-4">Loading users…</p>
        : !visible.length ? <p className="mt-4">No users found.</p>
        : <ul className="mt-4 divide-y divide-white/10">
          {visible.map(user => {
            const name = user.displayName || user.handle || user.publicId;
            const expanded = editingRolesFor === user.publicId;
            return <li key={user.publicId} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
                <div className="min-w-0 flex-1 basis-48 break-words">
                  {operator ? <Link className="influence-link font-medium" href={`/admin/users/${user.publicId}`}>{name}</Link> : <span>{name}</span>}
                  {user.handle && <p className="text-sm text-white/60">@{user.handle}</p>}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/65">
                  <JoinedDate value={user.createdAt} />
                  <span>{user.deletedAt ? "Closed" : user.roles.map(formatRoleName).join(", ") || "Active"}</span>
                  {user.canManageRoles && <button type="button" aria-expanded={expanded} aria-label={`Manage roles for ${name}`}
                    className="influence-button-secondary min-h-11 rounded-lg px-3"
                    onClick={() => setEditingRolesFor(expanded ? null : user.publicId)}>Manage roles</button>}
                </div>
              </div>
              {expanded && user.canManageRoles && <div className="mt-3 border-l border-white/15 pl-3 sm:max-w-md">
                <AccountRoleEditor publicId={user.publicId} accountName={name} assigned={user.roles}
                  onChange={(role, assigned) => setUsers(current => current?.map(candidate =>
                    candidate.publicId === user.publicId ? { ...candidate, roles: updateRoles(candidate.roles, role, assigned) } : candidate) ?? null)} />
              </div>}
            </li>;
          })}
        </ul>}
    </section>
  </div>;
}

type Account = {
  publicId: string; name: string | null; handle: string | null; createdAt: string; deletedAt: string | null;
  roles: string[]; providers: string[]; agents: { id: string; name: string; archivedAt: string | null }[];
  canDelete: boolean; canManageRoles: boolean; confirmationName: string;
};
type Games = { items: HouseParticipation[]; nextCursor: string | null };

export function UserAccountPanel({ publicId }: { publicId: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [games, setGames] = useState<Games | null>(null);
  const [error, setError] = useState("");
  const [gamesError, setGamesError] = useState("");
  const [gamesBusy, setGamesBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const path = accountPath(publicId);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Account>(path, { signal: controller.signal }).then(setAccount, failure => {
      if (!controller.signal.aborted) setError(message(failure));
    });
    void apiFetch<Games>(`${path}/games`, { signal: controller.signal }).then(setGames, failure => {
      if (!controller.signal.aborted) setGamesError(message(failure));
    });
    return () => controller.abort();
  }, [path]);

  async function loadMore() {
    if (!games?.nextCursor || gamesBusy) return;
    setGamesBusy(true);
    setGamesError("");
    try {
      const page = await apiFetch<Games>(`${path}/games?cursor=${encodeURIComponent(games.nextCursor)}`);
      setGames({ items: [...games.items, ...page.items], nextCursor: page.nextCursor });
    } catch (failure) { setGamesError(message(failure)); }
    finally { setGamesBusy(false); }
  }

  if (error) return <p role="alert">{error} <Link className="influence-link" href="/admin/users">Back to users</Link></p>;
  if (!account) return <p role="status">Loading account…</p>;
  const title = account.name ?? account.handle ?? "Unnamed account";

  async function remove(confirmation: string) {
    const result = await apiFetch<{ deletedAt: string }>(`${path}/deletion`, {
      method: "POST", body: JSON.stringify({ confirmation }),
    });
    setAccount(current => current && { ...current, deletedAt: result.deletedAt, canDelete: false, canManageRoles: false, providers: [], roles: [], handle: null, name: null });
    setConfirm(false);
  }

  return <div className="space-y-6">
    <header>
      <Link className="influence-link text-sm" href="/admin/users">Back to users</Link>
      <h1 className="mt-3 break-words text-3xl font-semibold">{title}</h1>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70">
        {account.handle && <span>@{account.handle}</span>}
        <span>{account.deletedAt ? "Closed" : "Active"}</span>
        <JoinedDate value={account.createdAt} />
      </p>
    </header>
    <div className="grid gap-4 sm:grid-cols-2">
      <section aria-labelledby="account-roles" className={panelStyle}>
        <h2 id="account-roles" className="text-lg font-medium">Roles</h2>
        <p className="mt-2 text-white/70">{account.roles.map(formatRoleName).join(", ") || "No roles assigned"}</p>
        {account.canManageRoles && <div className="mt-4">
          <AccountRoleEditor key={publicId} publicId={publicId} accountName={title} assigned={account.roles}
            onChange={(role, assigned) => setAccount(current => current?.publicId === publicId
              ? { ...current, roles: updateRoles(current.roles, role, assigned) } : current)} />
        </div>}
      </section>
      <section className={panelStyle}><h2 className="text-lg font-medium">Sign-in providers</h2><p className="mt-2 text-white/70">{account.providers.map(provider =>
        ({ clerk: "Clerk", privy: "Privy", farcaster: "Farcaster" }[provider] ?? provider)).join(", ") || "No active sign-in providers"}</p></section>
    </div>
    <section className={panelStyle}><h2 className="text-lg font-medium">Agents</h2>
      {account.agents.length ? <ul className="mt-2 divide-y divide-white/10">
        {account.agents.map(agent => <li key={agent.id} className="flex flex-wrap justify-between gap-2 py-3"><span className="break-words">{agent.name}</span>{agent.archivedAt && <span className="text-sm text-white/60">Archived</span>}</li>)}
      </ul> : <p className="mt-2 text-white/70">No agents.</p>}
    </section>
    <section className={panelStyle}><h2 className="text-lg font-medium">Games</h2>
      {gamesError && <p role="alert" className="mt-2 text-red-300">{gamesError}</p>}
      {!games && !gamesError && <p role="status" className="mt-2">Loading games…</p>}
      {games && (games.items.length ? <ul className="mt-2 divide-y divide-white/10">
        {games.items.map(game => <li key={`${game.gameId}:${game.playerId}`} className="flex flex-wrap justify-between gap-2 py-3">
          <div className="min-w-0"><Link className="influence-link break-words" href={`/games/${game.gameSlug}`}>{game.gameTitle}</Link>
            <p className="break-words text-sm text-white/65">{game.agentName} · {game.gameKind === "influence" ? "Influence" : "Werewolf"}</p></div>
          <span className="text-sm text-white/65">{dateLabel(game.completedAt)}</span>
        </li>)}
      </ul> : <p className="mt-2 text-white/70">No completed games.</p>)}
      {games?.nextCursor && <button className={`${buttonStyle} mt-3`} disabled={gamesBusy} onClick={() => void loadMore()}>{gamesBusy ? "Loading…" : "Load more games"}</button>}
    </section>
    {account.canDelete && <section className="rounded-xl border border-red-300/25 p-5">
      <h2 className="text-lg font-medium">Delete account</h2>
      <p className="mt-2 text-sm text-white/70">Closes access and queues removal from connected sign-in providers. Recorded game participation is kept.</p>
      <button className="influence-button-danger mt-4 min-h-11 rounded-lg px-4" onClick={() => setConfirm(true)}>Delete account</button>
    </section>}
    {account.deletedAt && <p role="status">Account closed on {dateLabel(account.deletedAt)}.</p>}
    {confirm && <TypedConfirmationDialog title="Delete this account?" expected={account.confirmationName} confirmLabel="Delete account"
      onConfirm={remove} onClose={() => setConfirm(false)} />}
  </div>;
}
