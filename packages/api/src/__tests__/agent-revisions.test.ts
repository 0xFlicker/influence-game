import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  ensureAgentRevision,
  getLatestAgentRevision,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "../services/agent-revisions.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  initialCompetitionRating,
} from "../services/season-policy.js";
import { setupTestDB } from "./test-utils.js";
import { backfillAgentRevisions } from "../scripts/backfill-agent-revisions.js";

const USER_ID = "revision-test-user";

describe("agent revision persistence", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0xrevisiontest",
    });
  });

  test("creates one complete initial revision with a new profile", async () => {
    const { profile, revisionCreated } = await createOwnedAgentProfile(db, {
      userId: USER_ID,
    }, {
      name: "Mira",
      personality: "Calm, observant, and deliberate.",
      backstory: "A retired negotiator.",
      strategyStyle: "Build trust before acting.",
      personaKey: "strategic",
    });

    expect(revisionCreated).toBe(true);
    const revision = await getLatestAgentRevision(db, profile.id);
    expect(revision).toMatchObject({
      ordinal: 1,
      priorRevisionId: null,
      trigger: "profile_create",
      magnitude: "initial",
    });
    expect(revision?.effectiveRuntimeSnapshot).toMatchObject({
      backstory: "A retired negotiator.",
      strategyInstructions: "Build trust before acting.",
      model: "gpt-5-nano",
      providerProfileId: "openai",
      reasoningPolicy: "action-policy",
    });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBe(revision?.id);
  });

  test("keeps avatar-only and identical saves in the current revision", async () => {
    const { profile } = await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Atlas",
      personality: "Patient and exact.",
      personaKey: "observer",
    });

    const avatar = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      avatarUrl: "https://cdn.example.test/atlas.png",
    });
    const identical = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      personality: "Patient and exact.",
    });
    expect(avatar.revisionCreated).toBe(false);
    expect(identical.revisionCreated).toBe(false);
    const revisions = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));
    expect(revisions).toHaveLength(1);
  });

  test("creates ordered revisions while preserving lifetime statistics", async () => {
    const { profile } = await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Vera",
      personality: "Bold but socially precise in every exchange.",
      personaKey: "provocateur",
    });
    await db.update(schema.agentProfiles)
      .set({ gamesPlayed: 8, gamesWon: 3 })
      .where(eq(schema.agentProfiles.id, profile.id));

    const changed = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      personality: "Bold and socially precise in every exchange.",
    });
    expect(changed.revisionCreated).toBe(true);
    expect(changed.profile).toMatchObject({ gamesPlayed: 8, gamesWon: 3 });

    const revisions = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));
    expect(revisions.map((revision) => revision.ordinal).sort()).toEqual([1, 2]);
    expect(revisions.find((revision) => revision.ordinal === 2)).toMatchObject({
      priorRevisionId: revisions.find((revision) => revision.ordinal === 1)?.id,
      trigger: "profile_edit",
    });
  });

  test("inherits mu and meters hidden uncertainty for execution revisions", async () => {
    const { profile } = await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Lyra",
      personality: "Finds vulnerabilities in people and systems.",
      personaKey: "observer",
    });
    const initialRevision = (await getLatestAgentRevision(db, profile.id))!;
    const initialRating = initialCompetitionRating();
    await db.insert(schema.agentCompetitionRatings).values({
      agentProfileId: profile.id,
      effectiveRevisionId: initialRevision.id,
      mu: 31,
      sigma: 2,
      gamesPlayed: 6,
      ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    });

    const snapshot = resolveFreeTrackEffectiveRuntimeSnapshot(profile);
    const result = await ensureAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: {
        ...snapshot,
        model: "gpt-5-mini",
        catalogId: "openai:gpt-5-mini",
      },
      trigger: "runtime_policy_change",
    });
    expect(result.ratingRecalibrated).toBe(true);
    expect(result.revision.magnitude).toBe("execution");

    const rating = (await db.select().from(schema.agentCompetitionRatings)
      .where(eq(schema.agentCompetitionRatings.agentProfileId, profile.id)))[0]!;
    expect(rating.mu).toBe(31);
    expect(rating.sigma).toBeGreaterThan(2);
    expect(rating.sigma).toBeLessThanOrEqual(initialRating.sigma);
    const events = await db.select().from(schema.competitionRatingEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentProfileId: profile.id,
      agentRevisionId: result.revision.id,
      eventType: "revision_recalibration",
      beforeMu: 31,
      afterMu: 31,
      evidence: {
        classification: {
          previousRevisionId: initialRevision.id,
          nextRevisionId: result.revision.id,
          magnitude: "execution",
        },
      },
    });

    const reverted = await ensureAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: snapshot,
      trigger: "runtime_policy_change",
    });
    expect(reverted).toMatchObject({ created: true, ratingRecalibrated: true });
    expect(reverted.revision).toMatchObject({
      ordinal: 3,
      priorRevisionId: result.revision.id,
      fingerprint: initialRevision.fingerprint,
    });
    expect(await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id))).toHaveLength(3);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBe(reverted.revision.id);

    const eventsBeforeBackfill = await db.select().from(schema.competitionRatingEvents);
    const backfill = await backfillAgentRevisions(db);
    expect(backfill).toMatchObject({ revisionsCreated: 0, revisionsReused: 1 });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBe(reverted.revision.id);
    expect(await db.select().from(schema.competitionRatingEvents)).toHaveLength(eventsBeforeBackfill.length);
  });

  test("recomputes recoverable counters without inventing missing history", async () => {
    const preserved = (await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Archive",
      personality: "Carries history that predates the retained game rows.",
    })).profile;
    const recovered = (await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Recovered",
      personality: "Has a retained completed game.",
    })).profile;
    await db.update(schema.agentProfiles).set({ gamesPlayed: 8, gamesWon: 3 })
      .where(eq(schema.agentProfiles.id, preserved.id));
    const gameId = randomUUID();
    const seatId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `backfill-${gameId}`,
      config: "{}",
      status: "completed",
      minPlayers: 2,
      maxPlayers: 4,
    });
    await db.insert(schema.gamePlayers).values({
      id: seatId,
      gameId,
      userId: USER_ID,
      agentProfileId: recovered.id,
      persona: JSON.stringify({ name: recovered.name, personality: recovered.personality }),
      agentConfig: "{}",
    });
    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: seatId,
      roundsPlayed: 1,
      tokenUsage: "{}",
    });

    const result = await backfillAgentRevisions(db);
    const profiles = await db.select().from(schema.agentProfiles);
    expect(result).toMatchObject({ profilesScanned: 2, revisionsCreated: 0, revisionsReused: 2 });
    expect(profiles.find((profile) => profile.id === preserved.id)).toMatchObject({ gamesPlayed: 0, gamesWon: 0 });
    expect(profiles.find((profile) => profile.id === recovered.id)).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
    });
  });
});
