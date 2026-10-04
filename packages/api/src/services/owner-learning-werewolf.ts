import { and, eq, isNotNull } from "drizzle-orm";
import { applyWerewolfEvent, observeWerewolf, projectWerewolfView, werewolfDecisionArtifact, werewolfGameplayDecision,
  type WerewolfEvent, type WerewolfObservation, type WerewolfState } from "@influence/engine/werewolf";
import { exactStructuredOutputRegistry } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { sha256StableJson } from "./stable-hash.js";
import { mintOwnerLearningMomentId, OWNER_LEARNING_MOMENT_WINDOW_VERSION, buildBudgetedOwnerLearningInput,
  type OwnerLearningEvidenceProjection, type OwnerLearningProjectedGameEvidence } from "./owner-learning-evidence.js";
import { OWNER_LEARNING_EVIDENCE_VERSION } from "./owner-learning-contracts.js";
import type { OwnerLearningValidatedSelection } from "./owner-learning-eligibility.js";

type Accepted = Extract<WerewolfEvent, { type: "werewolf.action_accepted" }>;
export interface WerewolfReviewDecision {
  sequence: number;
  day: number;
  phase: string;
  cursor: number;
  action: Accepted["payload"];
  knownAtDecision: WerewolfObservation;
  thinking: string | null;
}
export interface WerewolfReviewFacts {
  gameKind: "werewolf";
  game: { id: string; slug: string; completionAt: string; roundCount: number; playerCount: number };
  reviewedPlayer: { id: string; role: string; faction: string; won: boolean; survived: boolean; readableSummary: string };
  werewolf: {
    rulesVersion: number;
    runtime: { providerManifest: unknown; serviceTier: unknown };
    laterOutcome: NonNullable<WerewolfState["outcome"]>;
    publicOutcomes: ReturnType<typeof projectWerewolfView>["entries"];
    cast: Array<{ id: string; name: string }>;
    decisions: WerewolfReviewDecision[];
    missingThinkingCount: number;
  };
}

export const WEREWOLF_REVIEW_INSTRUCTIONS = [
  "Review Werewolf faction play. Death and survival are not measures of decision quality.",
  "Judge each choice only with its knownAtDecision observation and legal choices; laterOutcome is hindsight, not actor knowledge.",
  "Separate facts, interpretation and proposed guidance. Do not infer causality from a win, loss or death.",
  "Do not penalize deliberate sacrifice, legal hear-more abstention or a provider-unavailable action as if it were an intentional mistake.",
  "Respect role objectives: wolves seek faction parity, villagers seek wolf elimination; Seer knowledge and Doctor protection are private.",
  "Missing thinking is missing evidence. Do not invent an inner monologue or evolving strategy.",
  "Recommend a Werewolf strategy change only for a supported defect. No change or gather more evidence is a valid outcome.",
].join("\n");

