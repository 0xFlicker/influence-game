import {and,desc,eq,isNull,sql} from "drizzle-orm";
import {replayWerewolf} from "@influence/engine/werewolf";
import {schema,type DrizzleDB} from "../db/index.js";
import {readWerewolfVisualPause} from "./werewolf-visual-policy.js";
import {visualFailurePolicy} from "./visual-policy.js";
import {readWerewolfEvents} from "./werewolf-games.js";
import {readVisualRenderAccounting} from "./visual-render-journal.js";
import {ReplayVisualError} from "./visual-replay-production.js";

/** Game-level recovery and non-scene receipts. Scene versions/repairs belong to the bounded inspector. */
export async function readProductionRecovery(db:DrizzleDB,gameId:string,offset=0,limit=25) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new ReplayVisualError("Recovery receipts require a nonnegative offset and limit from 1 to 50","invalid_recovery_page",400);
  const [game] = await db.select({kind:schema.games.gameKind,status:schema.games.status,config:schema.games.config}).from(schema.games).where(eq(schema.games.id,gameId));
  if (!game) throw new ReplayVisualError("Game not found","game_missing",404);
  const pause = game.kind === "werewolf" ? await readWerewolfVisualPause(db,gameId) : null;
  const formPlayer = pause?.work.kind === "form" ? replayWerewolf(await readWerewolfEvents(db,gameId)).players.find(player => pause.work.kind === "form" && player.id === pause.work.playerId) : undefined;
  const jobs = schema.visualRepairJobs,operations = schema.visualRenderOperations,attempts = schema.visualRenderAttempts;
  const [formJob] = pause?.work.kind === "form" ? await db.select({id:jobs.id,sceneId:jobs.sceneId,reusePrefix:jobs.reusePrefix,status:jobs.status,step:jobs.step,failure:jobs.failure})
    .from(jobs).where(and(eq(jobs.gameId,gameId),isNull(jobs.sceneId),eq(jobs.reusePrefix,pause.id))).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(1) : [];
  const [unresolvedForm] = pause?.work.kind === "form" ? await db.select({id:attempts.id}).from(attempts).innerJoin(operations,eq(attempts.operationId,operations.id))
    .where(and(eq(operations.gameId,gameId),sql`${operations.operationKey} LIKE 'wolf-form:%'`,isNull(attempts.reconciliation),sql`(${attempts.receipt} IS NULL OR (${attempts.receipt}->>'chargeUncertain')::boolean = true)`)).limit(1) : [];
  const page = await readVisualRenderAccounting(db,gameId,{offset,limit:limit+1,withoutScene:true});
  return {gameId,status:game.status,recovery:pause ? {pauseId:pause.id,reason:pause.reason,kind:pause.work.kind,playerName:formPlayer?.name,policy:visualFailurePolicy(JSON.parse(game.config))} : null,
    formJob:formJob ?? null,unresolvedForm:Boolean(unresolvedForm),nextOffset:page.attempts.length > limit ? offset+limit : null,
    attempts:page.attempts.slice(0,limit).map(attempt => ({id:attempt.id,operationKey:attempt.operationKey,provider:attempt.provider,model:attempt.model,status:attempt.status,costMicrousd:attempt.costMicrousd,reconciliation:attempt.reconciliation,
      receipt:attempt.receipt ? {status:attempt.receipt.status,chargeUncertain:attempt.receipt.chargeUncertain,...(attempt.receipt.failure ? {failure:{kind:attempt.receipt.failure.kind,message:attempt.receipt.failure.message}} : {})} : null}))};
}
