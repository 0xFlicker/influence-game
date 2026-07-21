import type { JudgmentSpeechProvenance } from "../canonical-events";
import {
  commitAcceptedFormalSpeech,
  createAcceptedFormalSpeech,
} from "../accepted-formal-speech";
import type { UUID } from "../types";
import { Phase } from "../types";
import type { AgentResponse, TargetDecision } from "../game-runner.types";
import { assertCanAcceptCommit, agentTurnSourcePointer, strategicDecisionResponse, transcriptThinkingFor, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";

type TimedEndgameResult<T> = {
  value: T;
  provenance: "agent" | "timeout";
};

async function withEndgameActionTimeout<T>(
  ctx: PhaseRunnerContext,
  phase: Phase,
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  fallback: () => T,
): Promise<TimedEndgameResult<T>> {
  const timeoutMs = ctx.config.agentActionTimeoutMs;
  if (!timeoutMs || timeoutMs < 1) {
    return { value: await operation(new AbortController().signal), provenance: "agent" };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  type Tagged = { source: "agent" | "timeout"; value: T };
  const operationTagged: Promise<Tagged> = operation(controller.signal).then((value) => ({
    source: "agent" as const,
    value,
  }));
  const timeoutTagged = new Promise<Tagged>((resolve) => {
    timeout = setTimeout(() => {
      ctx.logger.logSystem(`${label} timed out after ${timeoutMs}ms; using House fallback.`, phase);
      resolve({ source: "timeout", value: fallback() });
      controller.abort();
    }, timeoutMs);
  });

  const tagged = await Promise.race([operationTagged, timeoutTagged]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  return { value: tagged.value, provenance: tagged.source };
}

function fallbackMessage(message: string): AgentResponse {
  return { thinking: "House fallback after unresolved endgame action.", message };
}

function finalizePublicSpeech(
  message: string,
  provenance: "agent" | "timeout",
  houseLine: string,
): { text: string; provenance: JudgmentSpeechProvenance } {
  if (message.trim().length > 0) return { text: message, provenance };
  return { text: houseLine, provenance: "fallback" };
}

export async function runReckoningPlea(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.PLEA);
  logger.logSystem("=== RECKONING: PLEA PHASE ===", Phase.PLEA);
  const alivePlayers = gameState.getAlivePlayers();
  const housePlea = "I have no further plea.";

  // Generate concurrently, then commit in stable roster order.
  const generated = await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.PLEA);
      const timed = await withEndgameActionTimeout(
        ctx,
        Phase.PLEA,
        `${player.name} plea`,
        (signal) => agent.getPlea(phaseCtx, { signal }),
        () => fallbackMessage(housePlea),
      );
      return { player, agent, timed };
    }),
  );

  for (const { player, agent, timed } of generated) {
    const { message, thinking, reasoningContext, decisionLog } = timed.value;
    const speechText = finalizePublicSpeech(message, timed.provenance, housePlea);
    await assertCanAcceptCommit(ctx);
    const accepted = createAcceptedFormalSpeech({
      kind: "plea",
      playerId: player.id,
      text: speechText.text,
      provenance: speechText.provenance,
      phase: Phase.PLEA,
      round: gameState.round,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      accepted,
      {
        action: "plea",
        actor: { id: player.id, name: player.name, role: "player" },
        response: { message: speechText.text, ...strategicDecisionResponse({ decisionLog }) },
        thinking,
        reasoningContext,
        transcriptThinking: transcriptThinkingFor(agent, thinking, reasoningContext),
      },
      {
        sourcePointers: [
          agentTurnSourcePointer(player.id, "plea", gameState.round, Phase.PLEA),
        ],
      },
    );
  }

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

  // Generate concurrently; commit + target-map updates happen in stable roster order
  // so one-defense-per-accused context is deterministic under timing permutations.
  const generated = await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.ACCUSATION);
      const fallbackTarget = alivePlayers.find((candidate) => candidate.id !== player.id) ?? player;
      const houseAccusation = `I accuse ${fallbackTarget.name}.`;
      const timed = await withEndgameActionTimeout<{ targetId: UUID; text: string; thinking?: string; reasoningContext?: string }>(
        ctx,
        Phase.ACCUSATION,
        `${player.name} accusation`,
        (signal) => agent.getAccusation(phaseCtx, { signal }),
        () => ({
          targetId: fallbackTarget.id,
          text: houseAccusation,
          thinking: "House fallback after unresolved endgame action.",
        }),
      );
      return { player, agent, timed, houseAccusation };
    }),
  );

  for (const { player, agent, timed, houseAccusation } of generated) {
    const { targetId, text: rawText, thinking, reasoningContext } = timed.value;
    const speechText = finalizePublicSpeech(rawText, timed.provenance, houseAccusation);
    const targetName = gameState.getPlayerName(targetId);
    await assertCanAcceptCommit(ctx);
    const accepted = createAcceptedFormalSpeech({
      kind: "accusation",
      playerId: player.id,
      text: speechText.text,
      provenance: speechText.provenance,
      phase: Phase.ACCUSATION,
      round: gameState.round,
      targetId,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      accepted,
      {
        action: "accusation",
        actor: { id: player.id, name: player.name, role: "player" },
        response: {
          target: { id: targetId, name: targetName },
          accusation: speechText.text,
        },
        thinking,
        reasoningContext,
        transcriptThinking: transcriptThinkingFor(agent, thinking, reasoningContext),
      },
      {
        displayNames: { targetName },
        sourcePointers: [
          agentTurnSourcePointer(player.id, "accusation", gameState.round, Phase.ACCUSATION),
        ],
      },
    );
    // Stable commit order: last accuser in roster order wins for a given target.
    accusations.set(targetId, {
      accuserId: player.id,
      accuserName: player.name,
      text: speechText.text,
    });
  }

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
  const houseDefense = "I stand by my game.";

  // Only accused players defend; generate concurrently, commit in stable roster order.
  const accused = alivePlayers.filter((player) => accusations.has(player.id));
  const generated = await Promise.all(
    accused.map(async (player) => {
      const accusation = accusations.get(player.id)!;
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.DEFENSE);
      const timed = await withEndgameActionTimeout(
        ctx,
        Phase.DEFENSE,
        `${player.name} defense`,
        (signal) => agent.getDefense(phaseCtx, accusation.text, accusation.accuserName, { signal }),
        () => fallbackMessage(houseDefense),
      );
      return { player, agent, timed, accusation };
    }),
  );

  for (const { player, agent, timed, accusation } of generated) {
    const { message: defense, thinking, reasoningContext, decisionLog } = timed.value;
    const speechText = finalizePublicSpeech(defense, timed.provenance, houseDefense);
    await assertCanAcceptCommit(ctx);
    const accepted = createAcceptedFormalSpeech({
      kind: "defense",
      playerId: player.id,
      text: speechText.text,
      provenance: speechText.provenance,
      phase: Phase.DEFENSE,
      round: gameState.round,
      counterpartId: accusation.accuserId,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      accepted,
      {
        action: "tribunal-defense",
        actor: { id: player.id, name: player.name, role: "player" },
        response: {
          message: speechText.text,
          accuser: { id: accusation.accuserId, name: accusation.accuserName },
          accusation: accusation.text,
          ...strategicDecisionResponse({ decisionLog }),
        },
        thinking,
        reasoningContext,
        transcriptThinking: transcriptThinkingFor(agent, thinking, reasoningContext),
      },
      {
        sourcePointers: [
          agentTurnSourcePointer(player.id, "tribunal-defense", gameState.round, Phase.DEFENSE),
        ],
      },
    );
  }

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runJudgmentOpening(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  await assertCanAcceptCommit(ctx);
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
  const houseOpening = "I will let my game speak for itself.";

  const generated = await Promise.all(
    finalists.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.OPENING_STATEMENTS);
      const timed = await withEndgameActionTimeout(
        ctx,
        Phase.OPENING_STATEMENTS,
        `${player.name} opening statement`,
        (signal) => agent.getOpeningStatement(phaseCtx, { signal }),
        () => fallbackMessage(houseOpening),
      );
      return { player, agent, timed };
    }),
  );

  for (const { player, agent, timed } of generated) {
    const { message, thinking, reasoningContext, decisionLog } = timed.value;
    const speech = finalizePublicSpeech(message, timed.provenance, houseOpening);
    await assertCanAcceptCommit(ctx);
    const accepted = createAcceptedFormalSpeech({
      kind: "opening_statement",
      playerId: player.id,
      text: speech.text,
      provenance: speech.provenance,
      phase: Phase.OPENING_STATEMENTS,
      round: gameState.round,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      accepted,
      {
        action: "opening-statement",
        actor: { id: player.id, name: player.name, role: "player" },
        response: { message: speech.text, ...strategicDecisionResponse({ decisionLog }) },
        thinking,
        reasoningContext,
        transcriptThinking: transcriptThinkingFor(agent, thinking, reasoningContext),
      },
      {
        sourcePointers: [
          agentTurnSourcePointer(player.id, "opening-statement", gameState.round, Phase.OPENING_STATEMENTS),
        ],
      },
    );
  }

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
    const houseQuestion = "Why should the jury trust your game?";
    const questionTimed = await withEndgameActionTimeout<{ targetFinalistId: UUID; question: string; thinking?: string; reasoningContext?: string }>(
      ctx,
      Phase.JURY_QUESTIONS,
      `${juror.playerName} jury question`,
      (signal) => jurorAgent.getJuryQuestion(jurorCtx, finalistIds, { signal }),
      () => ({
        targetFinalistId: finalist0.id,
        question: houseQuestion,
        thinking: "House fallback after unresolved endgame action.",
      }),
    );
    const {
      targetFinalistId,
      question: rawQuestion,
      thinking: questionThinking,
      reasoningContext: questionReasoning,
    } = questionTimed.value;
    const questionSpeech = finalizePublicSpeech(rawQuestion, questionTimed.provenance, houseQuestion);
    const finalistName = gameState.getPlayerName(targetFinalistId);
    await assertCanAcceptCommit(ctx);
    const questionAccepted = createAcceptedFormalSpeech({
      kind: "jury_question",
      playerId: juror.playerId,
      text: questionSpeech.text,
      provenance: questionSpeech.provenance,
      phase: Phase.JURY_QUESTIONS,
      round: gameState.round,
      counterpartId: targetFinalistId,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      questionAccepted,
      {
        action: "jury-question",
        actor: { id: juror.playerId, name: juror.playerName, role: "juror" },
        response: {
          targetFinalist: { id: targetFinalistId, name: finalistName },
          question: questionSpeech.text,
        },
        thinking: questionThinking,
        reasoningContext: questionReasoning,
        transcriptThinking: transcriptThinkingFor(jurorAgent, questionThinking, questionReasoning),
      },
      {
        displayNames: { counterpartName: finalistName },
        sourcePointers: [
          agentTurnSourcePointer(juror.playerId, "jury-question", gameState.round, Phase.JURY_QUESTIONS),
        ],
      },
    );

    const finalistAgent = agents.get(targetFinalistId);
    if (finalistAgent) {
      const houseAnswer = "I played the best game I could.";
      const finalistCtx = contextBuilder.buildPhaseContext(targetFinalistId, Phase.JURY_QUESTIONS);
      const answerTimed = await withEndgameActionTimeout(
        ctx,
        Phase.JURY_QUESTIONS,
        `${finalistName} jury answer`,
        (signal) => finalistAgent.getJuryAnswer(finalistCtx, questionSpeech.text, juror.playerName, { signal }),
        () => fallbackMessage(houseAnswer),
      );
      const {
        message: rawAnswer,
        thinking: answerThinking,
        reasoningContext: answerReasoning,
        decisionLog: answerDecisionLog,
      } = answerTimed.value;
      const answerSpeech = finalizePublicSpeech(rawAnswer, answerTimed.provenance, houseAnswer);
      await assertCanAcceptCommit(ctx);
      const answerAccepted = createAcceptedFormalSpeech({
        kind: "jury_answer",
        playerId: targetFinalistId,
        text: answerSpeech.text,
        provenance: answerSpeech.provenance,
        phase: Phase.JURY_QUESTIONS,
        round: gameState.round,
        counterpartId: juror.playerId,
      });
      commitAcceptedFormalSpeech(
        { gameState, logger },
        answerAccepted,
        {
          action: "jury-answer",
          actor: { id: targetFinalistId, name: finalistName, role: "player" },
          response: {
            message: answerSpeech.text,
            juror: { id: juror.playerId, name: juror.playerName },
            question: questionSpeech.text,
            ...strategicDecisionResponse({ decisionLog: answerDecisionLog }),
          },
          thinking: answerThinking,
          reasoningContext: answerReasoning,
          transcriptThinking: transcriptThinkingFor(finalistAgent, answerThinking, answerReasoning),
        },
        {
          displayNames: { counterpartName: juror.playerName },
          sourcePointers: [
            agentTurnSourcePointer(targetFinalistId, "jury-answer", gameState.round, Phase.JURY_QUESTIONS),
          ],
        },
      );
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
  const houseClosing = "Vote for the game you respect most.";

  const generated = await Promise.all(
    finalists.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.CLOSING_ARGUMENTS);
      const timed = await withEndgameActionTimeout(
        ctx,
        Phase.CLOSING_ARGUMENTS,
        `${player.name} closing argument`,
        (signal) => agent.getClosingArgument(phaseCtx, { signal }),
        () => fallbackMessage(houseClosing),
      );
      return { player, agent, timed };
    }),
  );

  for (const { player, agent, timed } of generated) {
    const { message, thinking, reasoningContext, decisionLog } = timed.value;
    const speech = finalizePublicSpeech(message, timed.provenance, houseClosing);
    await assertCanAcceptCommit(ctx);
    const accepted = createAcceptedFormalSpeech({
      kind: "closing_argument",
      playerId: player.id,
      text: speech.text,
      provenance: speech.provenance,
      phase: Phase.CLOSING_ARGUMENTS,
      round: gameState.round,
    });
    commitAcceptedFormalSpeech(
      { gameState, logger },
      accepted,
      {
        action: "closing-argument",
        actor: { id: player.id, name: player.name, role: "player" },
        response: { message: speech.text, ...strategicDecisionResponse({ decisionLog }) },
        thinking,
        reasoningContext,
        transcriptThinking: transcriptThinkingFor(agent, thinking, reasoningContext),
      },
      {
        sourcePointers: [
          agentTurnSourcePointer(player.id, "closing-argument", gameState.round, Phase.CLOSING_ARGUMENTS),
        ],
      },
    );
  }

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
    const { value: vote } = await withEndgameActionTimeout<TargetDecision>(
      ctx,
      Phase.JURY_VOTE,
      `${juror.playerName} jury vote`,
      (signal) => jurorAgent.getJuryVote(phaseCtx, finalistIds, { signal }),
      () => ({
        target: finalist0.id,
        thinking: "House fallback after unresolved jury vote.",
      }),
    );
    await assertCanAcceptCommit(ctx);
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
        ...strategicDecisionResponse(vote),
      },
      thinking: vote.thinking,
      reasoningContext: vote.reasoningContext,
      scope: "system",
      text: `${juror.playerName} (juror) votes for: ${targetName}`,
    });
  }

  await assertCanAcceptCommit(ctx);
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
    await assertCanAcceptCommit(ctx);
    gameState.eliminatePlayer(loserId);
  }

  actor.send({ type: "JURY_WINNER_DETERMINED", winnerId });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
