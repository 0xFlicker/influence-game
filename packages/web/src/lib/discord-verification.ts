export const DISCORD_ATTEMPT_KEY = "house_discord_attempt";
export const DISCORD_CALLBACK_KEY = "house_discord_callback";
export interface DiscordBrowserAttempt { state: string; nonce: string; accountId: string }
export interface DiscordCallback { code: string; state: string; issuer: string }

/** Match both accounts and the browser tab before sending an OAuth response. */
export function readDiscordCallback(storage: Pick<Storage, "getItem">, accountId: string): { attempt: DiscordBrowserAttempt; callback: DiscordCallback } | null {
  const raw = storage.getItem(DISCORD_CALLBACK_KEY);
  if (!raw) return null;
  const callback = JSON.parse(raw) as Partial<DiscordCallback> & { error?: string };
  const attempt = JSON.parse(storage.getItem(DISCORD_ATTEMPT_KEY) ?? "null") as DiscordBrowserAttempt | null;
  if (callback.error) throw new Error("Discord authorization was cancelled. You can start again.");
  if (!attempt || attempt.accountId !== accountId || attempt.state !== callback.state || !callback.code
    || callback.issuer !== "https://discord.com" || !/^[A-Za-z0-9_-]{43}$/.test(attempt.nonce)) {
    throw new Error("This verification belongs to another sign-in or browser tab. Start again.");
  }
  return { attempt, callback: { code: callback.code, state: callback.state!, issuer: callback.issuer } };
}

export function newDiscordBrowserNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
