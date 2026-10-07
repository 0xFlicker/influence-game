import { insertPlayedOwnerLearningAgent } from "./owner-learning-test-utils.js";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { playedWerewolfReview } from "./owner-learning-werewolf-test-utils.js";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { getOwnerLearningEligibleInputs, validateOwnerLearningSelection } from "../services/owner-learning-eligibility.js";
import { projectOwnerLearningEvidence, OWNER_LEARNING_INPUT_TOKEN_LIMIT } from "../services/owner-learning-evidence.js";
import { runOwnerLearningHarness, OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA } from "../services/owner-learning-harness.js";
import { buildBudgetedOwnerLearningProviderInput } from "../services/owner-learning-provider-context.js";
import { startOwnerLearningReview, OWNER_LEARNING_MODEL } from "../services/owner-learning-review.js";
import { getOwnedOwnerLearningReview } from "../services/owner-learning-read.js";
import { claimOwnerLearningReview, runClaimedOwnerLearningReview } from "../services/owner-learning-worker.js";
import { applyOwnedOwnerLearningReview } from "../services/owner-learning-apply.js";
import { fingerprintOwnerLearningValue } from "../services/owner-learning-contracts.js";

const noChange = { provisionalThemes: [], selectedMomentHandles: [], findings: [], finalResult: {
  diagnosis: "Available evidence does not establish a strategic defect. Faction outcome alone cannot grade a decision.", analysisTrack: "evidence_rich", strategyHealthClassification: null,
  recommendations: [], proposal: null, noChange: { rationale: "Gather more evidence before changing this strategy." },
} };

