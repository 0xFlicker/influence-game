import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  getLatestAgentRevision,
  resolveGameEffectiveAgentRevision,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "../services/agent-revisions.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  initialCompetitionRating,
} from "../services/season-policy.js";
import { setupTestDB } from "./test-utils.js";
import { backfillAgentRevisions } from "../scripts/backfill-agent-revisions.js";
import {
  AGENT_MUTATION_RECEIPT_SCHEMA_VERSION,
  boundAgentMutationWaitingSeatReferences,
} from "../services/agent-mutation-receipt.js";

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
      name: "Maris Thread",
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
      name: "Aster Thread",
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
      name: "Verity Thread",
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
    expect(changed.profileRevision).toMatchObject({
      revisionId: expect.any(String),
      ordinal: 2,
      outcome: "created",
      active: true,
      ratingRecalibrated: false,
    });
    expect(changed.profile).toMatchObject({ gamesPlayed: 8, gamesWon: 3 });

    const revisions = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));
    expect(revisions.map((revision) => revision.ordinal).sort()).toEqual([1, 2]);
    expect(revisions.find((revision) => revision.ordinal === 2)).toMatchObject({
      priorRevisionId: revisions.find((revision) => revision.ordinal === 1)?.id,
      trigger: "profile_edit",
    });
  });

  test("reverting owner behavior creates a chronological active revision", async () => {
    const { profile, profileRevision: initial } = await createOwnedAgentProfile(
      db,
      { userId: USER_ID },
      {
        name: "Echowood Thread",
        personality: "Patient and observant.",
        personaKey: "observer",
      },
    );

    const changed = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      personality: "Forceful and observant.",
    });
    const reverted = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      personality: "Patient and observant.",
    });

    expect(changed.profileRevision).toMatchObject({ ordinal: 2, outcome: "created", active: true });
    expect(reverted.profileRevision).toMatchObject({ ordinal: 3, outcome: "created", active: true });
    expect(reverted.profileRevision.revisionId).not.toBe(initial.revisionId);

    const revisions = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));
    const initialRevision = revisions.find((revision) => revision.id === initial.revisionId)!;
    const revertedRevision = revisions.find(
      (revision) => revision.id === reverted.profileRevision.revisionId,
    )!;
    expect(revertedRevision.fingerprint).toBe(initialRevision.fingerprint);
    expect(revertedRevision.priorRevisionId).toBe(changed.profileRevision.revisionId);
  });

  test("reuses game-effective revisions without moving the active pointer or rating", async () => {
    const { profile } = await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Lyris Thread",
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
    const result = await resolveGameEffectiveAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: {
        ...snapshot,
        model: "gpt-5-mini",
        catalogId: "openai:gpt-5-mini",
      },
    });
    expect(result.ratingRecalibrated).toBe(false);
    expect(result.revision.magnitude).toBe("execution");
    expect(result.revision.ordinal).toBe(2);

    const rating = (await db.select().from(schema.agentCompetitionRatings)
      .where(eq(schema.agentCompetitionRatings.agentProfileId, profile.id)))[0]!;
    expect(rating.mu).toBe(31);
    expect(rating.sigma).toBe(2);
    expect(rating.effectiveRevisionId).toBe(initialRevision.id);
    const events = await db.select().from(schema.competitionRatingEvents);
    expect(events).toHaveLength(0);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBe(initialRevision.id);

    const reused = await resolveGameEffectiveAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: {
        ...snapshot,
        model: "gpt-5-mini",
        catalogId: "openai:gpt-5-mini",
      },
    });
    expect(reused).toMatchObject({
      created: false,
      ratingRecalibrated: false,
      revision: { id: result.revision.id },
    });

    const secondRuntime = await resolveGameEffectiveAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: { ...snapshot, temperature: 0.2 },
    });
    expect(secondRuntime).toMatchObject({
      created: true,
      ratingRecalibrated: false,
      revision: { ordinal: 3, priorRevisionId: initialRevision.id },
    });
    expect(await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id))).toHaveLength(3);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBe(initialRevision.id);

    const activeEdit = await updateOwnedAgentProfile(db, { userId: USER_ID }, profile.id, {
      strategyStyle: "Exploit uncertainty quickly.",
    });
    expect(activeEdit.profileRevision).toMatchObject({
      ordinal: 4,
      outcome: "created",
      active: true,
      ratingRecalibrated: true,
    });
    const recalibratedRating = (await db.select().from(schema.agentCompetitionRatings)
      .where(eq(schema.agentCompetitionRatings.agentProfileId, profile.id)))[0]!;
    expect(recalibratedRating.mu).toBe(31);
    expect(recalibratedRating.sigma).toBeGreaterThan(2);
    expect(recalibratedRating.sigma).toBeLessThanOrEqual(initialRating.sigma);
    expect(recalibratedRating.effectiveRevisionId).toBe(activeEdit.profileRevision.revisionId);
    expect(await db.select().from(schema.competitionRatingEvents)).toHaveLength(1);

    const backfill = await backfillAgentRevisions(db);
    expect(backfill).toMatchObject({ revisionsCreated: 0, revisionsReused: 1 });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId)
      .toBe(activeEdit.profileRevision.revisionId);
    expect(await db.select().from(schema.competitionRatingEvents)).toHaveLength(1);
  });

  test("refuses to materialize a game-effective revision without an active profile revision", async () => {
    const profile = {
      id: randomUUID(),
      userId: USER_ID,
      name: "Unmigrated",
      personality: "Has no revision lineage yet.",
      backstory: null,
      strategyStyle: null,
      personaKey: null,
    };
    await db.insert(schema.agentProfiles).values(profile);

    await expect(resolveGameEffectiveAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile),
    })).rejects.toThrow(`Agent profile ${profile.id} has no active revision`);
    expect(await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id))).toHaveLength(0);
  });

  test("does not infer active behavior from revision chronology when the pointer is absent", async () => {
    const { profile, profileRevision } = await createOwnedAgentProfile(db, { userId: USER_ID }, {
      name: "Pointerless",
      personality: "Has retained history but no declared active behavior.",
    });
    await db.update(schema.agentProfiles).set({ currentRevisionId: null })
      .where(eq(schema.agentProfiles.id, profile.id));

    await expect(resolveGameEffectiveAgentRevision(db, {
      profile,
      effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile),
    })).rejects.toThrow(`Agent profile ${profile.id} has no active revision`);
    expect((await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id)))[0]?.id)
      .toBe(profileRevision.revisionId);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]?.currentRevisionId).toBeNull();
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

describe("agent mutation receipt primitives", () => {
  test("schema version and waiting-seat detail stay bounded", () => {
    expect(AGENT_MUTATION_RECEIPT_SCHEMA_VERSION).toBe(1);
    const bounded = boundAgentMutationWaitingSeatReferences(
      Array.from({ length: 12 }, (_, index) => ({
        gameId: `game-${index}`,
        slug: `game-${index}`,
        disposition: "reconciled" as const,
        effectiveRevisionId: `revision-${index}`,
      })),
    );
    expect(bounded.games).toHaveLength(10);
    expect(bounded.games.at(-1)?.gameId).toBe("game-9");
    expect(bounded.truncatedCount).toBe(2);
  });
});
