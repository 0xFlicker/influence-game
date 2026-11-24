import { beforeEach, expect, setSystemTime, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { gameModelPolicy } from "@influence/engine/game-model-routing";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { creationModelRouting, sealRosterModelRouting } from "./game-model-routing.js";
import { dailyFreeModelRouting } from "./daily-provider-manifest.js";
import { applyModelMigration, previewModelMigration } from "./model-lifecycle.js";
import { currentPublishedModelPreference, readModelLifecycle } from "./model-lifecycle-settings.js";
import { providerModelInventory } from "../routes/provider-models.js";

const owner = "lifecycle-owner";
const admin = "lifecycle-admin";
const source = { catalogId: "openai:gpt-6-luna", reasoningPolicy: "high" as const };
const replacement = { catalogId: "anthropic:claude-haiku-5-5", reasoningPolicy: "high" as const };
const change = { sourceCatalogId: source.catalogId, replacementCatalogId: replacement.catalogId, cutoffDate: "2026-12-01" };
let db: DrizzleDB;

beforeEach(async () => {
  db = await setupTestDB();
  await seedRBAC(db);
  await db.insert(schema.users).values([{ id: owner }, { id: admin }]);
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "admin"));
  await db.insert(schema.userRoles).values({ userId: admin, roleId: role!.id });
  await db.insert(schema.agentProfiles).values({ id: "lifecycle-agent", userId: owner, name: "Lifecycle Agent", personality: "Patient", modelPreference: source });
});

test("one approval updates the profiles, both waiting game kinds, and shared defaults while frozen routes stay byte-identical", async () => {
  const policy = gameModelPolicy({ providerManifest: [source, { ...replacement, maxCallsPerGame: 5 }] });
  const config = JSON.stringify({ modelRouting: policy, marker: "untouched" });
  const frozen = await db.transaction(tx => sealRosterModelRouting(tx, { modelRouting: policy }, [{ id: "frozen-seat", modelPreference: source }]));
  const frozenConfig = JSON.stringify(frozen);
  await db.insert(schema.games).values([
    { id: "open-influence", slug: "waiting-influence", config },
    { id: "open-werewolf", slug: "waiting-werewolf", gameKind: "werewolf", config },
    { id: "already-frozen", slug: "frozen-influence", status: "in_progress", config: frozenConfig },
    { id: "waiting-frozen", slug: "frozen-waiting-influence", status: "waiting", config: frozenConfig },
  ]);
  await db.insert(schema.gamePlayers).values([
    { id: "influence-seat", gameId: "open-influence", persona: "{}", agentConfig: "{}", agentProfileId: "lifecycle-agent", modelPreference: source },
    { id: "frozen-seat", gameId: "already-frozen", persona: "{}", agentConfig: "{}", agentProfileId: "lifecycle-agent", modelPreference: source },
    { id: "waiting-frozen-seat", gameId: "waiting-frozen", persona: "{}", agentConfig: "{}", agentProfileId: "lifecycle-agent", modelPreference: source },
  ]);
  await db.insert(schema.werewolfLobbySeats).values({ id: "wolf-seat", gameId: "open-werewolf", agentProfileId: "lifecycle-agent", modelPreference: source });
  process.env.JWT_SECRET = "model-lifecycle-test-only-secret";
  const app = new Hono().route("/", createAdminRoutes(db));
  const session = (id: string) => createSessionToken(id, { roles: ["admin"], permissions: ["view_admin"] });
  const token = await session(admin);
  const unprivilegedToken = await session(owner);
  const api = (path: string, body: unknown, value = token) => app.request(`/api/admin/model-lifecycle${path}`, {
    method: "POST", body: JSON.stringify(body), headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
  });
  expect((await api("/preview", change, unprivilegedToken)).status).toBe(403);
  const response = await api("/preview", change);
  expect(response.status).toBe(200);
  const preview = await response.json() as Awaited<ReturnType<typeof previewModelMigration>>;
  expect(preview.accountCount).toBe(1);
  expect(preview.profiles.map(profile => profile.after)).toEqual([replacement]);
  expect(preview.lobbies.map(lobby => lobby.id)).toEqual(["open-influence", "open-werewolf"]);
  expect(preview.lobbies[0]?.after.defaultManifest).toEqual([replacement]);
  expect(preview.defaults.changed).toBe(true);
  expect(preview.blocked).toEqual([]);

  const applied = await api("/apply", { ...change, previewId: preview.previewId });
  expect(applied.status).toBe(200);
  const receipt = await applied.json();
  expect(await (await api("/apply", { ...change, previewId: preview.previewId })).json()).toEqual(receipt);
  const [profile] = await db.select().from(schema.agentProfiles);
  expect(profile?.modelPreference).toEqual(replacement);
  for (const game of await db.select().from(schema.games)) {
    if (game.id.includes("frozen")) expect(game.config).toBe(frozenConfig);
    else expect(JSON.parse(game.config)).toMatchObject({ marker: "untouched", modelRouting: { defaultManifest: [replacement] } });
  }
  const influenceSeats = new Map((await db.select().from(schema.gamePlayers)).map(seat => [seat.id, seat.modelPreference]));
  expect(influenceSeats.get("influence-seat")).toEqual(replacement);
  expect(influenceSeats.get("frozen-seat")).toEqual(source);
  expect(influenceSeats.get("waiting-frozen-seat")).toEqual(source);
  expect((await db.select().from(schema.werewolfLobbySeats))[0]?.modelPreference).toEqual(replacement);
  const defaults = await creationModelRouting(db, owner, {});
  expect(defaults.defaultManifest.map(entry => entry.catalogId)).toEqual([replacement.catalogId, "xai:grok-4.3"]);
  expect(await dailyFreeModelRouting(db)).toEqual(defaults);
  expect(await currentPublishedModelPreference(db, replacement, source, "2026-11-01T00:00:00Z")).toEqual(replacement);
});

