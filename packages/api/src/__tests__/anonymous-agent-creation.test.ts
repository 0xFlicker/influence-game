import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { runAnonymousText, readAnonymousAllowance } from "../services/anonymous-text-usage.js";
import { decodeAnonymousCreationTurn, type AnonymousCreationTurn } from "../services/anonymous-agent-creation.js";
import { createAnonymousAgentCreationRoutes } from "../routes/anonymous-agent-creation.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";

const profile = { name: "Mira Vale", gender: "female", personaKey: "diplomat", backstory: "A former envoy.",
  personality: "Patient, warm, and suspicious of easy promises.", strategyStyle: "Build trust, at the risk of waiting too long.",
  performanceInstructions: "Quiet gestures.", visualDesign: "A blue coat.", introQuips: ["Trust takes time.", "I keep receipts.", "We can talk."] };
const turn = decodeAnonymousCreationTurn(JSON.stringify({ reply: "Mira builds trust, but may hesitate to act. Does she feel right?", profile }));
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
    const results = await Promise.allSettled(visitors.map(value => runAnonymousText(db, value, async record => {
      calls++; await record(response); return turn;
    })));
    expect(calls).toBe(1);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex(result => result.status === "rejected");
    const denied = results[loser];
    expect(denied?.status === "rejected" && denied.reason).toMatchObject({ code: "anonymous_pool_busy", status: 429 });
    expect(await readAnonymousAllowance(db, visitors[loser]!.visitorHash)).toEqual({ used: false });
    await reopenMinute();
    await runAnonymousText(db, visitors[loser]!, async () => turn);
    expect(await db.select().from(schema.anonymousTextOperations)).toHaveLength(2);
  });

  test("response-loss replay is free; a second request requires signup even after the minute", async () => {
    const value = input(); let calls = 0;
    const run = async (record: (response: ChatCompletion) => Promise<void>) => { calls++; await record(response); return turn; };
    expect(await runAnonymousText(db, value, run)).toEqual(turn);
    expect(await runAnonymousText(db, value, run)).toEqual(turn);
    expect(calls).toBe(1);
    await expect(runAnonymousText(db, { ...value, payload: { idea: "changed" } }, run)).rejects.toMatchObject({ code: "request_conflict" });
    await reopenMinute();
    await expect(runAnonymousText(db, { ...value, requestKey: randomUUID() }, run)).rejects.toMatchObject({ code: "anonymous_signup_required", status: 403 });
    const [operation] = await db.select().from(schema.anonymousTextOperations);
    expect(operation).toMatchObject({ state: "succeeded", promptTokens: 20, completionTokens: 10, providerRequestId: response.id });
    expect(operation!.estimatedCostMicrousd).not.toBeNull();
  });

  test("malformed output is not accepted, retains cost evidence, and can be retried after the minute", async () => {
    const value = input();
    await expect(runAnonymousText(db, value, async record => {
      await record(response); return decodeAnonymousCreationTurn("{}");
    })).rejects.toThrow("Invalid House preview fields");
    expect(await readAnonymousAllowance(db, value.visitorHash)).toEqual({ used: false });
    const [operation] = await db.select().from(schema.anonymousTextOperations);
    expect(operation).toMatchObject({ state: "failed", result: null, promptTokens: 20 });
    await reopenMinute();
    expect(await runAnonymousText(db, { ...value, requestKey: randomUUID() }, async () => turn)).toEqual(turn);
  });

  test("unknown transport outcome reserves the visitor's message and cannot dispatch again", async () => {
    const value = input();
    await expect(runAnonymousText(db, value, async () => { throw new Error("connection lost"); })).rejects.toThrow("connection lost");
    expect(await readAnonymousAllowance(db, value.visitorHash)).toEqual({ used: true });
    await reopenMinute();
    await expect(runAnonymousText(db, { ...value, requestKey: randomUUID() }, async () => turn)).rejects.toMatchObject({ code: "anonymous_signup_required" });
    expect((await db.select().from(schema.anonymousTextOperations))[0]!.state).toBe("uncertain");
  });

  test("public session, cookie replay and admission errors work without a user row; private writes remain gated", async () => {
    let calls = 0;
    const app = new Hono().route("/", createAnonymousAgentCreationRoutes(db, async (_body, _signal, record) => {
      calls++; await record(response); return structuredClone(turn) as AnonymousCreationTurn;
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

  test("oversized requests and reference/refinement fields cannot enter the pool", async () => {
    const app = createAnonymousAgentCreationRoutes(db, async () => turn);
    for (const body of [{ message: "x".repeat(2001), creationTraitIds: [] }, { message: "hello", creationTraitIds: ["unknown"] },
      { message: "hello", creationTraitIds: [], fullBodyReferenceUrl: "https://example.test" }]) {
      expect((await app.request("/api/agent-profiles/anonymous", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(await db.select().from(schema.anonymousTextOperations)).toHaveLength(0);
  });
});

describe("strict House preview output", () => {
  test("a game question can be answered without inventing a character", () => {
    expect(decodeAnonymousCreationTurn(JSON.stringify({ reply: "Empowerment is not immunity. Would you seek it?", profile: null })).profile).toBeNull();
  });
  test.each(["not JSON", "{}", "```json\n{}\n```", 'Here is {"profile":null}', JSON.stringify({ reply: "", profile: null }),
    JSON.stringify({ reply: "Hi", profile: null, command: "generate_image" }), JSON.stringify({ reply: "Hi" }),
    JSON.stringify({ reply: "Hi", profile: {} }), JSON.stringify({ reply: "Hi", profile: { ...profile, gender: "unknown" } }),
    JSON.stringify({ reply: "Hi", profile: { ...profile, visualDesign: undefined } })])("rejects malformed preview: %s", content => {
    expect(() => decodeAnonymousCreationTurn(content)).toThrow();
  });
});
