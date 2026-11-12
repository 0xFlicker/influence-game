/** AWS-compatible worker. No database access, human session, or agent runtime. */
export interface DiscordWorkerConfig {
  apiUrl: string; workerToken: string; botToken: string; guildId: string;
  roleIds: Record<"user" | "moderator" | "admin" | "sysop", string>;
}
interface Work {
  id: string; lease: string; revision: number; discordId: string; guildId: string;
  roles: string[]; disconnecting: boolean;
}
type DeliveryFailure = "configuration" | "member_missing" | "member_pending" | "permissions" | "rate_limited" | "discord_unavailable" | "superseded";
class DeliveryError extends Error {
  constructor(public readonly code: DeliveryFailure, public readonly retryAfter?: number) { super(code); }
}
interface Role { id: string; position: number; permissions: string; managed: boolean }
interface Member { roles: string[]; pending?: boolean }
const snowflake = /^[0-9]{17,20}$/;
export function discordWorkerConfig(): DiscordWorkerConfig {
  const roleIds = { user: process.env.DISCORD_ROLE_USER_ID ?? "", moderator: process.env.DISCORD_ROLE_MODERATOR_ID ?? "",
    admin: process.env.DISCORD_ROLE_ADMIN_ID ?? "", sysop: process.env.DISCORD_ROLE_SYSOP_ID ?? "" };
  const config = { apiUrl: process.env.HOUSE_API_URL ?? "", workerToken: process.env.DISCORD_WORKER_TOKEN ?? "",
    botToken: process.env.DISCORD_BOT_TOKEN ?? "", guildId: process.env.DISCORD_HOUSE_GUILD_ID ?? "", roleIds };
  const url = new URL(config.apiUrl);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || config.workerToken.length < 43 || !config.botToken
    || !snowflake.test(config.guildId) || Object.values(roleIds).some(id => !snowflake.test(id) || id === config.guildId)
    || new Set(Object.values(roleIds)).size !== 4) throw new Error("Invalid Discord worker configuration");
  return config;
}

export async function runDiscordRoleWorker(config: DiscordWorkerConfig, request: typeof fetch = fetch): Promise<{ status: "idle" | "delivered" | "retry" | "superseded" }> {
  const deadline = AbortSignal.timeout(50_000);
  async function api<T>(path: string, body: object): Promise<T> {
    const response = await request(`${config.apiUrl.replace(/\/$/, "")}/api/internal/discord/work/${path}`, {
      method: "POST", redirect: "error", signal: path === "complete" ? AbortSignal.timeout(8000)
        : AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
      headers: { Authorization: `Bearer ${config.workerToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("House Discord work API unavailable");
    return response.json() as Promise<T>;
  }
  async function discord<T>(path: string, method = "GET"): Promise<T> {
    const response = await request(`https://discord.com/api/v10${path}`, { method, redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]), headers: { Authorization: `Bot ${config.botToken}` } });
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const raw = retryAfter === null ? 60 : Number(retryAfter);
      throw new DeliveryError("rate_limited", Number.isFinite(raw) ? Math.min(86400, Math.max(1, raw)) : 60);
    }
    if (response.status === 401 || response.status === 403) throw new DeliveryError("permissions");
    if (response.status === 404) {
      const failure: unknown = await response.json();
      // Unknown guild (e.g. a removed bot) is not evidence that the member left.
      // Only Discord's explicit Unknown Member code can complete absent-member cleanup.
      if (failure && typeof failure === "object" && "code" in failure && failure.code === 10007) {
        throw new DeliveryError("member_missing");
      }
      throw new DeliveryError("configuration");
    }
    if (!response.ok) throw new DeliveryError("discord_unavailable");
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  const { work } = await api<{ work: Work | null }>("claim", {});
  if (!work) return { status: "idle" };
  const receipt = { id: work.id, lease: work.lease, revision: work.revision, roles: work.roles };
  async function assertCurrent() {
    if (deadline.aborted) throw new DeliveryError("discord_unavailable");
    const current = (await api<{ work: Work | null }>("current", { id: work!.id, lease: work!.lease })).work;
    if (!current || current.revision !== work!.revision || current.roles.join(",") !== work!.roles.join(",")
      || current.disconnecting !== work!.disconnecting) throw new DeliveryError("superseded");
  }
  try {
    if (work.guildId !== config.guildId || work.roles.some(role => !(role in config.roleIds))) throw new DeliveryError("configuration");
    const managed = Object.values(config.roleIds);
    const desired = work.roles.map(role => config.roleIds[role as keyof typeof config.roleIds]);
    const memberPath = `/guilds/${work.guildId}/members/${work.discordId}`;
    let member: Member;
    try { member = await discord<Member>(memberPath); }
    catch (error) {
      if (!(error instanceof DeliveryError && error.code === "member_missing" && work.disconnecting)) throw error;
      await assertCurrent();
      const result = await api<{ accepted: boolean }>("complete", receipt);
      return { status: result.accepted ? "delivered" : "superseded" };
    }
    if (member.pending && !work.disconnecting) throw new DeliveryError("member_pending");
    const allRoles = await discord<Role[]>(`/guilds/${work.guildId}/roles`);
    const bot = await discord<{ id: string }>("/users/@me");
    const botMember = await discord<Member>(`/guilds/${work.guildId}/members/${bot.id}`);
    const botPosition = Math.max(0, ...allRoles.filter(role => botMember.roles.includes(role.id)).map(role => role.position));
    const removals = managed.filter(id => member.roles.includes(id) && !desired.includes(id));
    const additions = desired.filter(id => !member.roles.includes(id));
    // Refuse unsafe grants, but still remove an old Administrator grant on unlink.
    if ([...new Set([...removals, ...desired])].some(id => {
      const role = allRoles.find(candidate => candidate.id === id);
      return !role || role.managed || role.position >= botPosition
        || (desired.includes(id) && (BigInt(role.permissions) & 8n) !== 0n);
    })) throw new DeliveryError("configuration");
    for (const [method, ids] of [["DELETE", removals], ["PUT", additions]] as const) {
      for (const id of ids) { await assertCurrent(); await discord(`${memberPath}/roles/${id}`, method); }
    }
    await assertCurrent();
    const after = await discord<Member>(memberPath);
    if (managed.some(id => after.roles.includes(id) !== desired.includes(id))) throw new DeliveryError("discord_unavailable");
    const result = await api<{ accepted: boolean }>("complete", receipt);
    return { status: result.accepted ? "delivered" : "superseded" };
  } catch (error) {
    const failure = error instanceof DeliveryError ? error : new DeliveryError("discord_unavailable");
    await api("complete", { ...receipt, error: failure.code, retryAfter: failure.retryAfter });
    return { status: failure.code === "superseded" ? "superseded" : "retry" };
  }
}
