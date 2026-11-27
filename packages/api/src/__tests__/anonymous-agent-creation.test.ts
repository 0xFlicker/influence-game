import { loadPayloads } from "../services/payload-storage.js";
import onomaverse from "../data/onomaverse-v2026.10.json";
import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { Hono } from "hono";
import { APIConnectionTimeoutError } from "openai";
import { FAILURE_HEADER, REQUEST_ID_HEADER, uuid } from "@influence/engine/operational-errors";
import { requestDiagnostics } from "../middleware/request-diagnostics.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import type { TextProviderAttempt } from "../services/text-provider-attempts.js";
import { runAnonymousText, readAnonymousAllowance } from "../services/anonymous-text-usage.js";
import { decodeAnonymousCreationTurn, type AnonymousCreationTurn } from "../services/anonymous-agent-creation.js";
import { createAnonymousAgentCreationRoutes } from "../routes/anonymous-agent-creation.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";

const profile = { name: "Mira Vale", gender: "female", personaKey: "diplomat", backstory: "A former envoy.",
  personality: "Patient, warm, and suspicious of easy promises.", strategyStyle: "Build trust, at the risk of waiting too long.",
  performanceInstructions: "Quiet gestures.", visualDesign: "A blue coat.", werewolfStrategyStyle: "Test claims as village; bluff consistently as wolf.", introQuips: ["Trust takes time.", "I keep receipts.", "We can talk."] };
const turn = { reply: "Mira builds trust, but may hesitate to act. Does she feel right?", profile: { ...profile, gender: "female" as const } };
const naming = { shortlist: [profile.name], userText: [] };
const encodedProfile = { ...profile, name: { source: "shortlist", value: profile.name } };
const response: ChatCompletion = { id: "preview-response", object: "chat.completion", created: 0, model: "gpt-5.6-luna", choices: [],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };

