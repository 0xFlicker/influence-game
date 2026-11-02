import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { cutSource } from "@influence/engine/house-cuts/source";
import { newCutTrialJournal } from "@influence/engine/house-cuts/trial";
import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { readCutDiagnostics, recoverHouseCuts } from "../services/house-cut-recovery.js";
let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function fixture() {
  await db.insert(schema.users).values([{ id: "cuts-operator" }, { id: "cuts-reader" }]);
  await db.insert(schema.roles).values({ id: "cuts-admin", name: "admin" }).onConflictDoNothing();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
  await db.insert(schema.userRoles).values({ userId: "cuts-operator", roleId: role!.id });
  await db.insert(schema.games).values({ id: "cuts-recovery", slug: "cuts-recovery", gameKind: "influence", status: "completed", config: '{"visibility":"public"}' });
  const source = cutSource({ game: { id: "cuts-recovery", slug: "cuts-recovery", kind: "influence" }, audience: "public", cast: [{ id: "a", name: "A" }], evidence: [], limitations: [] });
  const journal = newCutTrialJournal(source, 1);
  const [job] = await loadPayloads(db.insert(schema.houseCutJobs).values(await storeFields({ gameId: source.game.id, audience: "public" as const, status: "failed" as const, failure: "old failure", source, journal }, { source: "json-gzip", journal: "json-gzip" })).returning());
  return { job: job!, input: { audience: "public" as const, expectedUpdatedAt: job!.updatedAt.toISOString(), idempotencyKey: "reviewed-recovery" } };
}
test("recovery is authorized, fenced, idempotent and retains the old journal", async () => {
  const { job, input } = await fixture();
  await expect(readCutDiagnostics(db, "cuts-recovery", "cuts-reader")).rejects.toThrow("operator");
  await expect(recoverHouseCuts(db, "cuts-recovery", input, "cuts-reader")).rejects.toThrow("operator");
  await expect(recoverHouseCuts(db, "cuts-recovery", { ...input, expectedUpdatedAt: "stale" }, "cuts-operator")).rejects.toThrow("changed");
  expect((await recoverHouseCuts(db, "cuts-recovery", input, "cuts-operator")).status).toBe("queued");
  expect((await recoverHouseCuts(db, "cuts-recovery", input, "cuts-operator")).status).toBe("queued");
  const [saved] = await loadPayloads(db.select().from(schema.houseCutJobs).where(eq(schema.houseCutJobs.id, job.id)));
  expect(saved!.journal!.recovery!.previous).toEqual(job.journal!);
  expect(saved!.journal!.recovery!.failure).toBe("old failure");
  expect(saved!.journal!.recovery!.requestedBy).toBe("cuts-operator");
  expect(saved!.journal!.attempts).toHaveLength(0);
  expect((await readCutDiagnostics(db, "cuts-recovery", "cuts-operator"))[0]!.status).toBe("queued");
});
test("published output is never replaced by recovery", async () => {
  const { job, input } = await fixture();
  await db.update(schema.houseCutJobs).set(await storeFields({ publication: { version: "kept", audience: "public", cuts: [] } }, { publication: "json-gzip" })).where(eq(schema.houseCutJobs.id, job.id));
  await expect(recoverHouseCuts(db, "cuts-recovery", input, "cuts-operator")).rejects.toThrow("changed");
});
test("recovery refuses unknown dispatches and spent budgets", async () => {
  const { job, input } = await fixture();
  const intent = { coordinate: { actor: { name: "House", role: "producer" as const }, action: "house_cut_discovery",
    semantic: { version: 1 as const, kind: "house_cut_discovery" as const, sourceHash: job.source!.hash, windowId: "window-1", editorialVersion: "old" } },
    attemptId: "attempt", attemptOrdinal: 1, startedAt: new Date().toISOString(),
    preparedRequest: { transport: "openai.responses", providerProfileId: "openai" as const, model: "gpt-6-luna", body: {} } };
  const journal = { ...job.journal!, attempts: [{ windowId: "window-1", intent, reservedUsd: 1 }] };
  await db.update(schema.houseCutJobs).set(await storeFields({ journal }, { journal: "json-gzip" })).where(eq(schema.houseCutJobs.id, job.id));
  await expect(recoverHouseCuts(db, "cuts-recovery", input, "cuts-operator")).rejects.toThrow("Unknown paid dispatch");
  const known = { ...journal, attempts: [{ ...journal.attempts[0]!, terminal: { ...intent, completedAt: new Date().toISOString(), latencyMs: 1,
    outcome: { kind: "malformed_output" as const, retryable: true, message: "bad" }, disposition: "exhausted" as const } }] };
  await db.update(schema.houseCutJobs).set(await storeFields({ journal: known }, { journal: "json-gzip" })).where(eq(schema.houseCutJobs.id, job.id));
  await expect(recoverHouseCuts(db, "cuts-recovery", input, "cuts-operator")).rejects.toThrow("budget exhausted");
});
test("HTTP diagnostics and recovery require current operator roles", async () => {
  await fixture();
  const { createGameResultsRoutes } = await import("../routes/game-results");
  const { createSessionToken } = await import("../middleware/auth");
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "cuts-recovery-test-secret";
  try {
    const app = createGameResultsRoutes(db);
    expect((await app.request("/api/games/cuts-recovery/cuts/diagnostics")).status).toBe(401);
    expect((await app.request("/api/games/cuts-recovery/cuts/backfill", { method: "POST" })).status).toBe(401);
    const token = await createSessionToken("cuts-reader", { roles: ["admin"] });
    expect((await app.request("/api/games/cuts-recovery/cuts/diagnostics", { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    expect((await app.request("/api/games/cuts-recovery/cuts/recover", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ audience: "public", expectedUpdatedAt: "stale", idempotencyKey: "unauthorized" }) })).status).toBe(403);
    expect((await app.request("/api/games/cuts-recovery/cuts/backfill", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ audience: "public" }) })).status).toBe(403);
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});

