import { beginConversation, advanceConversation, conversationPrompt, type ConversationState } from "../open-conversation";
import { Phase } from "../types";
import {
  assertCanAcceptCommit,
  prepareAgentPhaseContext,
  resolveActionStrategyCandidate,
  strategicDecisionResponse,
  transcriptThinkingFor,
  type PhaseActor,
  type PhaseRunnerContext,
} from "./phase-runner-context";

async function runLobbyMessages(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  let conversation = beginLobbyConversation(ctx);
  while (!conversation.ended) conversation = await runLobbyConversationTurn(ctx, conversation);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export function beginLobbyConversation(ctx: PhaseRunnerContext): ConversationState {
  return beginConversation(ctx.gameState.getAlivePlayerIds(), `${ctx.gameState.gameId}:lobby:${ctx.gameState.round}`, ctx.config.conversationPolicy);
}

/** One contribution and its private evidence; the durable runner commits this unit. */
export async function runLobbyConversationTurn(ctx: PhaseRunnerContext, conversation: ConversationState): Promise<ConversationState> {
  const { gameState, agents, logger } = ctx;
  const playerId = conversation.nextActorId;
  const player = gameState.getPlayer(playerId);
  const agent = agents.get(playerId);
  if (!player || !agent) throw new Error("Lobby conversation actor is unavailable");
  const phaseCtx = prepareAgentPhaseContext(ctx, agent, playerId, Phase.LOBBY, "ordinary_speech");
  phaseCtx.conversation = conversationPrompt(conversation, gameState.getAlivePlayers().map(({id,name}) => ({id,name})),
    logger.transcript.filter(e => e.round === gameState.round && e.phase === Phase.LOBBY && e.scope === "public").map(e => ({from: e.from, text: e.text})));
  const response = await agent.getLobbyMessage(phaseCtx);
  const next = advanceConversation(conversation, playerId, response);
  await assertCanAcceptCommit(ctx);
  const spoken = !response.providerAbsence && !response.noReply && Boolean(response.message?.trim());
  if (spoken) logger.logPublic(playerId, response.message, Phase.LOBBY, transcriptThinkingFor(agent, response.thinking, response.reasoningContext));
  if (!response.providerAbsence) resolveActionStrategyCandidate(agent, response, response.strategyGameplayAccepted !== false);
  logger.emitAgentTurn({ phase: Phase.LOBBY, action: "lobby-message", actor: { id: playerId, name: player.name, role: "player" },
    visibility: spoken ? "public" : "private", response: { message: spoken ? response.message : null, noReply: !spoken,
      recipientId: response.recipientId ?? null, unavailable: Boolean(response.providerAbsence), ...strategicDecisionResponse(response) },
    thinking: response.thinking, reasoningContext: response.reasoningContext, ...(spoken ? { scope: "public" as const, text: response.message } : {}) });
  return next;
}

/** Engine-only Lobby entry effects; no model dispatch. */
export async function beginLobbyPhase(ctx: PhaseRunnerContext): Promise<void> {
  const { gameState, logger, contextBuilder } = ctx;
  await assertCanAcceptCommit(ctx);
  contextBuilder.currentPostVotePressure = null;
  gameState.startRound();
  gameState.expireShields();
  const round = gameState.round;
  logger.emitPhaseChange(Phase.LOBBY);
  logger.logSystem(`=== ROUND ${round}: LOBBY PHASE ===`, Phase.LOBBY);
}

export async function runLobbyPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  await beginLobbyPhase(ctx);

  await runLobbyMessages(ctx, actor);
}

/** Shared engine-only entry for the two endgame discussions. */
export async function beginEndgameLobby(ctx: PhaseRunnerContext, stage: "reckoning" | "tribunal"): Promise<void> {
  const { gameState, logger } = ctx;
  await assertCanAcceptCommit(ctx);
  gameState.startRound();
  gameState.setEndgameStage(stage);
  logger.emitPhaseChange(Phase.LOBBY);
  logger.logSystem(`=== THE ${stage.toUpperCase()} (Round ${gameState.round}) ===`, Phase.LOBBY);
  logger.logSystem(gameState.describeState(), Phase.LOBBY);
}

export async function runReckoningLobby(ctx: PhaseRunnerContext, actor: PhaseActor): Promise<void> {
  await beginEndgameLobby(ctx, "reckoning");
  await runLobbyMessages(ctx, actor);
}

export async function runTribunalLobby(ctx: PhaseRunnerContext, actor: PhaseActor): Promise<void> {
  await beginEndgameLobby(ctx, "tribunal");
  await runLobbyMessages(ctx, actor);
}