describe("Anonymous preview pool", () => {
  let db: DrizzleDB;
  beforeEach(async () => { db = await setupTestDB(); process.env.JWT_SECRET = "anonymous-preview-test-secret"; });
  const input = (visitorHash = randomUUID()) => ({ visitorHash, requestKey: randomUUID(), model: "test", payload: { idea: "diplomat" } });
  const reopenMinute = () => db.execute(sql`UPDATE anonymous_text_operations SET created_at = clock_timestamp() - interval '61 seconds'`);

  test("racing visitors share one global slot; denial does not spend the loser's message", async () => {
    let calls = 0;
    const visitors = [input(), input()];
    const results = await Promise.allSettled(visitors.map(value => runAnonymousText(db, value, async attempt => {
      calls++; await attempt(async () => response); return turn;
    })));
    expect(calls).toBe(1);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex(result => result.status === "rejected");
    const denied = results[loser];
    expect(denied?.status === "rejected" && denied.reason).toMatchObject({ code: "anonymous_pool_busy", status: 429 });
    expect(await readAnonymousAllowance(db, visitors[loser]!.visitorHash)).toEqual({ used: false });
    await reopenMinute();
    await runAnonymousText(db, visitors[loser]!, async () => turn);
    expect(await loadPayloads(db.select().from(schema.anonymousTextOperations))).toHaveLength(2);
  });

  test("response-loss replay is free; a second request requires signup even after the minute", async () => {
    const value = input(); let calls = 0;
    const run = async (attempt: TextProviderAttempt) => { calls++; await attempt(async () => response); return turn; };
    expect(await runAnonymousText(db, value, run)).toEqual(turn);
    expect(await runAnonymousText(db, value, run)).toEqual(turn);
    expect(calls).toBe(1);
    await expect(runAnonymousText(db, { ...value, payload: { idea: "changed" } }, run)).rejects.toMatchObject({ code: "request_conflict" });
    await reopenMinute();
    await expect(runAnonymousText(db, { ...value, requestKey: randomUUID() }, run)).rejects.toMatchObject({ code: "anonymous_signup_required", status: 403 });
    const [operation] = await loadPayloads(db.select().from(schema.anonymousTextOperations));
    expect(operation).toMatchObject({ state: "succeeded", promptTokens: 20, completionTokens: 10, providerRequestId: response.id });
    expect(operation!.estimatedCostMicrousd).not.toBeNull();
  });

  test("malformed output is not accepted, retains cost evidence, and can be retried after the minute", async () => {
    const value = input();
    await expect(runAnonymousText(db, value, async attempt => {
      await attempt(async () => response); return decodeAnonymousCreationTurn("{}", naming);
    })).rejects.toThrow("Invalid House preview fields");
    expect(await readAnonymousAllowance(db, value.visitorHash)).toEqual({ used: false });
    const [operation] = await loadPayloads(db.select().from(schema.anonymousTextOperations));
    expect(operation).toMatchObject({ state: "failed", result: null, promptTokens: 20 });
    await reopenMinute();
    expect(await runAnonymousText(db, { ...value, requestKey: randomUUID() }, async () => turn)).toEqual(turn);
  });

  test("unknown transport outcome reserves the visitor's message and cannot dispatch again", async () => {
    const value = input();
    await expect(runAnonymousText(db, value, attempt => attempt(async () => { throw new Error("connection lost"); }))).rejects.toThrow("connection lost");
    expect(await readAnonymousAllowance(db, value.visitorHash)).toEqual({ used: true });
    await reopenMinute();
    await expect(runAnonymousText(db, { ...value, requestKey: randomUUID() }, async () => turn)).rejects.toMatchObject({ code: "anonymous_signup_required" });
    expect((await loadPayloads(db.select().from(schema.anonymousTextOperations)))[0]!.state).toBe("uncertain");
  });

  test("public session, cookie replay and admission errors work without a user row; private writes remain gated", async () => {
    let calls = 0;
    const app = new Hono().route("/", createAnonymousAgentCreationRoutes(db, async (_body, _signal, attempt) => {
      calls++; await attempt(async () => response); return structuredClone(turn) as AnonymousCreationTurn;
    })).route("/", createAgentProfileRoutes(db));
    const status = await app.request("/api/agent-profiles/anonymous");
    expect(await status.json()).toEqual({ used: false });
    expect(status.headers.get("Cache-Control")).toBe("private, no-store");
    const cookie = status.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax");
    const key = randomUUID();
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key, Cookie: cookie.split(";")[0]! };
    const body = JSON.stringify({ message: "A quiet diplomat", creationTraitIds: [] });
    const request = (requestHeaders = headers) => app.request("/api/agent-profiles/anonymous", { method: "POST", headers: requestHeaders, body });
    expect((await request()).status).toBe(200); expect((await request()).status).toBe(200); expect(calls).toBe(1);
    expect((await db.select().from(schema.users))).toHaveLength(0);
    expect(await (await app.request("/api/agent-profiles/anonymous", { headers })).json()).toEqual({ used: true });
    const exhausted = await request({ ...headers, "Idempotency-Key": randomUUID() });
    expect(exhausted.status).toBe(403); expect(await exhausted.json()).toMatchObject({ code: "anonymous_signup_required" });
    const busy = await request({ ...headers, Cookie: "", "Idempotency-Key": randomUUID() });
    expect(busy.status).toBe(429); expect(Number(busy.headers.get("Retry-After"))).toBeGreaterThan(0);
    for (const path of ["/api/agent-profiles/generate", "/api/agent-profiles/creation-assistant", "/api/agent-profiles/visual-reference", "/api/agent-profiles"]) {
      expect((await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    }
  });

  test("a malformed signed cookie is replaced without leaking it or failing session initialization", async () => {
    const app = createAnonymousAgentCreationRoutes(db, async () => turn);
    const status = await app.request("/api/agent-profiles/anonymous", {
      headers: { Cookie: "house_preview=invalid%ZZ." + "!".repeat(43) + "=" },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ used: false });
    expect(status.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(status.headers.get("Set-Cookie")).not.toContain("invalid");
  });

  test("the real preview handler requests an eight-name enum and rejects a name outside it", async () => {
    const app = createAnonymousAgentCreationRoutes(db);
    const originalFetch = globalThis.fetch, originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "provider-free";
    let offeredNames: string[] = [];
    let returnOutsideName = false;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      const body = await request.json() as {
        response_format: { json_schema: { name: string; strict: boolean; schema: { properties: { profile: { anyOf: [{
          properties: { name: { anyOf: [{ properties: { value: { enum: string[] } } }] } };
        }] } } } } };
      };
      if (body.response_format.json_schema.name === "agent_naming_cues") {
        expect(body.response_format.json_schema.strict).toBe(true);
        return Response.json({ ...response, id: "preview-cues", choices: [{ index: 0, finish_reason: "stop", message: {
          role: "assistant", content: JSON.stringify({ cues: [{ country: "PL", quote: "Polish-speaking family" }] }),
        } }] });
      }
      const profileSchema = body.response_format.json_schema.schema.properties.profile.anyOf[0];
      offeredNames = profileSchema.properties.name.anyOf[0].properties.value.enum;
      const name = { source: "shortlist", value: returnOutsideName ? "First9 Last9" : offeredNames[0] };
      return Response.json({ ...response, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant",
        content: JSON.stringify({ ...turn, profile: { ...profile, name } }) } }] });
    }, { preconnect: originalFetch.preconnect });
    const preview = () => app.request("/api/agent-profiles/anonymous", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ message: "A quiet diplomat raised in a Polish-speaking family", creationTraitIds: [] }),
    });
    try {
      const valid = await preview();
      expect(valid.status).toBe(200);
      expect(offeredNames).toHaveLength(8);
      const polishPool = onomaverse.find(pool => pool.country === "PL")!;
      expect(offeredNames.filter(candidate => polishPool.givenNames.some(given =>
        candidate.startsWith(given + " ") && polishPool.surnames.includes(candidate.slice(given.length + 1)),
      )).length).toBeGreaterThanOrEqual(6);
      expect(await valid.json()).toMatchObject({ profile: { name: offeredNames[0] } });
      const [operation] = await loadPayloads(db.select().from(schema.anonymousTextOperations));
      expect(operation).toMatchObject({ state: "succeeded", promptTokens: 40, completionTokens: 20, providerRequestId: response.id });
      await reopenMinute();
      returnOutsideName = true;
      expect((await preview()).status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("the anonymous route returns controlled diagnostics for an observed upstream timeout", async () => {
    const app = new Hono().use("*", requestDiagnostics).route("/", createAnonymousAgentCreationRoutes(db, async () => {
      throw new APIConnectionTimeoutError({ message: "private provider detail" });
    }));
    const result = await app.request("/api/agent-profiles/anonymous", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ message: "A quiet diplomat", creationTraitIds: [] }),
    });
    expect(result.status).toBe(502);
    expect(result.headers.get(FAILURE_HEADER)).toBe("upstream_timeout");
    expect(uuid(result.headers.get(REQUEST_ID_HEADER))).toBeDefined();
    expect(await result.text()).not.toContain("private provider detail");
  });

  test("oversized requests and reference/refinement fields cannot enter the pool", async () => {
    const app = createAnonymousAgentCreationRoutes(db, async () => turn);
    for (const body of [{ message: "x".repeat(2001), creationTraitIds: [] }, { message: "hello", creationTraitIds: ["unknown"] },
      { message: "hello", creationTraitIds: [], fullBodyReferenceUrl: "https://example.test" }]) {
      expect((await app.request("/api/agent-profiles/anonymous", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(await loadPayloads(db.select().from(schema.anonymousTextOperations))).toHaveLength(0);
  });
});

describe("strict House preview output", () => {
  test("a game question can be answered without inventing a character", () => {
    expect(decodeAnonymousCreationTurn(JSON.stringify({ reply: "Empowerment is not immunity. Would you seek it?", profile: null }), naming).profile).toBeNull();
  });
  test.each(["not JSON", "{}", "```json\n{}\n```", 'Here is {"profile":null}', JSON.stringify({ reply: "", profile: null }),
    JSON.stringify({ reply: "Hi", profile: null, command: "generate_image" }), JSON.stringify({ reply: "Hi" }),
    JSON.stringify({ reply: "Hi", profile: {} }), JSON.stringify({ reply: "Hi", profile: { ...encodedProfile, gender: "unknown" } }),
    JSON.stringify({ reply: "Hi", profile: { ...encodedProfile, visualDesign: undefined } })])("rejects malformed preview: %s", content => {
    expect(() => decodeAnonymousCreationTurn(content, naming)).toThrow();
  });
});
