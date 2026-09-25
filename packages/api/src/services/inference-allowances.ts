import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { InferencePolicy } from "../db/schema.js";
import { userHasRole } from "../db/rbac.js";
import { requireAccountAdmin } from "./account-spending.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";
import { sha256StableJson } from "./stable-hash.js";
type Tx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
type Category = 'text' | 'image';
const accounts = schema.inferenceAccounts, plans = schema.inferencePlans, reservations = schema.inferenceReservations;

/** UTC anniversary computed from the original anchor, never the previous clamped month. */
export function allowancePeriod(anchor: string, now: string): string {
  const start = new Date(anchor), current = new Date(now);
  function inMonth(months: number) {
    const d = new Date(start); d.setUTCDate(1); d.setUTCMonth(start.getUTCMonth()+months);
    const last = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(start.getUTCDate(),last)); return d;
  }
  let months = (current.getUTCFullYear()-start.getUTCFullYear())*12+current.getUTCMonth()-start.getUTCMonth();
  if (inMonth(months)>current) months--;
  return inMonth(Math.max(0,months)).toISOString();
}
async function lockAccount(tx: Tx,userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inference:' || ${userId}))`);
  const [nowRow] = await tx.select({now:sql<string>`clock_timestamp()::text`}).from(sql`(SELECT 1) clock`);
  const now = new Date(nowRow!.now).toISOString();
  const [user] = await tx.select({id:schema.users.id}).from(schema.users).where(eq(schema.users.id,userId));
  if(!user) throw new GenerationAdmissionError('account_not_found','Account not found.',404);
  const [free] = await tx.select().from(plans).where(eq(plans.id,'free'));
  if (!free) throw new Error('Free inference policy missing');
  const [created] = await tx.insert(accounts).values({userId,textBalance:free.policy.text,imageBalance:free.policy.image}).onConflictDoNothing().returning();
  if(created) await tx.insert(schema.inferenceActions).values({id:`initial:${userId}`,actorId:null,userId,requestHash:'initial',reason:'Initial Free allowance',command:{kind:'initial_grant'},result:{text:created.textBalance,image:created.imageBalance,periodStart:created.periodStart}});
  const [account] = await tx.select().from(accounts).where(eq(accounts.userId,userId)).for('update');
  const [plan] = await tx.select().from(plans).where(eq(plans.id,account!.planId));
  const policy = {...plan!.policy,...account!.overrides};
  const period = policy.renewal === 'monthly' ? allowancePeriod(account!.anchor,now) : account!.periodStart;
  if (new Date(period)>new Date(account!.periodStart)) {
    const [renewed] = await tx.update(accounts).set({periodStart:period,textBalance:policy.text,imageBalance:policy.image,version:account!.version+1}).where(eq(accounts.userId,userId)).returning();
    await tx.insert(schema.inferenceActions).values({id:`renewal:${userId}:${account!.anchor}:${period}`,actorId:null,userId,requestHash:'renewal',reason:'Scheduled allowance refresh',command:{kind:'renewal',planId:plan!.id,policyVersion:plan!.version},result:{text:policy.text,image:policy.image,periodStart:period}});
    return {account:renewed!,policy,now};
  }
  return {account:account!,policy,now};
}
function requireUnpaused(paused: boolean) {
  if (paused) throw new GenerationAdmissionError('generation_paused','Generation is paused for this account. Contact us for help.',403);
}
export async function reserveInference(tx: Tx,input:{id:string;userId:string;category:Category;inputHash:string}) {
  const {account,policy,now} = await lockAccount(tx,input.userId);
  const [prior] = await tx.select().from(reservations).where(eq(reservations.id,input.id));
  if (prior) {
    if(prior.userId!==input.userId || prior.inputHash!==input.inputHash || prior.category!==input.category) throw new GenerationAdmissionError('request_conflict','Generation input changed.');
    return prior;
  }
  requireUnpaused(account.paused);
  const exempt = input.category==='image' && (account.imageExempt ?? await userHasRole(tx,input.userId,'sysop'));
  const recent = await tx.select().from(reservations).where(and(eq(reservations.userId,input.userId),eq(reservations.category,input.category),
    gt(reservations.createdAt,new Date(new Date(now).getTime()-86400000).toISOString())));
  const [active] = await tx.select({count:sql<number>`count(*)::int`}).from(reservations).where(and(eq(reservations.userId,input.userId),eq(reservations.category,input.category),inArray(reservations.state,['reserved','dispatched','uncertain'])));
  if ((active?.count ?? 0)>=(input.category==='text'?policy.textConcurrency:policy.imageConcurrency)) throw new GenerationAdmissionError('generation_busy','Another generation is still running or awaiting recovery. Please try again later.',429);
  const starts = input.category==='image' ? recent.length : recent.filter(r=>new Date(r.createdAt).getTime()>new Date(now).getTime()-60000).length;
  if(!exempt && starts>=(input.category==='image'?policy.imageDaily:policy.textBurst)) throw new GenerationAdmissionError('generation_throttled','Please wait before generating again.',429);
  const balance = input.category==='text'?account.textBalance:account.imageBalance;
  const grant = input.category==='text'?account.textGrant:account.imageGrant;
  if(!exempt && balance+grant<1) throw new GenerationAdmissionError('generation_exhausted','You’ve reached your current generation allowance. Contact us and we can help you get more.',429);
  const bucket = exempt?'exempt':balance>0?'balance':'grant';
  if(!exempt) await tx.update(accounts).set(input.category==='text' ? bucket==='balance'?{textBalance:balance-1}:{textGrant:grant-1} : bucket==='balance'?{imageBalance:balance-1}:{imageGrant:grant-1}).where(eq(accounts.userId,input.userId));
  const [row] = await tx.insert(reservations).values({...input,state:'reserved',bucket,periodStart:account.periodStart,createdAt:now}).returning();
  return row!;
}
/** Serialize fresh restriction checks with operator changes at each provider dispatch. */
export async function dispatchInference(tx:Tx,id:string,userId:string) {
  const {account} = await lockAccount(tx,userId); requireUnpaused(account.paused);
  const [row] = await tx.select().from(reservations).where(and(eq(reservations.id,id),eq(reservations.userId,userId)));
  if(!row || !['reserved','dispatched'].includes(row.state)) throw new GenerationAdmissionError('generation_recovery_required','Generation requires reconciliation before another attempt.');
  await tx.update(reservations).set({state:'dispatched'}).where(eq(reservations.id,id));
}
export async function settleInference(tx:Tx,id:string,userId:string,state:'succeeded'|'failed'|'uncertain') {
  const {account,now} = await lockAccount(tx,userId);
  const [row] = await tx.select().from(reservations).where(and(eq(reservations.id,id),eq(reservations.userId,userId)));
  if(!row || row.state==='succeeded' || row.state==='failed') return;
  if(state==='failed' && row.bucket!=='exempt') {
    // Expired recurring reservations cannot manufacture credits in a new period.
    const current = new Date(row.periodStart).getTime()===new Date(account.periodStart).getTime();
    if(row.bucket==='grant' || current) {
      const values = row.category==='text' ? row.bucket==='grant'?{textGrant:account.textGrant+1}:{textBalance:account.textBalance+1} : row.bucket==='grant'?{imageGrant:account.imageGrant+1}:{imageBalance:account.imageBalance+1};
      await tx.update(accounts).set(values).where(eq(accounts.userId,userId));
    }
  }
  await tx.update(reservations).set({state,finishedAt:state==='uncertain'?null:now}).where(eq(reservations.id,id));
}
const policyKeys = ['text','image','renewal','textBurst','imageDaily','textConcurrency','imageConcurrency'];
export function validateInferencePolicy(value:unknown,partial=false): Partial<InferencePolicy> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new GenerationAdmissionError('invalid_policy','Invalid plan policy.',400);
  const obj=value as Record<string,unknown>;
  if(Object.keys(obj).some(k=>!policyKeys.includes(k)) || (!partial && policyKeys.some(k=>!(k in obj)))) throw new GenerationAdmissionError('invalid_policy','Invalid policy fields.',400);
  for(const [k,v] of Object.entries(obj)) if(k==='renewal' ? v!=='none'&&v!=='monthly' : typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1000000) throw new GenerationAdmissionError('invalid_policy','Invalid policy value.',400);
  return obj as Partial<InferencePolicy>;
}
export async function readInferenceAccount(db:DrizzleDB,actor:string,userId:string) {
  await requireAccountAdmin(db,actor);
  return db.transaction(async tx=>{
    const {account,policy}=await lockAccount(tx,userId);
    const history=await tx.select().from(schema.inferenceActions).where(eq(schema.inferenceActions.userId,userId)).orderBy(desc(schema.inferenceActions.createdAt)).limit(50);
    const pending=await tx.select().from(reservations).where(and(eq(reservations.userId,userId),inArray(reservations.state,['reserved','dispatched','uncertain']))).limit(50);
    return {account,policy,history,pending,imageExempt:account.imageExempt ?? await userHasRole(tx,userId,'sysop')};
  });
}
export async function changeInferenceAccount(db:DrizzleDB,actor:string,body:Record<string,unknown>) {
  const {actionId,reason,userId,kind}=body;
  if(typeof actionId!=='string'||!/^[0-9a-f-]{36}$/i.test(actionId)||typeof reason!=='string'||!reason.trim()||reason.length>2000||typeof kind!=='string') throw new GenerationAdmissionError('invalid_command','An action UUID and reason are required.',400);
  const hash=sha256StableJson(body);
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('inference-admin'))`);
    const authority=await requireAccountAdmin(tx,actor);
    const [prior]=await tx.select().from(schema.inferenceActions).where(eq(schema.inferenceActions.id,actionId));
    if(prior) {if(prior.actorId!==actor||prior.requestHash!==hash) throw new GenerationAdmissionError('request_conflict','Action ID reused with different input.');return prior.result;}
    let result:Record<string,unknown>;
    if(kind==='plan_policy') {
      if(typeof body.planId!=='string'||typeof body.version!=='number') throw new GenerationAdmissionError('invalid_command','Plan and version required.',400);
      const policy=validateInferencePolicy(body.policy) as InferencePolicy;
      const [updated]=await tx.update(plans).set({policy,version:body.version+1}).where(and(eq(plans.id,body.planId),eq(plans.version,body.version))).returning();
      if(!updated) throw new GenerationAdmissionError('plan_conflict','Plan changed. Refresh first.');result={plan:updated};
    } else {
      if(typeof userId!=='string') throw new GenerationAdmissionError('invalid_command','Account required.',400);
      const {account,now}=await lockAccount(tx,userId);
      if(await userHasRole(tx,userId,'sysop') && !authority.sysop) throw new GenerationAdmissionError('sysop_required','Only a sysop can change this account.',403);
      let values:Partial<typeof accounts.$inferInsert>={version:account.version+1};
      if(kind==='grant') {
        if(!['text','image'].includes(String(body.category))||typeof body.amount!=='number'||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>1000000) throw new GenerationAdmissionError('invalid_command','Positive grant amount required.',400);
        values= {...values,...body.category==='text'?{textGrant:account.textGrant+body.amount}:{imageGrant:account.imageGrant+body.amount}};
      } else if(kind==='pause') {
        if(typeof body.paused!=='boolean') throw new GenerationAdmissionError('invalid_command','Pause state required.',400);
        if(userId===actor && body.paused) throw new GenerationAdmissionError('self_lockout','Use another operator to pause your account.',400);
        values.paused=body.paused;
      } else if(kind==='overrides') values.overrides=validateInferencePolicy(body.overrides,true);
      else if(kind==='exemption') {
        if(!authority.sysop || (body.exempt!==null && typeof body.exempt!=='boolean')) throw new GenerationAdmissionError('sysop_required','Only sysops can set exemptions.',403);
        values.imageExempt=body.exempt as boolean|null;
      } else if(kind==='assign') {
        if(typeof body.planId!=='string') throw new GenerationAdmissionError('invalid_command','Plan required.',400);
        const [plan]=await tx.select().from(plans).where(eq(plans.id,body.planId));
        if(!plan) throw new GenerationAdmissionError('invalid_plan','Plan not found.',404);
        const policy={...plan.policy,...account.overrides};
        values={...values,planId:plan.id,anchor:now,periodStart:now,textBalance:policy.text,imageBalance:policy.image};
      } else if(kind==='reconcile') {
        if(typeof body.reservationId!=='string'||!['succeeded','failed'].includes(String(body.outcome))) throw new GenerationAdmissionError('invalid_command','Reservation and confirmed outcome required.',400);
        const [r]=await tx.select().from(reservations).where(and(eq(reservations.id,body.reservationId),eq(reservations.userId,userId)));
        if(!r||!['reserved','dispatched','uncertain'].includes(r.state)) throw new GenerationAdmissionError('invalid_reservation','Reservation is no longer pending.');
        await settleInference(tx,r.id,userId,body.outcome as 'succeeded'|'failed');
      } else throw new GenerationAdmissionError('invalid_command','Unknown account command.',400);
      const [updated]=await tx.update(accounts).set(values).where(eq(accounts.userId,userId)).returning();result={account:updated};
    }
    await tx.insert(schema.inferenceActions).values({id:actionId,actorId:actor,userId:typeof userId==='string'?userId:null,requestHash:hash,reason:reason.trim(),command:body,result});
    return result;
  });
}

export async function checkInferenceDispatch(tx:Tx,userId:string) { const {account}=await lockAccount(tx,userId); requireUnpaused(account.paused); }
