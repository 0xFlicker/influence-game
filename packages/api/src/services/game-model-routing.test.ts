import { beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { FREE_MODEL_CATALOG_IDS, actorProviderManifest, gameModelPolicy } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import { creationModelRouting, readGameModelRouting, saveModelPreference, sealRosterModelRouting } from "./game-model-routing.js";
import { createSessionToken } from "../middleware/auth.js";
import { createProviderModelRoutes } from "../routes/provider-models.js";
import { createWerewolfGame } from "./werewolf-games.js";

let db: DrizzleDB;
beforeEach(async () => {
  db = await setupTestDB(); await seedRBAC(db);
  await db.insert(schema.users).values([{ id: "owner" }, { id: "admin" }]);
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
  await db.insert(schema.userRoles).values({ userId: "admin", roleId: role!.id });
  await db.insert(schema.agentProfiles).values({ id: "character", userId: "owner", name: "Model Character", personality: "Careful and curious" });
});

test("profile ownership and current role, not token claims, govern model choices", async () => {
  for (const catalogId of FREE_MODEL_CATALOG_IDS) await saveModelPreference(db, "owner", "character", { catalogId });
  await saveModelPreference(db, "owner", "character", "default");
  await expect(saveModelPreference(db, "owner", "character", { catalogId: "openai:premium" })).rejects.toThrow("admins");
  await expect(saveModelPreference(db, "admin", "character", { catalogId: "openai:premium" })).rejects.toThrow("own");
  await expect(creationModelRouting(db, "owner", { providerManifest: [{ catalogId: "openai:gpt-6-luna" }] })).rejects.toThrow("admin");
  expect((await creationModelRouting(db, "owner", {})).defaultManifest[0]!.catalogId).toBe("openai:gpt-6-luna");
});

test("enrollment preference stays fixed after edits and an explicit admin Default override wins", async () => {
  const policy = gameModelPolicy({});
  await saveModelPreference(db, "owner", "character", { catalogId: "katana:deepseek-v4-flash" });
  const seat = { id: "seat", agentProfileId: "character", modelPreference: { catalogId: "katana:glm-5-3-flash-private" } };
  const config = await db.transaction(tx => sealRosterModelRouting(tx, { modelRouting: policy }, [seat]));
  expect(actorProviderManifest(config, { id: "seat", role: "player" })[0]!.catalogId).toBe("katana:glm-5-3-flash-private");
  policy.overrides.seat = "default";
  const overridden = await db.transaction(tx => sealRosterModelRouting(tx, { modelRouting: policy }, [seat]));
  expect(actorProviderManifest(overridden, { id: "seat", role: "player" })[0]!.catalogId).toBe("openai:gpt-6-luna");
});

test("start rejects revoked premium entitlement but permits an admin override without granting owner access", async () => {
  const seat = { id: "seat", agentProfileId: "character", modelPreference: { catalogId: "openai:premium" } };
  await expect(db.transaction(tx => sealRosterModelRouting(tx, {}, [seat]))).rejects.toThrow("admins");
  const policy = gameModelPolicy({}); policy.overrides.seat = seat.modelPreference;
  const config = await db.transaction(tx => sealRosterModelRouting(tx, { modelRouting: policy }, [seat]));
  expect(actorProviderManifest(config, { id: "seat", role: "player" })[0]!.catalogId).toBe("openai:premium");
});

test("cast writes are rejected after atomic start and clients cannot forge frozen assignments", async () => {
  await db.insert(schema.games).values({ id: "game", slug: "model-routing-game", config: JSON.stringify({}), status: "waiting", minPlayers: 6, maxPlayers: 6 });
  const policy = gameModelPolicy({});
  await expect(readGameModelRouting(db, "owner", "game", policy)).rejects.toThrow("admin");
  await expect(readGameModelRouting(db, "admin", "game", { ...policy, contestants: {} })).rejects.toThrow("sealed");
  await expect(readGameModelRouting(db, "admin", "game", { ...policy, frozenRoutes: {} })).rejects.toThrow("sealed");
  await readGameModelRouting(db, "admin", "game", policy);
  await db.transaction(async tx => {
    await tx.select().from(schema.games).where(eq(schema.games.id, "game")).for("update");
    const config = await sealRosterModelRouting(tx, { modelRouting: policy }, []);
    await tx.update(schema.games).set({ status: "in_progress", config: JSON.stringify(config) }).where(eq(schema.games.id, "game"));
  });
  await expect(readGameModelRouting(db, "admin", "game", policy)).rejects.toThrow("frozen");
});

test("HTTP preference writes enforce ownership and current entitlement despite forged token roles", async () => {
  process.env.JWT_SECRET = "model-routing-fixture-secret";
  const app = new Hono().route("/", createProviderModelRoutes(db));
  const token = await createSessionToken("owner", { roles: ["sysop"], permissions: [] });
  const patch = (id: string, preference: unknown) => app.request(`/api/agent-profiles/${id}/model-preference`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ modelPreference: preference }),
  });
  expect((await patch("character", { catalogId: "openai:premium" })).status).toBe(403);
  expect((await patch("someone-elses-character", "default")).status).toBe(403);
  for (const catalogId of FREE_MODEL_CATALOG_IDS) expect((await patch("character", { catalogId })).status).toBe(200);
  expect((await patch("character", "default")).status).toBe(200);
  expect((await patch("character", { catalogId: "unknown-provider:model" })).status).toBe(400);
  expect((await app.request("/api/model-routing/games/any", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(gameModelPolicy({})) })).status).toBe(403);
});

test("immediately started Werewolf games retain readable frozen cast assignments", async () => {
  const game = await createWerewolfGame(db, "admin", { preset: "two_wolves", agentProfileIds: [] });
  const result = await readGameModelRouting(db, "admin", game.id);
  expect(result.frozen).toBeTrue();
  expect(result.seats).toHaveLength(8);
  expect(result.seats.every(seat => seat.preference === "default" && seat.manifest[0]?.catalogId === "openai:gpt-6-luna")).toBeTrue();
});