describe("Werewolf House owner learning", () => {
  test("shares credits and keeps actor-time knowledge separate from other owned characters", async () => {
    const db = await setupTestDB(); const f = await playedWerewolfReview(db);
    const eligible = await getOwnerLearningEligibleInputs(db, { ownerUserId: f.ownerUserId });
    expect(eligible.profiles).toHaveLength(8);
    expect(eligible.credit).toMatchObject({ balance: 1, qualifyingCompletionCount: 1 });
    const influence = await insertPlayedOwnerLearningAgent(db, { ownerUserId: f.ownerUserId });
    await expect(validateOwnerLearningSelection(db, { ownerUserId: f.ownerUserId, agentProfileId: f.villager.agentProfileId!, gameIds: [f.game.id, influence.gameId] })).rejects.toMatchObject({ code: "selection_unavailable" });
    await expect(validateOwnerLearningSelection(db, { ownerUserId: "stranger", agentProfileId: f.villager.agentProfileId!, gameIds: [f.game.id] })).rejects.toMatchObject({ code: "profile_unavailable" });
    const selection = await validateOwnerLearningSelection(db, { ownerUserId: f.ownerUserId, agentProfileId: f.villager.agentProfileId!, gameIds: [f.game.id] });
    const evidence = await projectOwnerLearningEvidence(db, selection, { instructions: "Test" });
    const facts = evidence.games[0]!.canonicalFacts;
    if (!("werewolf" in facts)) throw new Error("Wrong evidence kind");
    expect(evidence.analysisTrack).toBe("evidence_rich");
    expect(facts.werewolf.decisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(facts)).not.toContain("PRIVATE_PACK");
    for (const turn of facts.werewolf.decisions) {
      expect(turn.knownAtDecision.packIds).toEqual([]);
      expect(turn.knownAtDecision.investigations).toEqual([]);
      expect(turn.knownAtDecision.board.players.every(player => player.role === undefined)).toBe(true);
    }
    const wolf = await projectOwnerLearningEvidence(db, await validateOwnerLearningSelection(db, { ownerUserId: f.ownerUserId, agentProfileId: f.wolves[0]!.agentProfileId!, gameIds: [f.game.id] }), { instructions: "Test" });
    expect(JSON.stringify(wolf)).toContain("PRIVATE_PACK");
    expect(JSON.stringify(wolf)).not.toContain(`OWN_THINKING_${f.wolves[1]!.id}`);
    expect(facts.werewolf.publicOutcomes.some(entry => entry.kind === "night")).toBe(true);
    expect(facts.werewolf.publicOutcomes.some(entry => entry.kind === "vote")).toBe(true);
    for (const p of f.profiles) {
      if (p.id === f.villager.agentProfileId || f.wolves.some(w => w.agentProfileId === p.id)) continue;
      const roleEvidence = await projectOwnerLearningEvidence(db, await validateOwnerLearningSelection(db, { ownerUserId: f.ownerUserId, agentProfileId: p.id, gameIds: [f.game.id] }), { instructions: "Test" });
      const roleFacts = roleEvidence.games[0]!.canonicalFacts;
      if (!("werewolf" in roleFacts)) throw new Error("Wrong kind");
      if (roleFacts.reviewedPlayer.role === "seer") expect(roleFacts.werewolf.decisions.some(d => d.knownAtDecision.investigations.length > 0)).toBe(true);
      if (roleFacts.reviewedPlayer.role === "doctor") expect(roleFacts.werewolf.decisions.some(d => d.action.action === "protect")).toBe(true);
    }
    const context = buildBudgetedOwnerLearningProviderInput({ stage: "scanning_narratives", turn: {}, evidence, responseSchema: OWNER_LEARNING_HARNESS_RESPONSE_SCHEMA });
    expect(context.estimatedTokens).toBeLessThanOrEqual(OWNER_LEARNING_INPUT_TOKEN_LIMIT);
    const result = await runOwnerLearningHarness({ reviewId: "test", analysisTrack: "evidence_rich", currentStrategyStyle: null, evidence, invoke: async () => noChange });
    expect(result.result.noChange).toBeDefined();
    await db.update(schema.werewolfTurns).set({ observationHash: "tampered" }).where(eq(schema.werewolfTurns.gameId, f.game.id));
    await expect(projectOwnerLearningEvidence(db, selection, { instructions: "Test" })).rejects.toThrow("integrity");
  });
  test("runs the shared durable worker on gpt-6-luna without forcing a strategy defect", async () => {
    const db = await setupTestDB(); const f = await playedWerewolfReview(db);
    const started = await startOwnerLearningReview(db, { ownerUserId: f.ownerUserId, agentProfileId: f.villager.agentProfileId!, gameIds: [f.game.id], idempotencyKey: "wolf-worker" });
    expect(started.status).toBe("started");
    const claim = await claimOwnerLearningReview(db);
    expect(claim).not.toBeNull(); expect(OWNER_LEARNING_MODEL).toBe("openai:gpt-6-luna");
    await runClaimedOwnerLearningReview(db, claim!, { provider: { async invoke(request) {
      expect(request.input.gameKind).toBe("werewolf");
      await request.observer.onDispatchIntent({ transportOrdinal: 1, attemptedTier: "flex", dispatchedAtMs: Date.now() });
      await request.observer.onTerminalOutcome({ transportOrdinal: 1, attemptedTier: "flex", httpStatus: 200, latencyMs: 1, completedAtMs: Date.now() });
      return { output: noChange, effectiveTier: "flex", providerResponseId: "test-wolf", tokenReceipt: { inputTokens: 1000, cachedInputTokens: 0, totalOutputTokens: 100, reasoningTokens: 0 }, costReceipt: { costSource: "estimated", estimatedCostMicrousd: 0, pricingSourceId: "test", rateCardVersion: "test", pricedAt: new Date().toISOString() } };
    } } });
    const review = await getOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId: started.reviewId! });
    expect(review.gameKind).toBe("werewolf"); expect(review.analysisStatus).toBe("no_change");
    const remaining = await getOwnerLearningEligibleInputs(db, { ownerUserId: f.ownerUserId });
    expect(remaining.profiles.find(p => p.agentProfileId === f.wolves[0]!.agentProfileId)!.games[0]!.previouslyAnalyzed).toBe(false);
    await expect(getOwnedOwnerLearningReview(db, { ownerUserId: "stranger", reviewId: started.reviewId! })).rejects.toThrow();
  });
  test("applies only Werewolf strategy and preserves the Influence revision", async () => {
    const db = await setupTestDB(); const f = await playedWerewolfReview(db); const agentProfileId = f.villager.agentProfileId!;
    const started = await startOwnerLearningReview(db, { ownerUserId: f.ownerUserId, agentProfileId, gameIds: [f.game.id], idempotencyKey: "wolf-apply" });
    const reviewId = started.reviewId!; expect(reviewId).toBeDefined();
    const proposal = { field: "werewolfStrategyStyle" as const, before: "", after: "Ask what evidence changed a vote. Adapt this test to your faction and role." };
    const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
    await db.update(schema.agentLearningReviews).set({ analysisStatus: "ready", stage: "complete", proposalFingerprint, result: { diagnosis: "Test recommendation", analysisTrack: "evidence_rich", recommendations: [{ id: "rec-wolf", title: "Use an evidence test", disposition: "change", confidence: "medium", rationale: "Test recommendation", evidenceRefs: [] }], proposal } }).where(eq(schema.agentLearningReviews.id, reviewId));
    await db.update(schema.agentProfiles).set({ moderationRequired: true }).where(eq(schema.agentProfiles.id, agentProfileId));
    expect((await getOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId })).applyDisposition).toBe("unavailable");
    await expect(applyOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId, proposalFingerprint })).rejects.toThrow("review_revision_conflict");
    await db.update(schema.agentProfiles).set({ moderationRequired: false }).where(eq(schema.agentProfiles.id, agentProfileId));
    const changed = await updateOwnedAgentProfile(db, { userId: f.ownerUserId }, agentProfileId, { strategyStyle: "INFLUENCE_NEW" });
    expect((await getOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId })).applyDisposition).toBe("available");
    const applied = await applyOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId, proposalFingerprint });
    const profile = (await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agentProfileId)))[0]!;
    expect(profile.werewolfStrategyStyle).toBe(proposal.after); expect(profile.strategyStyle).toBe("INFLUENCE_NEW");
    expect(profile.currentRevisionId).toBe(changed.profile.currentRevisionId);
    expect(await applyOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId, proposalFingerprint })).toEqual({ ...applied, replayed: true });
  });
  test("linked manual edits resolve the Werewolf review and unrelated shared behavior edits supersede it", async () => {
    const db = await setupTestDB(); const f = await playedWerewolfReview(db); const agentProfileId = f.villager.agentProfileId!;
    const started = await startOwnerLearningReview(db, { ownerUserId: f.ownerUserId, agentProfileId, gameIds: [f.game.id], idempotencyKey: "wolf-manual" });
    const reviewId = started.reviewId!;
    const proposal = { field: "werewolfStrategyStyle" as const, before: "", after: "Proposed Werewolf change" };
    const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
    await db.update(schema.agentLearningReviews).set({ analysisStatus: "ready", stage: "complete", proposalFingerprint, result: { diagnosis: "Test", analysisTrack: "evidence_rich", recommendations: [], proposal } }).where(eq(schema.agentLearningReviews.id, reviewId));
    await expect(updateOwnedAgentProfile(db, { userId: f.ownerUserId }, agentProfileId, { strategyStyle: "Wrong game field", sourceReviewId: reviewId })).rejects.toMatchObject({ code: "source_review_conflict" });
    await updateOwnedAgentProfile(db, { userId: f.ownerUserId }, agentProfileId, { werewolfStrategyStyle: "My own role-sensitive revision", sourceReviewId: reviewId });
    expect((await getOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId })).resolution).toBe("manual_update");
    expect((await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, agentProfileId)))[0]!.strategyStyle).toBe("INFLUENCE_ONLY");
    // Reset only test credit, then exercise another profile in the same frozen game.
    await db.delete(schema.agentLearningReviewEntitlements).where(eq(schema.agentLearningReviewEntitlements.ownerUserId, f.ownerUserId));
    const secondId = f.wolves[0]!.agentProfileId!;
    const second = await startOwnerLearningReview(db, { ownerUserId: f.ownerUserId, agentProfileId: secondId, gameIds: [f.game.id], idempotencyKey: "wolf-stale" });
    await updateOwnedAgentProfile(db, { userId: f.ownerUserId }, secondId, { personality: "A different behavioral identity" });
    expect((await getOwnedOwnerLearningReview(db, { ownerUserId: f.ownerUserId, reviewId: second.reviewId! })).resolution).toBe("superseded");
  });

});
