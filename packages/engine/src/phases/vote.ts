import type { UUID } from "../types";
import { Phase } from "../types";
import type { TargetDecision } from "../game-runner.types";
import {
  assertCanAcceptCommit,
  agentTurnSourcePointer,
  prepareAgentPhaseContext,
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
      const votes = await agent.getVotes(phaseCtx);

      await assertCanAcceptCommit(ctx);
      // Format kernel: empower-only ballot. exposeTarget intentionally omitted.
      gameState.recordVote(player.id, votes.empowerTarget, null, [
        agentTurnSourcePointer(
          player.id,
          "vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          votes.decisionId,
        ),
      ]);

      const empowerName = gameState.getPlayerName(votes.empowerTarget);
      const transcriptThinking = transcriptThinkingFor(agent, votes.thinking, votes.reasoningContext);
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
          const revote = await agent.getEmpowerRevote(phaseCtx, tied, originalVote);
          const acceptedDirectly = tied.includes(revote.empowerTarget);
          const empowerTarget = acceptedDirectly ? revote.empowerTarget : tied[0]!;
          await assertCanAcceptCommit(ctx);
          gameState.recordEmpowerReVote(player.id, empowerTarget, [
            agentTurnSourcePointer(
              player.id,
              "empower-revote",
              gameState.round,
              Phase.VOTE,
              undefined,
              acceptedDirectly ? revote.decisionId : undefined,
            ),
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
        () => fallbackEliminationDecision(ctx, player.id),
      );
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, vote.target, [
        agentTurnSourcePointer(
          player.id,
          "elimination-vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          vote.decisionId,
        ),
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
        () => fallbackEliminationDecision(ctx, player.id),
      );
      await assertCanAcceptCommit(ctx);
      gameState.recordEndgameEliminationVote(player.id, vote.target, [
        agentTurnSourcePointer(
          player.id,
          "elimination-vote",
          gameState.round,
          Phase.VOTE,
          undefined,
          vote.decisionId,
        ),
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
          () => fallbackEliminationDecision(ctx, juror.playerId),
        );
        juryTiebreakerVotes[juror.playerId] = vote.target;
        if (vote.decisionId && tribunalTieCandidates.includes(vote.target)) {
          juryTiebreakerSourcePointers.push(
            agentTurnSourcePointer(
              juror.playerId,
              "tribunal-jury-tiebreaker-vote",
              gameState.round,
              Phase.VOTE,
              undefined,
              vote.decisionId,
            ),
          );
        }
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
  const eliminatedId = gameState.tallyTribunalVotes(
    juryTiebreakerVotes,
    juryTiebreakerSourcePointers,
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
