import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { gameModelPolicy } from "@influence/engine";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { createSessionToken } from "../middleware/auth.js";
import { createGameRoutes } from "../routes/games.js";
import { createWerewolfRoutes } from "../routes/werewolf.js";
import { createProviderModelRoutes } from "../routes/provider-models.js";
import { acquireGameRunOwner } from "../services/game-ownership.js";
import { claimWerewolfGame } from "../services/werewolf-games.js";
import { startWerewolfLobby } from "../services/werewolf-lobbies.js";
import { abortAllGames, startGame } from "../services/game-lifecycle.js";
import { generateEpisodeCopy } from "../services/episode-presentation.js";
import type { PrivateTraceStorageAdapter } from "../services/private-trace-storage.js";
import { createApiProviderExecutionHooks, reconcileProviderAttemptEvidence } from "../services/provider-call-journal.js";

// Deterministic native response fixtures, never a network/provider request.
function schemaValue(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.includes("null") ? "null" : schema.type[0] : schema.type;
  if (type === "null") return null;
  if (type === "object") return Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([key, value]) => [key, schemaValue(value)]));
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return 1;
  return "I listen carefully before making a choice.";
}

for (const kind of ["influence", "werewolf"] as const) test(`${kind}: API cast runs eight distinct models with a ninth House route`, async () => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "mixed-operator" });
  await grantTestAuthority(db, "mixed-operator", ["create_game", "fill_game", "start_game"], "admin");
  const env = { LINODE_PRIVATE_CONTENT_BUCKET: "fixture-private", JWT_SECRET: "mixed-fixture", INFLUENCE_API_TEST_MOCK_RUNNER: "false", OPENAI_API_KEY: "fixture", XAI_API_KEY: "fixture", API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture", META_MUSE_API_KEY: "fixture", INFLUENCE_LLM_BASE_URL: "http://fixture.invalid/v1" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ model: string; tier?: string }> = [];
  Object.assign(process.env, env);
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = (init?.body ? JSON.parse(String(init.body)) : _url instanceof Request ? await _url.json() : {}) as { model: string; service_tier?: string; text?: { format?: { schema?: Record<string, unknown> } }; response_format?: { json_schema?: { schema?: Record<string, unknown> } } };
    const shape = body.text?.format?.schema ?? body.response_format?.json_schema?.schema;
    if (!shape) throw new Error("Fixture forbids calls without an exact native schema");
    requests.push({ model: body.model, tier: body.service_tier });
    const content = JSON.stringify(schemaValue(shape));
    return Response.json(body.text ? { id: randomUUID(), object: "response", status: "completed", model: body.model,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }
      : { id: randomUUID(), object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
  }, { preconnect: originalFetch.preconnect });
  try {
    const token = await createSessionToken("mixed-operator", { roles: ["admin"], permissions: ["create_game", "fill_game", "start_game"] });
    const app = new Hono().route("/", createGameRoutes(db)).route("/", createWerewolfRoutes(db)).route("/", createProviderModelRoutes(db));
    const request = async <T,>(url: string, method: string, body?: unknown): Promise<T> => {
      const response = await app.request(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(`${url}: ${JSON.stringify(result)}`);
      return result as T;
    };
    const policy = gameModelPolicy({});
    policy.houseManifest = [{ catalogId: "katana:house-fixture" }];
    const game = await request<{ id: string; slug: string }>(kind === "werewolf" ? "/api/werewolf/lobbies" : "/api/games", "POST", kind === "werewolf"
      ? { preset: "two_wolves", setup: { playerCount: 8, wolves: 2, seer: true, doctor: true }, modelRouting: policy }
      : { playerCount: 8, modelRouting: policy });
    await request(`/api/${kind === "werewolf" ? "werewolf" : "games"}/${game.id}/fill`, "POST");
    const cast = await request<{ seats: Array<{ id: string }> }>(`/api/model-routing/games/${game.id}`, "GET");
    const ids = ["openai:gpt-6-luna", "katana:glm-5-3-flash-private", "katana:deepseek-v4-flash", "meta-muse:muse-spark-1.3-contributor", "openai:gpt-5-mini", "openai:gpt-5-nano", "xai:grok-4.6", "custom-openai-compatible:fixture-model"];
    expect(cast.seats).toHaveLength(8);
    const overrides = Object.fromEntries(cast.seats.map((seat: { id: string }, i: number) => [seat.id, { catalogId: ids[i]! }]));
    await request(`/api/model-routing/games/${game.id}`, "PUT", { ...policy, overrides });
    let ownerEpoch: string;
    if (kind === "werewolf") {
      await startWerewolfLobby(db, game.id);
      const claim = await claimWerewolfGame(db, game.id);
      if (!claim.ok) throw new Error(claim.error);
      ownerEpoch = claim.claim.ownerEpoch;
    } else {
      const claim = await acquireGameRunOwner(db, game.id);
      if (!claim.ok) throw new Error(claim.error);
      ownerEpoch = claim.claim.ownerEpoch;
    }
    await startGame(db, game.id, ownerEpoch);
    const deadline = Date.now() + 15_000;
    let accepted: Array<typeof schema.providerLogicalCalls.$inferSelect> = [];
    while (Date.now() < deadline) {
      accepted = (await db.select().from(schema.providerLogicalCalls).where(eq(schema.providerLogicalCalls.gameId, game.id))).filter(row => row.acceptedAttemptId && row.actorRole === "player");
      if (new Set(accepted.map(row => row.actorId)).size === 8) break;
      await Bun.sleep(20);
    }
    await abortAllGames();
    expect(new Set(accepted.map(row => row.actorId)).size).toBe(8);
    for (const call of accepted) expect(call.acceptedCatalogId).toBe(overrides[call.actorId!]!.catalogId);
    expect(new Set(accepted.map(call => call.acceptedCatalogId)).size).toBe(8);
    expect(requests.filter(request => request.model === "gpt-6-luna").every(request => request.tier === "flex")).toBe(true);
    const [row] = await db.select().from(schema.games).where(eq(schema.games.id, game.id));
    const lease = randomUUID();
    await db.insert(schema.gameEpisodePresentations).values({ gameId: game.id, status: "generating", revision: 1, leaseToken: lease, leaseUntil: new Date(Date.now() + 60_000).toISOString() })
      .onConflictDoUpdate({ target: schema.gameEpisodePresentations.gameId, set: { status: "generating", revision: 1, leaseToken: lease, leaseUntil: new Date(Date.now() + 60_000).toISOString() } });
    const hooks = createApiProviderExecutionHooks(db, { gameId: game.id, ownerEpoch: lease, episodeLease: { revision: 1 } });
    const copy = await generateEpisodeCopy([{ name: "Atlas", personality: "curious" }], new AbortController().signal, kind, { gameId: game.id, ownerEpoch: lease, revision: 1, config: JSON.parse(row!.config), hooks });
    expect(copy.title).toBeTruthy();
    expect(requests.at(-1)?.model).toBe("house-fixture");
    const objects = new Map<string, string>();
    const storage: PrivateTraceStorageAdapter = {
      async putObject(input) { objects.set(input.key, input.body); return {}; },
      async getObject(input) { const body = objects.get(input.key); if (body === undefined) throw new Error("Missing fixture evidence"); return { body, contentLength: Buffer.byteLength(body) }; },
      async headObject(input) { const body = objects.get(input.key); if (body === undefined) throw new Error("Missing fixture evidence"); return { contentLength: Buffer.byteLength(body) }; },
    };
    expect(await reconcileProviderAttemptEvidence(db, { evidenceStorage: storage })).toMatchObject({ failed: 0 });
    const attempts = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, game.id));
    const houseAttempt = attempts.find(attempt => attempt.authorityKind === "episode_copy")!;
    expect(houseAttempt.spendProjectionState).toBe("projected");
    expect(houseAttempt.evidenceState).toBe("stored");
    expect(houseAttempt.ownerEpoch).toBe(lease);
    expect(houseAttempt.gameOwnerEpoch).toBeNull();
  } finally {
    await abortAllGames();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}, 30_000);
