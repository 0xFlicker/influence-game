import type { UUID } from "../types";
import { Phase } from "../types";
import type { CandidateChoiceRequest, TargetDecision } from "../game-runner.types";
import type { InitialExposureBenchResolution } from "../exposure-bench";
import { buildPostVotePressureProjection, formatPostVotePressureSummary } from "../post-vote-pressure";
import { assertCanAcceptCommit, agentTurnSourcePointer, strategicDecisionResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";
import {
  getEndgameEliminationVoterNames,
  handleElimination,
} from "./elimination";

async function withEndgameVoteTimeout(
  ctx: PhaseRunnerContext,
  label: string,
  operation: (signal: AbortSignal) => Promise<TargetDecision>,
  fallback: () => TargetDecision,
): Promise<TargetDecision> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) return operation(new AbortController().signal);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<TargetDecision>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(`${label} timed out after ${timeoutMs}ms; using House fallback.`, Phase.VOTE);
      resolve(fallback());
      controller.abort();
    }, timeoutMs);
  });

  return Promise.race([operation(controller.signal), timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function fallbackEliminationTarget(ctx: PhaseRunnerContext, voterId: UUID): UUID {
  return ctx.gameState.getAlivePlayerIds().find((id) => id !== voterId) ?? voterId;
}

function fallbackEliminationDecision(ctx: PhaseRunnerContext, voterId: UUID): TargetDecision {
  return {
    target: fallbackEliminationTarget(ctx, voterId),
    thinking: "House fallback after unresolved endgame vote.",
  };
}

function shouldRequestCandidateChoice(resolution: InitialExposureBenchResolution): boolean {
  return resolution.choice.requiredCount > 0 && resolution.choice.eligibleCandidateIds.length > resolution.choice.requiredCount;
}

function candidateChoiceRequest(resolution: InitialExposureBenchResolution): CandidateChoiceRequest {
  return {
    lockedCandidateIds: resolution.lockedCandidates,
    eligibleCandidateIds: resolution.choice.eligibleCandidateIds,
    requiredCount: resolution.choice.requiredCount,
    mode: resolution.mode,
    fallbackReason: resolution.fallbackReason,
  };
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
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
      const votes = await agent.getVotes(phaseCtx);

      await assertCanAcceptCommit(ctx);
      const voteDecisionId = agent.getLastPrivateDecisionId?.();
      gameState.recordVote(player.id, votes.empowerTarget, votes.exposeTarget, [
        agentTurnSourcePointer(
          player.id,
          "vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          voteDecisionId,
        ),
      ]);

      const empowerName = gameState.getPlayerName(votes.empowerTarget);
      const exposeName = gameState.getPlayerName(votes.exposeTarget);
      const transcriptThinking = transcriptThinkingFor(agent, votes.thinking, votes.reasoningContext);
      logger.logSystem(
        `${player.name} votes: empower=${empowerName}, expose=${exposeName}`,
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
          exposeTarget: { id: votes.exposeTarget, name: exposeName },
          ...strategicDecisionResponse(votes),
        },
        thinking: votes.thinking,
        reasoningContext: votes.reasoningContext,
        scope: "system",
        text: `${player.name} votes: empower=${empowerName}, expose=${exposeName}`,
      });
    }),
  );

  const originalVotesByPlayerId = new Map<UUID, { empowerTarget: UUID; exposeTarget: UUID }>();
  for (const player of alivePlayers) {
    const empowerTarget = gameState.currentVoteTally.empowerVotes[player.id];
    const exposeTarget = gameState.currentVoteTally.exposeVotes[player.id];
    if (empowerTarget && exposeTarget) {
      originalVotesByPlayerId.set(player.id, { empowerTarget, exposeTarget });
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
          const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
          const originalVote = originalVotesByPlayerId.get(player.id) ?? {
            empowerTarget: gameState.currentVoteTally.empowerVotes[player.id] ?? tied[0]!,
            exposeTarget: gameState.currentVoteTally.exposeVotes[player.id] ?? tied[0]!,
          };
          const revote = await agent.getEmpowerRevote(phaseCtx, tied, originalVote);
          const empowerTarget = tied.includes(revote.empowerTarget) ? revote.empowerTarget : tied[0]!;
          await assertCanAcceptCommit(ctx);
          gameState.recordEmpowerReVote(player.id, empowerTarget, [
            agentTurnSourcePointer(player.id, "empower-revote", gameState.round, Phase.VOTE),
          ]);
          revoteTargetsByPlayerId.set(player.id, empowerTarget);
          const empowerName = gameState.getPlayerName(empowerTarget);
          const transcriptThinking = transcriptThinkingFor(agent, revote.thinking, revote.reasoningContext);
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
                exposeTarget: { id: originalVote.exposeTarget, name: gameState.getPlayerName(originalVote.exposeTarget) },
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
        exposeTargetId: originalVote.exposeTarget,
        exposeTargetName: gameState.getPlayerName(originalVote.exposeTarget),
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
  const initialPreview = gameState.previewInitialCandidateResolution();
  let initialResolution: InitialExposureBenchResolution | null = initialPreview;
  if (initialPreview && shouldRequestCandidateChoice(initialPreview)) {
    const empoweredAgent = agents.get(empoweredId);
    const request = candidateChoiceRequest(initialPreview);
    const phaseCtx = contextBuilder.buildPhaseContext(empoweredId, Phase.VOTE, { empoweredId });
    const decision = empoweredAgent?.getCandidateSelection
      ? await empoweredAgent.getCandidateSelection(phaseCtx, request)
      : {
          selectedCandidateIds: request.eligibleCandidateIds.slice(0, request.requiredCount),
          thinking: "House fallback: empowered candidate selection method unavailable.",
        };
    await assertCanAcceptCommit(ctx);
    initialResolution = gameState.resolveInitialCandidates(decision.selectedCandidateIds);
    const resolvedCandidates = initialResolution?.candidates ?? null;
    logger.emitAgentTurn({
      phase: Phase.VOTE,
      action: "candidate-selection",
      actor: { id: empoweredId, name: gameState.getPlayerName(empoweredId), role: "player" },
      visibility: "private",
      response: {
        mode: initialResolution?.mode ?? request.mode,
        lockedCandidates: request.lockedCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        eligibleChoices: request.eligibleCandidateIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
        selectedCandidates: (initialResolution?.selectedCandidateIds ?? decision.selectedCandidateIds).map((id) => ({ id, name: gameState.getPlayerName(id) })),
        resolvedCandidates: resolvedCandidates?.map((id) => ({ id, name: gameState.getPlayerName(id) })) ?? null,
        fallbackApplied: initialResolution?.fallbackApplied ?? false,
        fallbackReason: initialResolution?.fallbackReason ?? null,
        ...strategicDecisionResponse(decision),
      },
      thinking: decision.thinking,
      reasoningContext: decision.reasoningContext,
      scope: "system",
      text: `${gameState.getPlayerName(empoweredId)} privately resolved Council candidate ambiguity.`,
    });
  } else {
    initialResolution = gameState.resolveInitialCandidates();
  }
  if (initialResolution?.candidates) {
    logger.logSystem(
      `Initial Council pair resolved before Mingle: ${initialResolution.candidates.map((id) => gameState.getPlayerName(id)).join(" and ")} (${initialResolution.mode})`,
      Phase.VOTE,
    );
  }
  contextBuilder.currentPostVotePressure = buildPostVotePressureProjection({
    alivePlayers: gameState.getAlivePlayers(),
    exposeScores: gameState.getExposeScores(),
    empoweredId,
    initialResolution,
  });
  if (contextBuilder.currentPostVotePressure) {
    logger.logSystem(
      formatPostVotePressureSummary(contextBuilder.currentPostVotePressure),
      Phase.VOTE,
    );
  }

  // Update agent memory
  const voteTally = gameState.currentVoteTally;
  for (const [voterId, empowerTargetId] of Object.entries(voteTally.empowerVotes)) {
    const agent = agents.get(voterId as UUID);
    if (agent) {
      const empowerName = gameState.getPlayerName(empowerTargetId);
      agent.updateAlly(empowerName);
    }
  }
  for (const [voterId, exposeTargetId] of Object.entries(voteTally.exposeVotes)) {
    const agent = agents.get(voterId as UUID);
    if (agent) {
      const exposeName = gameState.getPlayerName(exposeTargetId);
      agent.updateThreat(exposeName);
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
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.VOTE);
  logger.logSystem("=== RECKONING: ELIMINATION VOTE ===", Phase.VOTE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
      const vote = await withEndgameVoteTimeout(
        ctx,
        `${player.name} reckoning vote`,
        (signal) => agent.getEndgameEliminationVote(phaseCtx, { signal }),
        () => fallbackEliminationDecision(ctx, player.id),
      );
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, vote.target, [
        agentTurnSourcePointer(player.id, "endgame-elimination-vote", gameState.round, Phase.VOTE),
      ]);
      const targetName = gameState.getPlayerName(vote.target);
      const transcriptThinking = transcriptThinkingFor(agent, vote.thinking, vote.reasoningContext);
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
          target: { id: vote.target, name: targetName },
          stage: "reckoning",
          ...strategicDecisionResponse(vote),
        },
        thinking: vote.thinking,
        reasoningContext: vote.reasoningContext,
        scope: "system",
        text: `${player.name} votes to eliminate: ${targetName}`,
      });
    }),
  );

  await assertCanAcceptCommit(ctx);
  const eliminatedId = gameState.tallyEndgameEliminationVotes();
  await handleElimination(ctx, eliminatedId, Phase.VOTE, {
    mode: "endgame",
    eliminationVoters: getEndgameEliminationVoterNames(ctx, eliminatedId),
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
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.VOTE);
      const vote = await withEndgameVoteTimeout(
        ctx,
        `${player.name} tribunal vote`,
        (signal) => agent.getEndgameEliminationVote(phaseCtx, { signal }),
        () => fallbackEliminationDecision(ctx, player.id),
      );
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, vote.target, [
        agentTurnSourcePointer(player.id, "endgame-elimination-vote", gameState.round, Phase.VOTE),
      ]);
      const targetName = gameState.getPlayerName(vote.target);
      const transcriptThinking = transcriptThinkingFor(agent, vote.thinking, vote.reasoningContext);
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
          target: { id: vote.target, name: targetName },
          stage: "tribunal",
          ...strategicDecisionResponse(vote),
        },
        thinking: vote.thinking,
        reasoningContext: vote.reasoningContext,
        scope: "system",
        text: `${player.name} votes to eliminate: ${targetName}`,
      });
    }),
  );

  // Tribunal: jury only weighs in when the live vote is actually tied.
  let juryTiebreakerVotes: Record<UUID, UUID> | undefined;
  const tribunalTieCandidates = gameState.getTribunalEliminationTieCandidates();
  const tribunalJury = tribunalTieCandidates.length > 1 ? contextBuilder.getActiveJury() : [];
  if (tribunalJury.length > 0) {
    juryTiebreakerVotes = {};
    for (const juror of tribunalJury) {
      const jurorAgent = agents.get(juror.playerId);
      if (jurorAgent) {
        const phaseCtx = contextBuilder.buildPhaseContext(juror.playerId, Phase.VOTE, undefined, true);
        const vote = await withEndgameVoteTimeout(
          ctx,
          `${juror.playerName} tribunal jury tiebreaker vote`,
          (signal) => jurorAgent.getEndgameEliminationVote(phaseCtx, {
            signal,
            traceAction: "tribunal-jury-tiebreaker-vote",
            decisionAction: "tribunal-jury-tiebreaker-vote",
            decisionLabel: "Tribunal Jury Tiebreaker Vote",
          }),
          () => fallbackEliminationDecision(ctx, juror.playerId),
        );
        juryTiebreakerVotes[juror.playerId] = vote.target;
        const targetName = gameState.getPlayerName(vote.target);
        await assertCanAcceptCommit(ctx);
        logger.emitAgentTurn({
          phase: Phase.VOTE,
          action: "tribunal-jury-tiebreaker-vote",
          actor: { id: juror.playerId, name: juror.playerName, role: "juror" },
          visibility: "private",
          response: {
            target: { id: vote.target, name: targetName },
            stage: "tribunal",
            ...strategicDecisionResponse(vote),
          },
          thinking: vote.thinking,
          reasoningContext: vote.reasoningContext,
          scope: "system",
          text: `${juror.playerName} jury tiebreaker vote -> ${targetName}`,
        });
      }
    }
  }

  await assertCanAcceptCommit(ctx);
  const eliminatedId = gameState.tallyTribunalVotes(juryTiebreakerVotes);
  await handleElimination(ctx, eliminatedId, Phase.VOTE, {
    mode: "endgame",
    eliminationVoters: getEndgameEliminationVoterNames(ctx, eliminatedId),
  });

  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