test("backfill exposes missing audiences and creates each job once without replacing existing work", async () => {
  const { backfillHouseCuts } = await import("../services/house-cut-recovery");
  const { job } = await fixture();
  await db.delete(schema.houseCutJobs).where(eq(schema.houseCutJobs.id, job.id));
  expect((await readCutDiagnostics(db, "cuts-recovery", "cuts-operator"))[0]).toMatchObject({ status: "missing", action: "backfill" });
  await expect(backfillHouseCuts(db, "cuts-recovery", { audience: "public" }, "cuts-reader")).rejects.toThrow("operator");
  await expect(backfillHouseCuts(db, "cuts-recovery", { audience: "mystery" }, "cuts-operator")).rejects.toThrow("Audience");
  await expect(backfillHouseCuts(db, "cuts-recovery", { audience: "public", extra: true }, "cuts-operator")).rejects.toThrow("valid audience");
  await expect(backfillHouseCuts(db, "cuts-recovery", { audience: ["public"] }, "cuts-operator")).rejects.toThrow("valid audience");
  const first = await backfillHouseCuts(db, "cuts-recovery", { audience: "public" }, "cuts-operator");
  expect(first.status).toBe("queued");
  expect(await backfillHouseCuts(db, "cuts-recovery", { audience: "public" }, "cuts-operator")).toEqual(first);
  await db.update(schema.houseCutJobs).set({ status: "ready" }).where(eq(schema.houseCutJobs.id, first.id));
  expect(await backfillHouseCuts(db, "cuts-recovery", { audience: "public" }, "cuts-operator")).toEqual({ ...first, status: "ready" });
});

test("backfill requires a completed visible game and keeps Werewolf audiences independent", async () => {
  const { backfillHouseCuts } = await import("../services/house-cut-recovery");
  await fixture();
  await db.insert(schema.games).values({ id: "cuts-wolf", slug: "cuts-wolf", gameKind: "werewolf", status: "completed", config: '{}' });
  expect((await readCutDiagnostics(db, "cuts-wolf", "cuts-operator")).map(row => row.audience)).toEqual(["mystery", "omniscient"]);
  await backfillHouseCuts(db, "cuts-wolf", { audience: "mystery" }, "cuts-operator");
  expect((await readCutDiagnostics(db, "cuts-wolf", "cuts-operator")).map(row => row.status)).toEqual(["queued", "missing"]);
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, "cuts-wolf"));
  await expect(backfillHouseCuts(db, "cuts-wolf", { audience: "omniscient" }, "cuts-operator")).rejects.toThrow("Completed game");
  await db.update(schema.games).set({ status: "completed", hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, "cuts-wolf"));
  await expect(backfillHouseCuts(db, "cuts-wolf", { audience: "omniscient" }, "cuts-operator")).rejects.toThrow("Completed game");
});
