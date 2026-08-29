import type { UUID } from "../types";
import { Phase } from "../types";
import type { EmpowerRevoteAction, IAgent, TargetDecision } from "../game-runner.types";
import type { EngineFallbackReason } from "../game-runner.types";
import { ProviderUnavailableError } from "../provider-execution";
import {
  deterministicEngineFallback,
  engineFallbackMetadata,
} from "../engine-fallback";
import {
  assertCanAcceptCommit,
  agentTurnSourcePointer,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";
import {
  getEndgameEliminationVoterNames,
  handleElimination,
} from "./elimination";

async function withEndgameVoteTimeout(
  ctx: PhaseRunnerContext,
  label: string,
  operation: (signal: AbortSignal) => Promise<TargetDecision>,
  fallback: (reason: EngineFallbackReason) => TargetDecision,
): Promise<TargetDecision> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) {
    try {
      return await operation(new AbortController().signal);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      return fallback("provider_exhausted");
    }
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TargetDecision>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(`${label} timed out after ${timeoutMs}ms; using House fallback.`, Phase.VOTE);
      resolve(fallback("action_timed_out"));
      controller.abort();
    }, timeoutMs);
  });

  return Promise.race([
    operation(controller.signal).catch((error) => {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      return fallback("provider_exhausted");
    }),
    timeoutPromise,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function fallbackEliminationDecision(
  ctx: PhaseRunnerContext,
  voterId: UUID,
  legalTargets = ctx.gameState.getAlivePlayerIds().filter((id) => id !== voterId),
  reason: EngineFallbackReason = "provider_exhausted",
): TargetDecision {
  return {
    target: deterministicEngineFallback(
      legalTargets,
      {
        gameId: ctx.gameState.gameId,
        round: ctx.gameState.round,
        phase: Phase.VOTE,
      },
      voterId,
      "endgame-elimination-vote",
    ),
    ...engineFallbackMetadata(
      {
        gameId: ctx.gameState.gameId,
        round: ctx.gameState.round,
        phase: Phase.VOTE,
      },
      voterId,
      "endgame-elimination-vote",
      reason,
    ),
  };
}

function getTribunalDecidingVoterNames(
  ctx: PhaseRunnerContext,
  eliminatedId: UUID,
): string[] {
  const resolution = ctx.gameState.getCanonicalEvents().at(-1);
  if (
    resolution?.type !== "endgame.elimination_resolved"
    || resolution.payload.eliminated !== eliminatedId
  ) {
    throw new Error("Expected Tribunal tally to record its elimination resolution");
  }

  if (resolution.payload.method !== "jury_tiebreaker") {
    return getEndgameEliminationVoterNames(ctx, eliminatedId);
  }

  const juryVotes = resolution.payload.juryTiebreakerVotes;
  if (!juryVotes) {
    throw new Error("Expected Tribunal jury tiebreaker resolution to include jury votes");
  }

  return Object.entries(juryVotes)
    .filter(([, target]) => target === eliminatedId)
    .map(([jurorId]) => ctx.gameState.getPlayerName(jurorId as UUID));
}

type EmpowerVoteDecision = Awaited<ReturnType<IAgent["getVotes"]>>;

export interface EmpowerVoteBatchItem {
  voterId: UUID;
  decision: EmpowerVoteDecision;
}

export interface EmpowerRevoteBatchItem {
  voterId: UUID;
  originalVote: { empowerTarget: UUID };
  decision: EmpowerRevoteAction;
}

/** Dispatch every initial ballot against the same frozen vote frontier. */
export async function collectEmpowerVoteBatch(
  ctx: PhaseRunnerContext,
): Promise<EmpowerVoteBatchItem[]> {
  const { gameState, agents } = ctx;
  const alivePlayers = gameState.getAlivePlayers();
  return Promise.all(alivePlayers.map(async (player) => {
    const agent = agents.get(player.id)!;
    const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
    const legalTargets = alivePlayers
      .filter((candidate) => candidate.id !== player.id)
      .map((candidate) => candidate.id);
    let decision: EmpowerVoteDecision;
    try {
      decision = await agent.getVotes(phaseCtx);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      decision = {
        empowerTarget: deterministicEngineFallback(legalTargets, phaseCtx, player.id, "vote"),
        ...engineFallbackMetadata(phaseCtx, player.id, "vote", "provider_exhausted"),
      };
    }
    if (!legalTargets.includes(decision.empowerTarget)) {
      decision = {
        empowerTarget: deterministicEngineFallback(legalTargets, phaseCtx, player.id, "vote"),
        ...engineFallbackMetadata(phaseCtx, player.id, "vote", "invalid_model_output"),
      };
    }
    return { voterId: player.id, decision };
  }));
}

/** Apply collected ballots in roster order, independent of provider completion order. */
export async function applyEmpowerVoteBatch(
  ctx: PhaseRunnerContext,
  batch: readonly EmpowerVoteBatchItem[],
): Promise<void> {
  const { gameState, agents, logger } = ctx;
  for (const item of batch) {
    const player = gameState.getPlayer(item.voterId);
    const agent = agents.get(item.voterId);
    if (!player || !agent) throw new Error(`Empower vote references missing voter ${item.voterId}`);
    const votes = item.decision;
    await assertCanAcceptCommit(ctx);
    gameState.recordVote(player.id, votes.empowerTarget, null, [
      agentTurnSourcePointer(
        player.id,
        "vote",
        gameState.round,
        Phase.VOTE,
        undefined,
        votes.engineFallback ? undefined : votes.decisionId,
        votes.engineFallback,
      ),
    ]);
    resolveActionStrategyCandidate(agent, votes, votes.strategyGameplayAccepted !== false);
    const empowerName = gameState.getPlayerName(votes.empowerTarget);
    const transcriptThinking = transcriptThinkingFor(agent, votes.thinking, votes.reasoningContext, votes);
    logger.logSystem(
      `${player.name} votes: empower=${empowerName}`,
      Phase.VOTE,
      transcriptThinking.thinking,
      transcriptThinking.reasoningContext,
    );
    logger.emitAgentTurn({
      phase: Phase.VOTE,
      action: "vote",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        empowerTarget: { id: votes.empowerTarget, name: empowerName },
        ...strategicDecisionResponse(votes),
      },
      thinking: votes.thinking,
      reasoningContext: votes.reasoningContext,
      scope: "system",
      text: `${player.name} votes: empower=${empowerName}`,
    });
  }
}

export function originalEmpowerVotesForRound(
  ctx: PhaseRunnerContext,
): Map<UUID, { empowerTarget: UUID }> {
  const result = new Map<UUID, { empowerTarget: UUID }>();
  for (const event of ctx.gameState.getCanonicalEvents()) {
    if (event.type !== "vote.cast" || event.round !== ctx.gameState.round) continue;
    result.set(event.payload.voterId, { empowerTarget: event.payload.empowerTarget });
  }
  return result;
}

/** Tally initial votes and stage any clear operations needed by the re-vote frontier. */
export async function tallyEmpowerVote(
  ctx: PhaseRunnerContext,
): Promise<{ empoweredId: UUID; tied: UUID[] | null }> {
  await assertCanAcceptCommit(ctx);
  const result = ctx.gameState.tallyEmpowerVotes();
  if (result.tied) {
    const tiedNames = result.tied.map((id) => ctx.gameState.getPlayerName(id)).join(", ");
    ctx.logger.logSystem(`Empower TIED between: ${tiedNames}. Re-vote!`, Phase.VOTE);
    const reVoters = ctx.gameState.getAlivePlayers().filter((player) => !result.tied!.includes(player.id));
    for (const player of reVoters) {
      await assertCanAcceptCommit(ctx);
      ctx.gameState.clearEmpowerVote(player.id);
    }
  }
  return { empoweredId: result.empowered, tied: result.tied };
}

/** Dispatch every re-vote against the same post-clear frontier. */
export async function collectEmpowerRevoteBatch(
  ctx: PhaseRunnerContext,
  tied: readonly UUID[],
): Promise<EmpowerRevoteBatchItem[]> {
  const { gameState, agents } = ctx;
  const originalVotes = originalEmpowerVotesForRound(ctx);
  const reVoters = gameState.getAlivePlayers().filter((player) => !tied.includes(player.id));
  return Promise.all(reVoters.map(async (player) => {
    const agent = agents.get(player.id)!;
    const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
    const originalVote = originalVotes.get(player.id) ?? { empowerTarget: tied[0]! };
    let decision: EmpowerRevoteAction;
    try {
      decision = await agent.getEmpowerRevote(phaseCtx, [...tied], originalVote);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      decision = {
        empowerTarget: deterministicEngineFallback([...tied], phaseCtx, player.id, "empower-revote"),
        ...engineFallbackMetadata(phaseCtx, player.id, "empower-revote", "provider_exhausted"),
      };
    }
    if (!tied.includes(decision.empowerTarget)) {
      decision = {
        empowerTarget: deterministicEngineFallback([...tied], phaseCtx, player.id, "empower-revote"),
        ...engineFallbackMetadata(phaseCtx, player.id, "empower-revote", "invalid_model_output"),
      };
    }
    return { voterId: player.id, originalVote, decision };
  }));
}

export async function applyEmpowerRevoteBatch(
  ctx: PhaseRunnerContext,
  tied: readonly UUID[],
  batch: readonly EmpowerRevoteBatchItem[],
): Promise<void> {
  const { gameState, agents, logger } = ctx;
  for (const item of batch) {
    const player = gameState.getPlayer(item.voterId);
    const agent = agents.get(item.voterId);
    if (!player || !agent) throw new Error(`Empower re-vote references missing voter ${item.voterId}`);
    const revote = item.decision;
    await assertCanAcceptCommit(ctx);
    gameState.recordEmpowerReVote(player.id, revote.empowerTarget, [
      agentTurnSourcePointer(
        player.id,
        "empower-revote",
        gameState.round,
        Phase.VOTE,
        undefined,
        revote.engineFallback ? undefined : revote.decisionId,
        revote.engineFallback,
      ),
    ]);
    resolveActionStrategyCandidate(
      agent,
      revote,
      !revote.engineFallback && revote.strategyGameplayAccepted !== false,
    );
    const empowerName = gameState.getPlayerName(revote.empowerTarget);
    const transcriptThinking = transcriptThinkingFor(agent, revote.thinking, revote.reasoningContext, revote);
    logger.logSystem(
      `${player.name} re-votes: empower=${empowerName}`,
      Phase.VOTE,
      transcriptThinking.thinking,
      transcriptThinking.reasoningContext,
    );
    logger.emitAgentTurn({
      phase: Phase.VOTE,
      action: "empower-revote",
      actor: { id: player.id, name: player.name, role: "player" },
      visibility: "private",
      response: {
        empowerTarget: { id: revote.empowerTarget, name: empowerName },
        eligibleTargets: tied.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        originalVote: {
          empowerTarget: {
            id: item.originalVote.empowerTarget,
            name: gameState.getPlayerName(item.originalVote.empowerTarget),
          },
        },
        fallbackApplied: false,
        ...strategicDecisionResponse(revote),
      },
      thinking: revote.thinking,
      reasoningContext: revote.reasoningContext,
      scope: "system",
      text: `${player.name} re-votes: empower=${empowerName}`,
    });
  }
}

export async function resolveEmpowerRevote(
  ctx: PhaseRunnerContext,
  tied: readonly UUID[],
  random: () => number = Math.random,
): Promise<UUID> {
  const counts: Record<UUID, number> = {};
  for (const id of tied) counts[id] = 0;
  for (const target of Object.values(ctx.gameState.currentVoteTally.empowerVotes)) {
    if (target in counts) counts[target] = (counts[target] ?? 0) + 1;
  }
  const max = Math.max(...Object.values(counts), 0);
  const finalists = tied.filter((id) => counts[id] === max);
  const empoweredId = finalists.length === 1
    ? finalists[0]!
    : finalists[Math.floor(random() * finalists.length)]!;
  const method = finalists.length === 1 ? "revote" : "wheel";
  ctx.logger.logSystem(
    finalists.length === 1
      ? `Re-vote resolved: ${ctx.gameState.getPlayerName(empoweredId)} empowered`
      : `Re-vote still tied! THE WHEEL decides: ${ctx.gameState.getPlayerName(empoweredId)} empowered`,
    Phase.VOTE,
  );
  await assertCanAcceptCommit(ctx);
  ctx.gameState.setEmpowered(empoweredId, method);
  return empoweredId;
}

export function finishEmpowerVote(
  ctx: PhaseRunnerContext,
  empoweredId: UUID,
): void {
  const originalVotes = originalEmpowerVotesForRound(ctx);
  const revotes = new Map<UUID, UUID>();
  for (const event of ctx.gameState.getCanonicalEvents()) {
    if (event.type === "vote.empower_revote_cast" && event.round === ctx.gameState.round) {
      revotes.set(event.payload.voterId, event.payload.target);
    }
  }
  const alivePlayers = ctx.gameState.getAlivePlayers();
  ctx.contextBuilder.revealVoteLedgerEntries(alivePlayers.flatMap((player) => {
    const original = originalVotes.get(player.id);
    if (!original) return [];
    const revoteTarget = revotes.get(player.id);
    return [{
      round: ctx.gameState.round,
      voterId: player.id,
      voterName: player.name,
      empowerTargetId: original.empowerTarget,
      empowerTargetName: ctx.gameState.getPlayerName(original.empowerTarget),
      ...(revoteTarget ? {
        revoteEmpowerTargetId: revoteTarget,
        revoteEmpowerTargetName: ctx.gameState.getPlayerName(revoteTarget),
      } : {}),
    }];
  }));
  ctx.logger.logSystem(`Empowered: ${ctx.gameState.getPlayerName(empoweredId)}`, Phase.VOTE);
  ctx.contextBuilder.currentPostVotePressure = null;
  ctx.logger.logSystem("Format kernel: empower resolved; format menu next.", Phase.VOTE);
  for (const [voterId, targetId] of Object.entries(ctx.gameState.currentVoteTally.empowerVotes)) {
    ctx.agents.get(voterId as UUID)?.updateAlly(ctx.gameState.getPlayerName(targetId));
  }
}

export async function runVotePhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== VOTE PHASE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
      const legalTargets = alivePlayers
        .filter((candidate) => candidate.id !== player.id)
        .map((candidate) => candidate.id);
      let votes;
      try {
        votes = await agent.getVotes(phaseCtx);
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        votes = {
          empowerTarget: deterministicEngineFallback(
            legalTargets,
            phaseCtx,
            player.id,
            "vote",
          ),
          ...engineFallbackMetadata(
            phaseCtx,
            player.id,
            "vote",
            "provider_exhausted",
          ),
        };
      }
      if (!legalTargets.includes(votes.empowerTarget)) {
        votes = {
          empowerTarget: deterministicEngineFallback(
            legalTargets,
            phaseCtx,
            player.id,
            "vote",
          ),
          ...engineFallbackMetadata(
            phaseCtx,
            player.id,
            "vote",
            "invalid_model_output",
          ),
        };
      }

      await assertCanAcceptCommit(ctx);
      // Format kernel: empower-only ballot. exposeTarget intentionally omitted.
      gameState.recordVote(player.id, votes.empowerTarget, null, [
        agentTurnSourcePointer(
          player.id,
          "vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          votes.engineFallback ? undefined : votes.decisionId,
          votes.engineFallback,
        ),
      ]);
      resolveActionStrategyCandidate(
        agent,
        votes,
        votes.strategyGameplayAccepted !== false,
      );

      const empowerName = gameState.getPlayerName(votes.empowerTarget);
      const transcriptThinking = transcriptThinkingFor(agent, votes.thinking, votes.reasoningContext, votes);
      logger.logSystem(
        `${player.name} votes: empower=${empowerName}`,
        Phase.VOTE,
        transcriptThinking.thinking,
        transcriptThinking.reasoningContext,
      );
      logger.emitAgentTurn({
        phase: Phase.VOTE,
        action: "vote",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "private",
        response: {
          empowerTarget: { id: votes.empowerTarget, name: empowerName },
          ...strategicDecisionResponse(votes),
        },
        thinking: votes.thinking,
        reasoningContext: votes.reasoningContext,
        scope: "system",
        text: `${player.name} votes: empower=${empowerName}`,
      });
    }),
  );

  const originalVotesByPlayerId = new Map<UUID, { empowerTarget: UUID }>();
  for (const player of alivePlayers) {
    const empowerTarget = gameState.currentVoteTally.empowerVotes[player.id];
    if (empowerTarget) {
      originalVotesByPlayerId.set(player.id, { empowerTarget });
    }
  }

  await assertCanAcceptCommit(ctx);
  const { empowered: initialEmpowered, tied } = gameState.tallyEmpowerVotes();
  let empoweredId = initialEmpowered;
  const revoteTargetsByPlayerId = new Map<UUID, UUID>();

  if (tied) {
    const tiedNames = tied.map((id) => gameState.getPlayerName(id)).join(", ");
    logger.logSystem(`Empower TIED between: ${tiedNames}. Re-vote!`, Phase.VOTE);

    const reVoters = alivePlayers.filter((p) => !tied.includes(p.id));
    for (const rv of reVoters) {
      await assertCanAcceptCommit(ctx);
      gameState.clearEmpowerVote(rv.id);
    }
    if (reVoters.length > 0) {
      await Promise.all(
        reVoters.map(async (player) => {
          const agent = agents.get(player.id)!;
          const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
          const originalVote = originalVotesByPlayerId.get(player.id) ?? {
            empowerTarget: gameState.currentVoteTally.empowerVotes[player.id] ?? tied[0]!,
          };
          let revote;
          try {
            revote = await agent.getEmpowerRevote(phaseCtx, tied, originalVote);
          } catch (error) {
            if (!(error instanceof ProviderUnavailableError)) throw error;
            revote = {
              empowerTarget: deterministicEngineFallback(
                tied,
                phaseCtx,
                player.id,
                "empower-revote",
              ),
              ...engineFallbackMetadata(
                phaseCtx,
                player.id,
                "empower-revote",
                "provider_exhausted",
              ),
            };
          }
          const acceptedDirectly = tied.includes(revote.empowerTarget);
          if (!acceptedDirectly) {
            revote = {
              empowerTarget: deterministicEngineFallback(
                tied,
                phaseCtx,
                player.id,
                "empower-revote",
              ),
              ...engineFallbackMetadata(
                phaseCtx,
                player.id,
                "empower-revote",
                "invalid_model_output",
              ),
            };
          }
          const empowerTarget = revote.empowerTarget;
          await assertCanAcceptCommit(ctx);
          gameState.recordEmpowerReVote(player.id, empowerTarget, [
            agentTurnSourcePointer(
              player.id,
              "empower-revote",
              gameState.round,
              Phase.VOTE,
              undefined,
              revote.engineFallback ? undefined : revote.decisionId,
              revote.engineFallback,
            ),
          ]);
          resolveActionStrategyCandidate(
            agent,
            revote,
            !revote.engineFallback && revote.strategyGameplayAccepted !== false,
          );
          revoteTargetsByPlayerId.set(player.id, empowerTarget);
          const empowerName = gameState.getPlayerName(empowerTarget);
          const transcriptThinking = transcriptThinkingFor(agent, revote.thinking, revote.reasoningContext, revote);
          logger.logSystem(`${player.name} re-votes: empower=${empowerName}`, Phase.VOTE, transcriptThinking.thinking, transcriptThinking.reasoningContext);
          logger.emitAgentTurn({
            phase: Phase.VOTE,
            action: "empower-revote",
            actor: { id: player.id, name: player.name, role: "player" },
            visibility: "private",
            response: {
              empowerTarget: { id: empowerTarget, name: empowerName },
              eligibleTargets: tied.map((id) => ({ id, name: gameState.getPlayerName(id) })),
              originalVote: {
                empowerTarget: { id: originalVote.empowerTarget, name: gameState.getPlayerName(originalVote.empowerTarget) },
              },
              fallbackApplied: empowerTarget !== revote.empowerTarget,
              ...strategicDecisionResponse(revote),
            },
            thinking: revote.thinking,
            reasoningContext: revote.reasoningContext,
            scope: "system",
            text: `${player.name} re-votes: empower=${empowerName}`,
          });
        }),
      );
    }

    const reVoteCounts: Record<UUID, number> = {};
    for (const id of tied) reVoteCounts[id] = 0;
    for (const voter of reVoters) {
      const target = gameState.currentVoteTally.empowerVotes[voter.id];
      if (target && target in reVoteCounts) {
        reVoteCounts[target] = (reVoteCounts[target] ?? 0) + 1;
      }
    }

    const maxReVotes = Math.max(...Object.values(reVoteCounts), 0);
    const reVoteTied = tied.filter((id) => reVoteCounts[id] === maxReVotes);

    if (reVoteTied.length === 1) {
      empoweredId = reVoteTied[0]!;
      logger.logSystem(`Re-vote resolved: ${gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
      await assertCanAcceptCommit(ctx);
      gameState.setEmpowered(empoweredId, "revote");
    } else {
      empoweredId = reVoteTied[Math.floor(Math.random() * reVoteTied.length)]!;
      logger.logSystem(`Re-vote still tied! THE WHEEL decides: ${gameState.getPlayerName(empoweredId)} empowered`, Phase.VOTE);
      await assertCanAcceptCommit(ctx);
      gameState.setEmpowered(empoweredId, "wheel");
    }
  }

  contextBuilder.revealVoteLedgerEntries(
    alivePlayers.flatMap((player) => {
      const originalVote = originalVotesByPlayerId.get(player.id);
      if (!originalVote) return [];
      const revoteEmpowerTarget = revoteTargetsByPlayerId.get(player.id);
      return [{
        round: gameState.round,
        voterId: player.id,
        voterName: player.name,
        empowerTargetId: originalVote.empowerTarget,
        empowerTargetName: gameState.getPlayerName(originalVote.empowerTarget),
        ...(revoteEmpowerTarget
          ? {
              revoteEmpowerTargetId: revoteEmpowerTarget,
              revoteEmpowerTargetName: gameState.getPlayerName(revoteEmpowerTarget),
            }
          : {}),
      }];
    }),
  );

  logger.logSystem(
    `Empowered: ${gameState.getPlayerName(empoweredId)}`,
    Phase.VOTE,
  );

  // Format kernel: empower-only vote. No expose collection, no exposure bench, no post-vote pressure.
  contextBuilder.currentPostVotePressure = null;
  logger.logSystem(
    "Format kernel: empower resolved; format menu next.",
    Phase.VOTE,
  );

  // Update agent memory from empower targets only.
  const voteTally = gameState.currentVoteTally;
  for (const [voterId, empowerTargetId] of Object.entries(voteTally.empowerVotes)) {
    const agent = agents.get(voterId as UUID);
    if (agent) {
      const empowerName = gameState.getPlayerName(empowerTargetId);
      agent.updateAlly(empowerName);
    }
  }

  actor.send({ type: "VOTES_TALLIED", empoweredId });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runReckoningVote(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== RECKONING: ELIMINATION VOTE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
      const vote = await withEndgameVoteTimeout(
        ctx,
        `${player.name} reckoning vote`,
        (signal) => agent.getEndgameEliminationVote(phaseCtx, { signal }),
        (reason) => fallbackEliminationDecision(ctx, player.id, undefined, reason),
      );
      const legalTargets = alivePlayers.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.id);
      const acceptedVote = legalTargets.includes(vote.target)
        ? vote
        : fallbackEliminationDecision(ctx, player.id, legalTargets, "invalid_model_output");
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, acceptedVote.target, [
        agentTurnSourcePointer(
          player.id,
          "elimination-vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          acceptedVote.engineFallback ? undefined : acceptedVote.decisionId,
          acceptedVote.engineFallback,
        ),
      ]);
      resolveActionStrategyCandidate(
        agent,
        acceptedVote,
        !acceptedVote.engineFallback && acceptedVote.strategyGameplayAccepted !== false,
      );
      const targetName = gameState.getPlayerName(acceptedVote.target);
      const transcriptThinking = transcriptThinkingFor(agent, acceptedVote.thinking, acceptedVote.reasoningContext, acceptedVote);
      logger.logSystem(
        `${player.name} votes to eliminate: ${targetName}`,
        Phase.VOTE,
        transcriptThinking.thinking,
        transcriptThinking.reasoningContext,
      );
      logger.emitAgentTurn({
        phase: Phase.VOTE,
        action: "endgame-elimination-vote",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "private",
        response: {
          target: { id: acceptedVote.target, name: targetName },
          stage: "reckoning",
          ...strategicDecisionResponse(acceptedVote),
        },
        thinking: acceptedVote.thinking,
        reasoningContext: acceptedVote.reasoningContext,
        scope: "system",
        text: `${player.name} votes to eliminate: ${targetName}`,
      });
    }),
  );

  await assertCanAcceptCommit(ctx);
  const eliminatedId = gameState.tallyEndgameEliminationVotes(ctx.random);
  const eliminationVoters = getEndgameEliminationVoterNames(ctx, eliminatedId);
  await handleElimination(ctx, eliminatedId, Phase.VOTE, {
    mode: "endgame",
    voteDisclosure: {
      visibility: "public",
      votesReceived: eliminationVoters.length,
      voterNames: eliminationVoters,
    },
  });

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runTribunalVote(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== TRIBUNAL: ELIMINATION VOTE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = prepareAgentPhaseContext(ctx, agent, player.id, Phase.VOTE, "strategic_decision");
      const vote = await withEndgameVoteTimeout(
        ctx,
        `${player.name} tribunal vote`,
        (signal) => agent.getEndgameEliminationVote(phaseCtx, { signal }),
        (reason) => fallbackEliminationDecision(ctx, player.id, undefined, reason),
      );
      const legalTargets = alivePlayers.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.id);
      const acceptedVote = legalTargets.includes(vote.target)
        ? vote
        : fallbackEliminationDecision(ctx, player.id, legalTargets, "invalid_model_output");
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, acceptedVote.target, [
        agentTurnSourcePointer(
          player.id,
          "elimination-vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          acceptedVote.engineFallback ? undefined : acceptedVote.decisionId,
          acceptedVote.engineFallback,
        ),
      ]);
      resolveActionStrategyCandidate(
        agent,
        acceptedVote,
        !acceptedVote.engineFallback && acceptedVote.strategyGameplayAccepted !== false,
      );
      const targetName = gameState.getPlayerName(acceptedVote.target);
      const transcriptThinking = transcriptThinkingFor(agent, acceptedVote.thinking, acceptedVote.reasoningContext, acceptedVote);
      logger.logSystem(
        `${player.name} votes to eliminate: ${targetName}`,
        Phase.VOTE,
        transcriptThinking.thinking,
        transcriptThinking.reasoningContext,
      );
      logger.emitAgentTurn({
        phase: Phase.VOTE,
        action: "endgame-elimination-vote",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "private",
        response: {
          target: { id: acceptedVote.target, name: targetName },
          stage: "tribunal",
          ...strategicDecisionResponse(acceptedVote),
        },
        thinking: acceptedVote.thinking,
        reasoningContext: acceptedVote.reasoningContext,
        scope: "system",
        text: `${player.name} votes to eliminate: ${targetName}`,
      });
    }),
  );

  // Tribunal: jury only weighs in when the live vote is actually tied.
  let juryTiebreakerVotes: Record<UUID, UUID> | undefined;
  const juryTiebreakerSourcePointers: ReturnType<typeof agentTurnSourcePointer>[] = [];
  const tribunalTieCandidates = gameState.getTribunalEliminationTieCandidates();
  const tribunalJury = tribunalTieCandidates.length > 1 ? contextBuilder.getActiveJury() : [];
  if (tribunalJury.length > 0) {
    juryTiebreakerVotes = {};
    for (const juror of tribunalJury) {
      const jurorAgent = agents.get(juror.playerId);
      if (jurorAgent) {
        const phaseCtx = prepareAgentPhaseContext(
          ctx,
          jurorAgent,
          juror.playerId,
          Phase.VOTE,
          "strategic_decision",
          undefined,
          true,
        );
        const vote = await withEndgameVoteTimeout(
          ctx,
          `${juror.playerName} tribunal jury tiebreaker vote`,
          (signal) => jurorAgent.getEndgameEliminationVote(phaseCtx, {
            signal,
            traceAction: "tribunal-jury-tiebreaker-vote",
            decisionAction: "tribunal-jury-tiebreaker-vote",
            decisionLabel: "Tribunal Jury Tiebreaker Vote",
          }),
          (reason) => fallbackEliminationDecision(ctx, juror.playerId, tribunalTieCandidates, reason),
        );
        const acceptedVote = tribunalTieCandidates.includes(vote.target)
          ? vote
          : fallbackEliminationDecision(ctx, juror.playerId, tribunalTieCandidates, "invalid_model_output");
        juryTiebreakerVotes[juror.playerId] = acceptedVote.target;
        if (acceptedVote.decisionId || acceptedVote.engineFallback) {
          juryTiebreakerSourcePointers.push(
            agentTurnSourcePointer(
              juror.playerId,
              "tribunal-jury-tiebreaker-vote",
              gameState.round,
              Phase.VOTE,
              undefined,
              acceptedVote.engineFallback ? undefined : acceptedVote.decisionId,
              acceptedVote.engineFallback,
            ),
          );
        }
        const targetName = gameState.getPlayerName(acceptedVote.target);
        await assertCanAcceptCommit(ctx);
        logger.emitAgentTurn({
          phase: Phase.VOTE,
          action: "tribunal-jury-tiebreaker-vote",
          actor: { id: juror.playerId, name: juror.playerName, role: "juror" },
          visibility: "private",
          response: {
            target: { id: acceptedVote.target, name: targetName },
            stage: "tribunal",
            ...strategicDecisionResponse(acceptedVote),
          },
          thinking: acceptedVote.thinking,
          reasoningContext: acceptedVote.reasoningContext,
          scope: "system",
          text: `${juror.playerName} jury tiebreaker vote -> ${targetName}`,
        });
      }
    }
  }

  await assertCanAcceptCommit(ctx);
  const eliminatedId = gameState.tallyTribunalVotes(
    juryTiebreakerVotes,
    juryTiebreakerSourcePointers,
    ctx.random,
  );
  const eliminationVoters = getTribunalDecidingVoterNames(ctx, eliminatedId);
  await handleElimination(ctx, eliminatedId, Phase.VOTE, {
    mode: "endgame",
    voteDisclosure: {
      visibility: "public",
      votesReceived: eliminationVoters.length,
      voterNames: eliminationVoters,
    },
  });

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
