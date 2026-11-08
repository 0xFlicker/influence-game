import { createPublicKey, verify } from "node:crypto";
import { discordWorkerConfig, runDiscordRoleWorker } from "./worker.js";

interface HttpEvent { body?: string; isBase64Encoded?: boolean; headers?: Record<string, string | undefined>; requestContext?: { http?: { method?: string } }; source?: string }

/** One interaction owner; verification is available without waking an AI worker. */
export async function handler(event: HttpEvent) {
  if (event.source === "aws.events" && !event.requestContext) return runDiscordRoleWorker(discordWorkerConfig());
  const json = (statusCode: number, value: object) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(value) });
  const publicKey = process.env.DISCORD_HOUSE_PUBLIC_KEY ?? "";
  const appId = process.env.DISCORD_APP_ID;
  if (!/^[a-f0-9]{64}$/i.test(publicKey) || !appId) throw new Error("Discord interactions are not configured");
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const signature = headers["x-signature-ed25519"] ?? "";
  const timestamp = headers["x-signature-timestamp"] ?? "";
  if (event.requestContext?.http?.method !== "POST" || !/^[a-f0-9]{128}$/i.test(signature)
    || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return json(401, { error: "Invalid interaction signature" });
  const raw = Buffer.from(event.body ?? "", event.isBase64Encoded ? "base64" : "utf8");
  if (raw.length > 8192) return json(413, { error: "Interaction too large" });
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]), format: "der", type: "spki" });
  if (!verify(null, Buffer.concat([Buffer.from(timestamp), raw]), key, Buffer.from(signature, "hex"))) return json(401, { error: "Invalid interaction signature" });
  let interaction: { type?: number; application_id?: string; guild_id?: string; data?: { name?: string } };
  try { interaction = JSON.parse(raw.toString("utf8")); } catch { return json(400, { error: "Invalid interaction" }); }
  if (!interaction || interaction.application_id !== appId) return json(401, { error: "Wrong application" });
  if (interaction.type === 1) return json(200, { type: 1 });
  if (interaction.guild_id !== process.env.DISCORD_HOUSE_GUILD_ID) return json(403, { error: "Wrong guild" });
  const web = new URL(process.env.HOUSE_WEB_URL ?? "");
  if (web.protocol !== "https:" || web.username || web.password) throw new Error("Invalid House web URL");
  if (interaction.type !== 2 || interaction.data?.name !== "verify") return json(400, { error: "Unknown command" });
  // Replayed verification commands have no state change or external effect.
  return json(200, { type: 4, data: { flags: 64, content: `Connect your House account and manage your server roles: ${web.origin}/discord/verify`, allowed_mentions: { parse: [] } } });
}
