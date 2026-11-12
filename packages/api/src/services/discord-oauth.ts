/** Discord credentials and responses never enter logs, URLs or durable payloads. */
export class DiscordVerificationError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 409 | 429 | 502 | 503, message: string) {
    super(message);
  }
}

export interface DiscordOAuthConfig {
  applicationId: string;
  clientSecret: string;
  guildId: string;
  redirectUri: string;
}
export interface DiscordIdentity { id: string; username: string }
export type DiscordIdentityExchange = (code: string, config: DiscordOAuthConfig, verifier: string) => Promise<DiscordIdentity>;
export const discordSnowflake = /^[0-9]{17,20}$/;
export const discordOpaque = /^[A-Za-z0-9_-]{43}$/;

export function discordOAuthConfig(): DiscordOAuthConfig {
  const applicationId = process.env.DISCORD_APP_ID ?? "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? "";
  const guildId = process.env.DISCORD_HOUSE_GUILD_ID ?? "";
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? "";
  let validRedirect = false;
  try {
    const url = new URL(redirectUri);
    validRedirect = (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
      && url.pathname === "/discord/callback" && !url.search && !url.hash && !url.username && !url.password;
  } catch { /* Invalid operator configuration is reported below, without values. */ }
  if (!discordSnowflake.test(applicationId) || !discordSnowflake.test(guildId) || !clientSecret || !validRedirect) {
    throw new DiscordVerificationError("discord_unconfigured", 503, "Discord verification is not configured. Please contact The House support.");
  }
  return { applicationId, clientSecret, guildId, redirectUri };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Discord response");
  return value as Record<string, unknown>;
}

export async function exchangeDiscordIdentity(code: string, config: DiscordOAuthConfig, verifier: string, request: typeof fetch = fetch): Promise<DiscordIdentity> {
  try {
    const tokenResponse = await request("https://discord.com/api/oauth2/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.applicationId, client_secret: config.clientSecret,
        grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier }),
    });
    if (!tokenResponse.ok) throw new Error("Discord exchange rejected");
    const token = record(await tokenResponse.json());
    if (typeof token.access_token !== "string" || token.token_type !== "Bearer"
      || typeof token.scope !== "string" || !token.scope.split(" ").includes("identify")) throw new Error("Invalid Discord token");
    const response = await request("https://discord.com/api/v10/users/@me", {
      redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new Error("Discord identity unavailable");
    const identity = record(await response.json());
    if (typeof identity.id !== "string" || !discordSnowflake.test(identity.id) || identity.bot === true
      || typeof identity.username !== "string" || !identity.username.length || identity.username.length > 80) throw new Error("Invalid Discord identity");
    return { id: identity.id, username: identity.username };
  } catch {
    // Do not propagate provider bodies, request headers or authorization codes.
    throw new DiscordVerificationError("discord_exchange_failed", 502, "Could not verify Discord. Start again to get a fresh authorization.");
  }
}
