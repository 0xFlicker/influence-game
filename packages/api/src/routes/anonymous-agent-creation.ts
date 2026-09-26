import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { schema, type DrizzleDB } from "../db/index.js";
import { isAgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import { resolveAgentCreationLlm } from "../lib/openai-budget-generation-llm.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { generateAnonymousCreationTurn, type AnonymousCreationInput } from "../services/anonymous-agent-creation.js";
import { AnonymousPoolBusyError, readAnonymousAllowance, runAnonymousText } from "../services/anonymous-text-usage.js";
import { GenerationAdmissionError } from "../services/generation-admission-error.js";
import { allocateGeneratedAgentName, updateGeneratedProfileNameReferences } from "../services/generated-agent-names.js";
import { sha256StableJson } from "../services/stable-hash.js";

const COOKIE = "house_preview";
async function visitorHash(c: Context) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set");
  const cookie = await getSignedCookie(c, secret, COOKIE);
  const identity = cookie || randomUUID();
  if (!cookie) await setSignedCookie(c, COOKIE, identity, secret, {
    httpOnly: true, secure: process.env.NODE_ENV === "production" || new URL(c.req.url).protocol === "https:", sameSite: "Lax",
    path: "/api/agent-profiles/anonymous", maxAge: 60 * 60 * 24 * 365,
  });
  return sha256StableJson(identity);
}

export function createAnonymousAgentCreationRoutes(db: DrizzleDB, generate = generateAnonymousCreationTurn) {
  const app = new Hono();
  app.use("/api/agent-profiles/anonymous", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof GenerationAdmissionError) {
      if (error instanceof AnonymousPoolBusyError) c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json({ error: error.message, code: error.code,
        ...(error instanceof AnonymousPoolBusyError ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, error.status);
    }
    console.error("[anonymous-creation] Preview failed", error);
    return c.json({ error: "The House couldn't finish this preview. Your text is still here. Try again later." }, 502);
  });
  app.get("/api/agent-profiles/anonymous", async c => c.json(await readAnonymousAllowance(db, await visitorHash(c))));
  app.post("/api/agent-profiles/anonymous", async c => {
    const body = await parseJsonBody(c, "POST /api/agent-profiles/anonymous");
    if (!body || Object.keys(body).length !== 2 || typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000
      || !Array.isArray(body.creationTraitIds) || body.creationTraitIds.length > 12 || body.creationTraitIds.some((id: unknown) => !isAgentCreationTraitId(id))
      || new Set(body.creationTraitIds).size !== body.creationTraitIds.length) {
      return c.json({ error: "Describe a character or ask the House a question, with up to 12 valid ingredients." }, 400);
    }
    const requestKey = c.req.header("Idempotency-Key");
    if (!requestKey) return c.json({ error: "A request ID is required.", code: "invalid_request_id" }, 400);
    const config = resolveAgentCreationLlm();
    // Check before consuming the anonymous allowance or global capacity.
    if (generate === generateAnonymousCreationTurn && !config) {
      throw new GenerationAdmissionError("generation_unavailable", "The House preview is unavailable. Try again later.", 503);
    }
    return c.json(await runAnonymousText(db, { visitorHash: await visitorHash(c), requestKey,
      model: config?.modelId ?? "test", payload: body }, async record => {
      const turn = await generate(body as unknown as AnonymousCreationInput, c.req.raw.signal, record);
      if (turn.profile) {
        const names = await db.select({ name: schema.agentProfiles.name }).from(schema.agentProfiles);
        const allocated = allocateGeneratedAgentName(turn.profile.name, new Set(names.map(row => row.name)));
        turn.profile = updateGeneratedProfileNameReferences(turn.profile, allocated.name);
      }
      return turn;
    }));
  });
  return app;
}
