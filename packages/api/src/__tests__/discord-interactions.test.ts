import { afterEach, beforeEach, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { handler } from "../discord/lambda.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const applicationId = "1521918515752472606", guildId = "1521918107554152468";
const keys = ["DISCORD_HOUSE_PUBLIC_KEY", "DISCORD_APP_ID", "DISCORD_HOUSE_GUILD_ID", "HOUSE_WEB_URL"] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
beforeEach(() => {
  process.env.DISCORD_HOUSE_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  process.env.DISCORD_APP_ID = applicationId;
  process.env.DISCORD_HOUSE_GUILD_ID = guildId;
  process.env.HOUSE_WEB_URL = "https://thehouse.game";
});
afterEach(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });

function event(body: object, timestamp = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(body);
  return { body: Buffer.from(raw).toString("base64"), isBase64Encoded: true, requestContext: { http: { method: "POST" } },
    headers: { "X-Signature-Ed25519": sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex"), "X-Signature-Timestamp": timestamp } };
}
async function http(input: ReturnType<typeof event>) {
  const result = await handler(input);
  if (!("statusCode" in result)) throw new Error("Expected an HTTP interaction response");
  return { status: result.statusCode, body: JSON.parse(result.body) };
}
test("signed ping and guild verify return private responses without provider access", async () => {
  expect(await http(event({ type: 1, application_id: applicationId }))).toEqual({ status: 200, body: { type: 1 } });
  const response = await http(event({ type: 2, application_id: applicationId, guild_id: guildId, data: { name: "verify" } }));
  expect(response.status).toBe(200);
  expect(response.body.data.flags).toBe(64);
  expect(response.body.data.content).toContain("https://thehouse.game/discord/verify");
  expect(response.body.data.allowed_mentions).toEqual({ parse: [] });
});
test("rejects tampering, expired signatures, wrong app and wrong guild", async () => {
  const valid = event({ type: 1, application_id: applicationId });
  expect((await http({ ...valid, body: Buffer.from("{}").toString("base64") })).status).toBe(401);
  expect((await http(event({ type: 1, application_id: applicationId }, String(Math.floor(Date.now() / 1000) - 360)))).status).toBe(401);
  expect((await http(event({ type: 1, application_id: "wrong" }))).status).toBe(401);
  expect((await http(event({ type: 2, application_id: applicationId, guild_id: "wrong", data: { name: "verify" } }))).status).toBe(403);
});
