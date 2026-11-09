import { expect, test } from "bun:test";
import { exchangeDiscordIdentity } from "../services/discord-oauth.js";

const config = { applicationId: "1521918515752472606", clientSecret: "fixture-secret", guildId: "1521918107554152468", redirectUri: "https://thehouse.game/discord/callback" };
const identity = { id: "931691901592145930", username: "fixture-user" };
test("OAuth exchange uses the bound redirect and PKCE verifier and returns only identity", async () => {
  const requests: Request[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const incoming = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    requests.push(incoming);
    return Response.json(requests.length === 1
      ? { access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", scope: "identify" }
      : identity);
  }) as typeof fetch;
  expect(await exchangeDiscordIdentity("fixture-code", config, "fixture-verifier", request)).toEqual(identity);
  expect(requests[0]!.url).toBe("https://discord.com/api/oauth2/token");
  const form = new URLSearchParams(await requests[0]!.text());
  expect(Object.fromEntries(form)).toEqual({ client_id: config.applicationId, client_secret: config.clientSecret,
    grant_type: "authorization_code", code: "fixture-code", redirect_uri: config.redirectUri, code_verifier: "fixture-verifier" });
  expect(requests[1]!.headers.get("Authorization")).toBe("Bearer fixture-access");
  expect(requests.every(request => request.redirect === "error")).toBe(true);
});
test("OAuth rejects malformed scope, bot identities and provider bodies without exposing credentials", async () => {
  for (const scenario of ["scope", "bot", "id", "provider"] as const) {
    let calls = 0;
    const request = (async (_input: string | URL | Request, _init?: RequestInit) => {
      calls++;
      if (scenario === "provider") return new Response("fixture-secret fixture-access fixture-code", { status: 400 });
      return Response.json(calls === 1
        ? { access_token: "fixture-access", token_type: "Bearer", scope: scenario === "scope" ? "email" : "identify" }
        : { ...identity, ...(scenario === "bot" ? { bot: true } : { id: "not-a-discord-id" }) });
    }) as typeof fetch;
    await expect(exchangeDiscordIdentity("fixture-code", config, "fixture-verifier", request)).rejects.toMatchObject({
      code: "discord_exchange_failed", status: 502, message: "Could not verify Discord. Start again to get a fresh authorization.",
    });
  }
});
