import type { UUID } from "../types";
import { Phase } from "../types";
import type { AgentResponse, TargetDecision } from "../game-runner.types";
import { agentTurnSourcePointer, strategyPacketUseResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";

async function withEndgameActionTimeout<T>(
  ctx: PhaseRunnerContext,
  phase: Phase,
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) return operation(new AbortController().signal);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(`${label} timed out after ${timeoutMs}ms; using House fallback.`, phase);
      resolve(fallback());
      controller.abort();
    }, timeoutMs);
  });

  return Promise.race([operation(controller.signal), timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function fallbackMessage(message: string): AgentResponse {
  return { thinking: "House fallback after unresolved endgame action.", message };
}

export async function runReckoningPlea(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.PLEA);
  logger.logSystem("=== RECKONING: PLEA PHASE ===", Phase.PLEA);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.PLEA);
      const { message, thinking, reasoningContext, strategyPacketUse } = await withEndgameActionTimeout(
        ctx,
        Phase.PLEA,
        `${player.name} plea`,
        (signal) => agent.getPlea(phaseCtx, { signal }),
        () => fallbackMessage("I have no further plea."),
      );
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.PLEA, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.PLEA,
        action: "plea",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: { message, ...strategyPacketUseResponse(strategyPacketUse) },
        thinking,
        reasoningContext,
        scope: "public",
        text: message,
      });
    }),
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runTribunalAccusation(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  accusations: Map<UUID, { accuserId: UUID; accuserName: string; text: string }>,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.ACCUSATION);
  logger.logSystem("=== TRIBUNAL: ACCUSATION PHASE ===", Phase.ACCUSATION);
  const alivePlayers = gameState.getAlivePlayers();
  accusations.clear();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.ACCUSATION);
      const fallbackTarget = alivePlayers.find((candidate) => candidate.id !== player.id) ?? player;
      const { targetId, text, thinking, reasoningContext } = await withEndgameActionTimeout<{ targetId: UUID; text: string; thinking?: string; reasoningContext?: string }>(
        ctx,
        Phase.ACCUSATION,
        `${player.name} accusation`,
        (signal) => agent.getAccusation(phaseCtx, { signal }),
        () => ({
          targetId: fallbackTarget.id,
          text: `I accuse ${fallbackTarget.name}.`,
          thinking: "House fallback after unresolved endgame action.",
        }),
      );
      const targetName = gameState.getPlayerName(targetId);
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, `[ACCUSES ${targetName}] ${text}`, Phase.ACCUSATION, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.ACCUSATION,
        action: "accusation",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: {
          target: { id: targetId, name: targetName },
          accusation: text,
        },
        thinking,
        reasoningContext,
        scope: "public",
        text: `[ACCUSES ${targetName}] ${text}`,
      });
      accusations.set(targetId, {
        accuserId: player.id,
        accuserName: player.name,
        text,
      });
    }),
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runTribunalDefense(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  accusations: Map<UUID, { accuserId: UUID; accuserName: string; text: string }>,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.DEFENSE);
  logger.logSystem("=== TRIBUNAL: DEFENSE PHASE ===", Phase.DEFENSE);
  const alivePlayers = gameState.getAlivePlayers();

  await Promise.all(
    alivePlayers.map(async (player) => {
      const accusation = accusations.get(player.id);
      if (!accusation) return;

      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.DEFENSE);
      const { message: defense, thinking, reasoningContext, strategyPacketUse } = await withEndgameActionTimeout(
        ctx,
        Phase.DEFENSE,
        `${player.name} defense`,
        (signal) => agent.getDefense(phaseCtx, accusation.text, accusation.accuserName, { signal }),
        () => fallbackMessage("I stand by my game."),
      );
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, `[DEFENSE] ${defense}`, Phase.DEFENSE, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.DEFENSE,
        action: "tribunal-defense",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: {
          message: defense,
          accuser: { id: accusation.accuserId, name: accusation.accuserName },
          accusation: accusation.text,
          ...strategyPacketUseResponse(strategyPacketUse),
        },
        thinking,
        reasoningContext,
        scope: "public",
        text: `[DEFENSE] ${defense}`,
      });
    }),
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runJudgmentOpening(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  gameState.setEndgameStage("judgment");
  logger.emitPhaseChange(Phase.OPENING_STATEMENTS);
  logger.logSystem(`\n========================================`, Phase.OPENING_STATEMENTS);
  logger.logSystem(`=== THE JUDGMENT ===`, Phase.OPENING_STATEMENTS);
  logger.logSystem(`========================================`, Phase.OPENING_STATEMENTS);
  logger.logSystem(`Finalists: ${gameState.getAlivePlayers().map((p) => p.name).join(" vs ")}`, Phase.OPENING_STATEMENTS);
  const activeJury = contextBuilder.getActiveJury();
  const excludedJurors = gameState.jury.filter(
    (j) => !activeJury.some((aj) => aj.playerId === j.playerId),
  );
  logger.logSystem(`Jury (${activeJury.length}): ${activeJury.map((j) => j.playerName).join(", ")}`, Phase.OPENING_STATEMENTS);
  if (excludedJurors.length > 0) {
    logger.logSystem(`Eliminated too early for jury: ${excludedJurors.map((j) => j.playerName).join(", ")}`, Phase.OPENING_STATEMENTS);
  }

  logger.logSystem("=== JUDGMENT: OPENING STATEMENTS ===", Phase.OPENING_STATEMENTS);
  const finalists = gameState.getAlivePlayers();

  await Promise.all(
    finalists.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.OPENING_STATEMENTS);
      const { message, thinking, reasoningContext, strategyPacketUse } = await withEndgameActionTimeout(
        ctx,
        Phase.OPENING_STATEMENTS,
        `${player.name} opening statement`,
        (signal) => agent.getOpeningStatement(phaseCtx, { signal }),
        () => fallbackMessage("I will let my game speak for itself."),
      );
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.OPENING_STATEMENTS, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.OPENING_STATEMENTS,
        action: "opening-statement",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: { message, ...strategyPacketUseResponse(strategyPacketUse) },
        thinking,
        reasoningContext,
        scope: "public",
        text: message,
      });
    }),
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runJudgmentJuryQuestions(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.JURY_QUESTIONS);
  logger.logSystem("=== JUDGMENT: JURY QUESTIONS ===", Phase.JURY_QUESTIONS);
  const finalists = gameState.getAlivePlayers();
  const finalist0 = finalists[0];
  const finalist1 = finalists[1];
  if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury questions phase");
  const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

  for (const juror of contextBuilder.getActiveJury()) {
    const jurorAgent = agents.get(juror.playerId);
    if (!jurorAgent) continue;

    const jurorCtx = contextBuilder.buildPhaseContext(juror.playerId, Phase.JURY_QUESTIONS);
    const { targetFinalistId, question, thinking: questionThinking, reasoningContext: questionReasoning } = await withEndgameActionTimeout<{ targetFinalistId: UUID; question: string; thinking?: string; reasoningContext?: string }>(
      ctx,
      Phase.JURY_QUESTIONS,
      `${juror.playerName} jury question`,
      (signal) => jurorAgent.getJuryQuestion(jurorCtx, finalistIds, { signal }),
      () => ({
        targetFinalistId: finalist0.id,
        question: "Why should the jury trust your game?",
        thinking: "House fallback after unresolved endgame action.",
      }),
    );
    const finalistName = gameState.getPlayerName(targetFinalistId);
    const questionTranscriptThinking = transcriptThinkingFor(jurorAgent, questionThinking, questionReasoning);
    logger.logPublic(juror.playerId, `[QUESTION to ${finalistName}] ${question}`, Phase.JURY_QUESTIONS, questionTranscriptThinking);
    logger.emitAgentTurn({
      phase: Phase.JURY_QUESTIONS,
      action: "jury-question",
      actor: { id: juror.playerId, name: juror.playerName, role: "juror" },
      visibility: "public",
      response: {
        targetFinalist: { id: targetFinalistId, name: finalistName },
        question,
      },
      thinking: questionThinking,
      reasoningContext: questionReasoning,
      scope: "public",
      text: `[QUESTION to ${finalistName}] ${question}`,
    });

    const finalistAgent = agents.get(targetFinalistId);
    if (finalistAgent) {
      const finalistCtx = contextBuilder.buildPhaseContext(targetFinalistId, Phase.JURY_QUESTIONS);
      const { message: answer, thinking: answerThinking, reasoningContext: answerReasoning, strategyPacketUse: answerStrategyPacketUse } = await withEndgameActionTimeout(
        ctx,
        Phase.JURY_QUESTIONS,
        `${finalistName} jury answer`,
        (signal) => finalistAgent.getJuryAnswer(finalistCtx, question, juror.playerName, { signal }),
        () => fallbackMessage("I played the best game I could."),
      );
      const answerTranscriptThinking = transcriptThinkingFor(finalistAgent, answerThinking, answerReasoning);
      logger.logPublic(targetFinalistId, `[ANSWER to ${juror.playerName}] ${answer}`, Phase.JURY_QUESTIONS, answerTranscriptThinking);
      logger.emitAgentTurn({
        phase: Phase.JURY_QUESTIONS,
        action: "jury-answer",
        actor: { id: targetFinalistId, name: finalistName, role: "player" },
        visibility: "public",
        response: {
          message: answer,
          juror: { id: juror.playerId, name: juror.playerName },
          question,
          ...strategyPacketUseResponse(answerStrategyPacketUse),
        },
        thinking: answerThinking,
        reasoningContext: answerReasoning,
        scope: "public",
        text: `[ANSWER to ${juror.playerName}] ${answer}`,
      });
    }
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runJudgmentClosing(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.CLOSING_ARGUMENTS);
  logger.logSystem("=== JUDGMENT: CLOSING ARGUMENTS ===", Phase.CLOSING_ARGUMENTS);
  const finalists = gameState.getAlivePlayers();

  await Promise.all(
    finalists.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.CLOSING_ARGUMENTS);
      const { message, thinking, reasoningContext, strategyPacketUse } = await withEndgameActionTimeout(
        ctx,
        Phase.CLOSING_ARGUMENTS,
        `${player.name} closing argument`,
        (signal) => agent.getClosingArgument(phaseCtx, { signal }),
        () => fallbackMessage("Vote for the game you respect most."),
      );
      const transcriptThinking = transcriptThinkingFor(agent, thinking, reasoningContext);
      logger.logPublic(player.id, message, Phase.CLOSING_ARGUMENTS, transcriptThinking);
      logger.emitAgentTurn({
        phase: Phase.CLOSING_ARGUMENTS,
        action: "closing-argument",
        actor: { id: player.id, name: player.name, role: "player" },
        visibility: "public",
        response: { message, ...strategyPacketUseResponse(strategyPacketUse) },
        thinking,
        reasoningContext,
        scope: "public",
        text: message,
      });
    }),
  );

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runJudgmentJuryVote(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.JURY_VOTE);
  logger.logSystem("=== JUDGMENT: JURY VOTE ===", Phase.JURY_VOTE);
  const finalists = gameState.getAlivePlayers();
  const finalist0 = finalists[0];
  const finalist1 = finalists[1];
  if (!finalist0 || !finalist1) throw new Error("Expected exactly 2 finalists for jury vote phase");
  const finalistIds: [UUID, UUID] = [finalist0.id, finalist1.id];

  const votingJury = contextBuilder.getActiveJury();

  for (const juror of votingJury) {
    const jurorAgent = agents.get(juror.playerId);
    if (!jurorAgent) continue;

    const phaseCtx = contextBuilder.buildPhaseContext(juror.playerId, Phase.JURY_VOTE);
    const vote = await withEndgameActionTimeout<TargetDecision>(
      ctx,
      Phase.JURY_VOTE,
      `${juror.playerName} jury vote`,
      (signal) => jurorAgent.getJuryVote(phaseCtx, finalistIds, { signal }),
      () => ({
        target: finalist0.id,
        thinking: "House fallback after unresolved jury vote.",
      }),
    );
    gameState.recordJuryVote(juror.playerId, vote.target, [
      agentTurnSourcePointer(juror.playerId, "jury-vote", gameState.round, Phase.JURY_VOTE),
    ]);
    const targetName = gameState.getPlayerName(vote.target);
    const voteTranscriptThinking = transcriptThinkingFor(jurorAgent, vote.thinking, vote.reasoningContext);
    logger.logSystem(
      `${juror.playerName} (juror) votes for: ${targetName}`,
      Phase.JURY_VOTE,
      voteTranscriptThinking.thinking,
      voteTranscriptThinking.reasoningContext,
    );
    logger.emitAgentTurn({
      phase: Phase.JURY_VOTE,
      action: "jury-vote",
      actor: { id: juror.playerId, name: juror.playerName, role: "juror" },
      visibility: "private",
      response: {
        target: { id: vote.target, name: targetName },
        finalists: finalistIds.map((id) => ({ id, name: gameState.getPlayerName(id) })),
      },
      thinking: vote.thinking,
      reasoningContext: vote.reasoningContext,
      scope: "system",
      text: `${juror.playerName} (juror) votes for: ${targetName}`,
    });
  }

  const { winnerId, method, voteCounts } = gameState.tallyJuryVotes();
  const winnerName = gameState.getPlayerName(winnerId);

  for (const vc of voteCounts) {
    logger.logSystem(`Jury votes for ${vc.name}: ${vc.votes}`, Phase.JURY_VOTE);
  }

  if (method === "majority") {
    logger.logSystem(`Winner determined by jury majority vote.`, Phase.JURY_VOTE);
  } else if (method === "empower_tiebreaker") {
    logger.logSystem(`Jury vote tied! Tiebreaker: ${winnerName} wins with more cumulative empower votes (social capital).`, Phase.JURY_VOTE);
  } else {
    logger.logSystem(`Jury vote tied and empower votes tied! Tiebreaker: ${winnerName} wins by random selection.`, Phase.JURY_VOTE);
  }

  logger.logSystem(`\n*** THE WINNER IS: ${winnerName} ***`, Phase.JURY_VOTE);

  const loserId = finalistIds.find((id) => id !== winnerId);
  if (loserId) {
    gameState.eliminatePlayer(loserId);
  }

  actor.send({ type: "JURY_WINNER_DETERMINED", winnerId });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