test("preview rejects inaccessible replacements and stale approvals, then enforces the House's earlier cutoff", async () => {
  const blockedChange = { ...change, replacementCatalogId: "openai:gpt-6.2-sol" };
  const blocked = await previewModelMigration(db, admin, blockedChange);
  expect(blocked.blocked).toEqual(["1 affected account(s) cannot select this replacement. Choose an eligible model."]);
  await expect(applyModelMigration(db, admin, blockedChange, blocked.previewId)).rejects.toThrow("Resolve");
  const preview = await previewModelMigration(db, admin, change);
  await db.update(schema.agentProfiles).set({ modelPreference: "default" }).where(eq(schema.agentProfiles.id, "lifecycle-agent"));
  await expect(applyModelMigration(db, admin, change, preview.previewId)).rejects.toThrow("changed");
  expect((await readModelLifecycle(db)).cutoffs).toEqual({});

  const earlier = { sourceCatalogId: "openai:gpt-5-nano", replacementCatalogId: "openai:gpt-6-luna", cutoffDate: "2026-12-01" };
  try {
    setSystemTime(new Date("2026-11-24T12:00:00Z"));
    const upcoming = await previewModelMigration(db, admin, earlier);
    expect(upcoming.providerRetirementDate).toBe("2026-12-11");
    await applyModelMigration(db, admin, earlier, upcoming.previewId);
    const explicit = { providerManifest: [{ catalogId: earlier.sourceCatalogId }] };
    expect((await creationModelRouting(db, admin, explicit)).defaultManifest[0]?.catalogId).toBe(earlier.sourceCatalogId);
    const inventory = await providerModelInventory({}, false, undefined, db);
    expect(inventory.cutoffs[earlier.sourceCatalogId]).toEqual({ cutoffDate: earlier.cutoffDate, replacementCatalogId: earlier.replacementCatalogId });
    setSystemTime(new Date("2026-12-01T00:00:00Z"));
    await expect(creationModelRouting(db, admin, explicit)).rejects.toThrow("The House stopped accepting");
    await expect(db.transaction(tx => sealRosterModelRouting(tx, explicit, []))).rejects.toThrow("The House stopped accepting");
  } finally {
    setSystemTime();
  }
});