export async function projectWerewolfReviewEvidence(db: DrizzleDB, selection: OwnerLearningValidatedSelection): Promise<OwnerLearningEvidenceProjection> {
  const games: OwnerLearningProjectedGameEvidence[] = [];
  for (const selected of selection.games) {
    const [events, turns, calls, gameRows] = await Promise.all([
      readWerewolfEvents(db, selected.gameId),
      db.select().from(schema.werewolfTurns).where(eq(schema.werewolfTurns.gameId, selected.gameId)),
      db.select().from(schema.providerLogicalCalls).where(and(eq(schema.providerLogicalCalls.gameId, selected.gameId),
        eq(schema.providerLogicalCalls.actorId, selected.playerId), isNotNull(schema.providerLogicalCalls.acceptedAttemptId))),
      db.select({ config: schema.games.config }).from(schema.games).where(eq(schema.games.id, selected.gameId)),
    ]);
    const config = JSON.parse(gameRows[0]!.config) as Record<string, unknown>;
    const planned = new Map(turns.map(turn => [turn.sequence, turn]));
    let state: WerewolfState | null = null;
    const decisions: WerewolfReviewDecision[] = [];
    for (const event of events) {
      if (event.type === "werewolf.action_accepted" && event.payload.actorId === selected.playerId) {
        if (!state) throw new Error("Werewolf review is missing its initial state");
        const knownAtDecision = observeWerewolf(state, selected.playerId);
        const turn = planned.get(event.sequence);
        const { decision, fallback, ...request } = event.payload;
        if (!turn || turn.observationHash !== sha256StableJson(knownAtDecision) || sha256StableJson(turn.request) !== sha256StableJson(request)) {
          throw new Error("Werewolf review decision observation failed integrity validation");
        }
        let thinking: string | null = fallback ? null : decision.kind === "target" ? decision.thinking : null;
        const call = calls.find(call => {
          const coordinate = call.semanticCoordinate;
          return coordinate && typeof coordinate === "object" && "kind" in coordinate && coordinate.kind === "werewolf_action" && "eventSequence" in coordinate && coordinate.eventSequence === event.sequence;
        });
        if (!fallback && call) {
          if (call.action !== `werewolf.${request.action}` || call.acceptedValueSha256 !== sha256StableJson(call.acceptedValue)) throw new Error("Werewolf review thinking failed integrity validation");
          const decoded = exactStructuredOutputRegistry.decodeAcceptedValue(werewolfDecisionArtifact(request), call.acceptedValue);
          if (decoded.status !== "valid" || sha256StableJson(werewolfGameplayDecision(decoded.value)) !== sha256StableJson(decision)) throw new Error("Werewolf review thinking does not match its decision");
          thinking = decoded.value.thinking;
        }
        decisions.push({ sequence: event.sequence, day: state.day, phase: state.phase,
          cursor: projectWerewolfView(state, "omniscient").cursor, action: structuredClone(event.payload), knownAtDecision, thinking });
      }
      state = applyWerewolfEvent(state, event);
    }
    if (!state?.outcome) throw new Error("Werewolf review requires a completed canonical outcome");
    const player = state.players.find(player => player.id === selected.playerId && player.agentProfileId === selection.agentProfileId);
    if (!player) throw new Error("Werewolf reviewed character is absent from its frozen roster");
    const role = state.roles[player.id]!;
    const faction = role === "werewolf" ? "wolves" : "village";
    const won = state.outcome.faction === faction;
    const canonicalFacts: WerewolfReviewFacts = {
      gameKind: "werewolf", game: { id: selected.gameId, slug: selected.slug, completionAt: selected.completionAt,
        roundCount: state.day, playerCount: state.players.length },
      reviewedPlayer: { id: player.id, role, faction, won, survived: state.aliveIds.includes(player.id),
        readableSummary: `${player.name} played ${role}. ${state.outcome.faction === null ? "The game ended in a draw." : `${state.outcome.faction === "wolves" ? "The wolves" : "The village"} won.`}` },
      werewolf: { rulesVersion: state.config.rulesVersion, runtime: { providerManifest: config.providerManifest ?? null, serviceTier: config.serviceTier ?? null }, laterOutcome: state.outcome,
        publicOutcomes: projectWerewolfView(state, "mystery").entries.filter(entry => entry.kind === "night" || entry.kind === "vote"),
        cast: state.players.map(p => ({ id: p.id, name: p.name })), decisions,
        missingThinkingCount: decisions.filter(d => !d.thinking).length },
    };
    const candidateMoments = decisions.map(decision => ({
      id: mintOwnerLearningMomentId({ gameId: selected.gameId, reviewedAgentProfileId: selection.agentProfileId,
        evidenceVersion: OWNER_LEARNING_EVIDENCE_VERSION, anchorKind: "decision", sourceCoordinate: `werewolf:${decision.sequence}`,
        windowVersion: OWNER_LEARNING_MOMENT_WINDOW_VERSION }), gameId: selected.gameId, anchorKind: "decision" as const,
      sourceCoordinate: `werewolf:${decision.sequence}`, sourceHash: sha256StableJson(decision), round: decision.day, phase: decision.phase,
    }));
    games.push({ gameId: selected.gameId, canonicalFacts, narrativeGroups: [], narrativeCoverage: decisions.length ? "rich" : "thin",
      candidateMoments, sourceHash: sha256StableJson({ canonicalFacts, candidateMoments }), sourceCaptureVersion: `werewolf-review-v1:rules-${state.config.rulesVersion}` });
  }
  return { analysisTrack: games.some(game => game.candidateMoments.length) ? "evidence_rich" : "awaiting_evidence", games,
    reviewInput: buildBudgetedOwnerLearningInput({ instructions: WEREWOLF_REVIEW_INSTRUCTIONS, games: games.map(game => ({
      gameId: game.gameId, canonicalFacts: game.canonicalFacts, candidateMomentIds: game.candidateMoments.map(m => m.id), narrativeGroups: [],
    })) }) };
}
