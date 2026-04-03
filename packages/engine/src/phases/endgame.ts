import type { UUID } from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

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
      const text = await agent.getPlea(phaseCtx);
      logger.logPublic(player.id, text, Phase.PLEA);
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
      const { targetId, text } = await agent.getAccusation(phaseCtx);
      const targetName = gameState.getPlayerName(targetId);
      logger.logPublic(player.id, `[ACCUSES ${targetName}] ${text}`, Phase.ACCUSATION);
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
      const defense = await agent.getDefense(phaseCtx, accusation.text, accusation.accuserName);
      logger.logPublic(player.id, `[DEFENSE] ${defense}`, Phase.DEFENSE);
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
      const text = await agent.getOpeningStatement(phaseCtx);
      logger.logPublic(player.id, text, Phase.OPENING_STATEMENTS);
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
    const { targetFinalistId, question } = await jurorAgent.getJuryQuestion(jurorCtx, finalistIds);
    const finalistName = gameState.getPlayerName(targetFinalistId);
    logger.logPublic(juror.playerId, `[QUESTION to ${finalistName}] ${question}`, Phase.JURY_QUESTIONS);

    const finalistAgent = agents.get(targetFinalistId);
    if (finalistAgent) {
      const finalistCtx = contextBuilder.buildPhaseContext(targetFinalistId, Phase.JURY_QUESTIONS);
      const answer = await finalistAgent.getJuryAnswer(finalistCtx, question, juror.playerName);
      logger.logPublic(targetFinalistId, `[ANSWER to ${juror.playerName}] ${answer}`, Phase.JURY_QUESTIONS);
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
      const text = await agent.getClosingArgument(phaseCtx);
      logger.logPublic(player.id, text, Phase.CLOSING_ARGUMENTS);
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
    const vote = await jurorAgent.getJuryVote(phaseCtx, finalistIds);
    gameState.recordJuryVote(juror.playerId, vote);
    logger.logSystem(
      `${juror.playerName} (juror) votes for: ${gameState.getPlayerName(vote)}`,
      Phase.JURY_VOTE,
    );
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
