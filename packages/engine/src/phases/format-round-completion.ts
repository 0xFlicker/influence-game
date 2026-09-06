import { displayNameForFormat, type LaunchFormatId } from "../formats";
import { Phase, type UUID } from "../types";
import { assertCanAcceptCommit, type PhaseActor, type PhaseRunnerContext } from "./phase-runner-context";

/** Commit the standard-round result and advance the actor using the accepted roster. */
export async function completeFormatRound(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
  formatId: LaunchFormatId,
  empoweredId: UUID,
  eliminatedId: UUID,
): Promise<void> {
  await assertCanAcceptCommit(ctx);
  ctx.gameState.recordRoundResult({
    round: ctx.gameState.round,
    empoweredId,
    exposeScores: {},
    candidates: null,
    powerAction: null,
    powerTarget: null,
    eliminated: eliminatedId,
    formatId,
    formatMethod: formatId,
  }, Phase.FORMAT_RESOLVE);
  ctx.logger.logSystem(
    `${ctx.gameState.getPlayerName(eliminatedId)} exited under ${displayNameForFormat(formatId)}`,
    Phase.FORMAT_RESOLVE,
  );
  ctx.formatKernelState.pressure = null;
  ctx.contextBuilder.currentFormatPressure = null;
  ctx.formatKernelState.offeredFormats = null;
  ctx.formatKernelState.selectedFormat = null;
  actor.send({ type: "PLAYER_ELIMINATED", playerId: eliminatedId });
  actor.send({ type: "UPDATE_ALIVE_PLAYERS", aliveIds: ctx.gameState.getAlivePlayerIds() });
  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((resolve) => setTimeout(resolve, 0));
}
