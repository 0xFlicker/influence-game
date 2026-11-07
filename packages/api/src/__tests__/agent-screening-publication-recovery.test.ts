import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { setupTestDB, acceptTestAgent } from "./test-utils.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import { reconcileScreenedAgents } from "../services/agent-screening-publication.js";
import { readAgentScreening } from "../services/agent-screening-read.js";

test("one blocked publication cannot starve other publications", async () => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "publication-owner" });
  const blocked = await createOwnedAgentProfile(
    db,
    { userId: "publication-owner" },
    { name: "Blocked", personality: "Patient" },
  );
  await acceptTestAgent(db, blocked.profile.id);
  const baseline = blocked.receipt.contentRevisionId;
  const pending = await updateOwnedAgentProfile(
    db,
    { userId: "publication-owner" },
    blocked.profile.id,
    { name: "Updated Blocked" },
  );
  const healthy = await createOwnedAgentProfile(
    db,
    { userId: "publication-owner" },
    { name: "Healthy", personality: "Bold" },
  );
  await db.insert(schema.users).values({ id: "foreign-seat-owner" });
  await db
    .insert(schema.games)
    .values({
      id: "broken-roster",
      slug: "broken-roster",
      config: JSON.stringify({ maxPlayers: 4 }),
      status: "waiting",
      minPlayers: 4,
      maxPlayers: 4,
    });
  await db
    .insert(schema.gamePlayers)
    .values({
      id: "broken-follower",
      gameId: "broken-roster",
      userId: "foreign-seat-owner",
      agentProfileId: blocked.profile.id,
      persona: JSON.stringify({ name: "Blocked" }),
      agentConfig: JSON.stringify({ model: "test" }),
    });
  await db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" });
  await reconcileScreenedAgents(db);
  const profiles = await db.select().from(schema.agentProfiles);
  expect(
    profiles.find((row) => row.id === blocked.profile.id)?.contentRevisionId,
  ).toBe(baseline);
  expect(
    profiles.find((row) => row.id === healthy.profile.id)?.contentRevisionId,
  ).toBe(healthy.receipt.contentRevisionId!);
  const screenings = await db.select().from(schema.agentScreenings);
  expect(
    screenings.find(
      (row) => row.contentRevisionId === pending.receipt.contentRevisionId,
    )?.failureCode,
  ).toBe("publication_roster_conflict");
});

test("historical screening stays readable and cannot grant current-policy publication", async () => {
  const db = await setupTestDB();
  await db.insert(schema.users).values({ id: "historical-owner" });
  const created = await createOwnedAgentProfile(
    db,
    { userId: "historical-owner" },
    { name: "Historical", personality: "Patient" },
  );
  await db.update(schema.agentScreenings).set({
    policyVersion: "house-agent-shadow-v1",
    status: "completed",
    recommendation: "no_concern",
  });
  const read = await readAgentScreening(db, created.receipt.contentRevisionId!);
  expect(read?.mode).toBe("historical");
  expect(read?.policyVersion).toBe("house-agent-shadow-v1");
  await reconcileScreenedAgents(db);
  expect(
    (await db.select().from(schema.agentProfiles))[0]!.contentRevisionId,
  ).toBeNull();
});

test("automatic publication waits for a human claim and clears only expired leases", async () => {
  const db = await setupTestDB();
  await db
    .insert(schema.users)
    .values([{ id: "claimed-owner" }, { id: "claim-reviewer" }]);
  const created = await createOwnedAgentProfile(
    db,
    { userId: "claimed-owner" },
    { name: "Claimed Publication", personality: "Patient" },
  );
  await db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" });
  await db.insert(schema.moderationClaims).values({
    reviewerId: "claim-reviewer",
    reviewId: created.receipt.moderationRecordId!,
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await reconcileScreenedAgents(db);
  expect(
    (await db.select().from(schema.agentProfiles))[0]!.contentRevisionId,
  ).toBeNull();
  expect(await db.select().from(schema.moderationClaims)).toHaveLength(1);
  await db
    .update(schema.moderationClaims)
    .set({
      acquiredAt: new Date(0).toISOString(),
      expiresAt: new Date(1).toISOString(),
    });
  await reconcileScreenedAgents(db);
  expect(
    (await db.select().from(schema.agentProfiles))[0]!.contentRevisionId,
  ).toBe(created.receipt.contentRevisionId!);
  expect(await db.select().from(schema.moderationClaims)).toHaveLength(0);
});
