import {runAccountText} from "../services/account-text-usage.js";
import {beforeEach,describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {schema,type DrizzleDB} from '../db/index.js';
import {setupTestDB} from './test-utils.js';
import {seedRBAC} from '../db/rbac-seed.js';
import {allowancePeriod,reserveInference,dispatchInference,settleInference,changeInferenceAccount,readInferenceAccount} from '../services/inference-allowances.js';
import {readAccountSpending} from '../services/account-spending.js';
describe('account inference allowances',()=>{
 let db:DrizzleDB,owner:string,admin:string;
 beforeEach(async()=>{db=await setupTestDB();await seedRBAC(db);owner=randomUUID();admin=randomUUID();await db.insert(schema.users).values([{id:owner},{id:admin,walletAddress:'0xinferenceadmin'}]);const [role]=await db.select().from(schema.roles).where(eq(schema.roles.name,'admin'));await db.insert(schema.addressRoles).values({walletAddress:'0xinferenceadmin',roleId:role!.id});});
 const reserve=(id:string=randomUUID())=>db.transaction(tx=>reserveInference(tx,{id,userId:owner,category:'text',inputHash:'same'}));
 const action=(body:Record<string,unknown>)=>changeInferenceAccount(db,admin,{actionId:randomUUID(),userId:owner,reason:'test adjustment',...body});
 test('UTC anniversaries clamp without drifting and skip missed periods',()=>{
  expect(allowancePeriod('2024-01-31T12:00:00Z','2024-02-29T12:00:00Z')).toBe('2024-02-29T12:00:00.000Z');
  expect(allowancePeriod('2024-01-31T12:00:00Z','2024-03-31T11:00:00Z')).toBe('2024-02-29T12:00:00.000Z');
  expect(allowancePeriod('2024-01-31T12:00:00Z','2026-03-31T12:00:00Z')).toBe('2026-03-31T12:00:00.000Z');
 });
 test('concurrent reservations serialize, exact replay is free, failures refund once',async()=>{
  const results=await Promise.allSettled([reserve(),reserve()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const win=results.find(r=>r.status==='fulfilled');if(win?.status!=='fulfilled')throw new Error('no winner');
  expect((await reserve(win.value.id)).id).toBe(win.value.id);
  await db.transaction(tx=>settleInference(tx,win.value.id,owner,'failed'));await db.transaction(tx=>settleInference(tx,win.value.id,owner,'failed'));
  expect((await readInferenceAccount(db,admin,owner)).account.textBalance).toBe(100);
 });
 test('idempotent grants persist across monthly refresh, plan edits affect future grants',async()=>{
  const cmd={actionId:randomUUID(),userId:owner,reason:'gift',kind:'grant',category:'text',amount:10};
  await changeInferenceAccount(db,admin,cmd);await changeInferenceAccount(db,admin,cmd);
  await action({kind:'assign',planId:'faf'});
  await db.update(schema.inferenceAccounts).set({anchor:'2024-01-31T12:00:00Z',periodStart:'2024-01-31T12:00:00Z',textBalance:0}).where(eq(schema.inferenceAccounts.userId,owner));
  const account=(await readInferenceAccount(db,admin,owner)).account;
  expect(account.textBalance).toBe(100);expect(account.textGrant).toBe(10);
  await action({kind:'plan_policy',planId:'faf',version:1,policy:{text:200,image:25,renewal:'monthly',textBurst:5,imageDaily:5,textConcurrency:1,imageConcurrency:1}});
  expect((await readInferenceAccount(db,admin,owner)).account.textBalance).toBe(100);
 });
 test('pause uses current authority and prevents dispatch; uncertain reservations are retained',async()=>{
  const r=await reserve();await action({kind:'pause',paused:true});
  await expect(db.transaction(tx=>dispatchInference(tx,r.id,owner))).rejects.toMatchObject({code:'generation_paused'});
  await action({kind:'pause',paused:false});await db.transaction(tx=>dispatchInference(tx,r.id,owner));await db.transaction(tx=>settleInference(tx,r.id,owner,'uncertain'));
  await expect(reserve()).rejects.toMatchObject({code:'generation_busy'});
  await expect(changeInferenceAccount(db,owner,{actionId:randomUUID(),reason:'no',userId:owner,kind:'grant',category:'text',amount:5})).rejects.toMatchObject({status:403});
 });
 test('spending totals preserve unknown costs and exclude game spend',async()=>{
  await db.insert(schema.accountTextOperations).values([{id:randomUUID(),userId:owner,requestKey:'one',inputHash:'x',kind:'profile_creation',model:'test',state:'succeeded',estimatedCostMicrousd:2500},{id:randomUUID(),userId:owner,requestKey:'two',inputHash:'x',kind:'profile_creation',model:'test',state:'uncertain'}]);
  const report=await readAccountSpending(db,admin,{userId:owner,window:'all'});
  expect('summary' in report&&report.summary).toMatchObject({text_requests:2,estimated_microusd:2500,unpriced:1,attempts:2});
  const list=await readAccountSpending(db,admin,{window:'all'});expect('accounts' in list&&list.accounts?.[0]).toMatchObject({id:owner});
 });
 test('fresh accounts ignore historical image counts and grants are spent after base balance',async()=>{
  await db.insert(schema.avatarGenerationRequests).values({id:randomUUID(),userId:owner,purpose:'agent_profile_completion',status:'completed',triggerSource:'web_user_prompt',model:'legacy'});
  expect((await readInferenceAccount(db,admin,owner)).account.imageBalance).toBe(25);
  await db.update(schema.inferenceAccounts).set({textBalance:1,textGrant:2}).where(eq(schema.inferenceAccounts.userId,owner));
  const first=await reserve();expect(first.bucket).toBe('balance');await db.transaction(tx=>settleInference(tx,first.id,owner,'succeeded'));
  const second=await reserve();expect(second.bucket).toBe('grant');await db.transaction(tx=>settleInference(tx,second.id,owner,'failed'));
  expect((await readInferenceAccount(db,admin,owner)).account.textGrant).toBe(2);
 });
 test('expired recurring reservation refunds do not inflate the new period',async()=>{
  await action({kind:'assign',planId:'faf'});const r=await reserve();
  await db.update(schema.inferenceAccounts).set({anchor:'2024-01-31T12:00:00Z',periodStart:'2024-01-31T12:00:00Z',textBalance:0}).where(eq(schema.inferenceAccounts.userId,owner));
  await db.update(schema.inferenceReservations).set({periodStart:'2024-01-31T12:00:00Z'}).where(eq(schema.inferenceReservations.id,r.id));
  await db.transaction(tx=>settleInference(tx,r.id,owner,'failed'));
  expect((await readInferenceAccount(db,admin,owner)).account.textBalance).toBe(100);
 });
 test('exhaustion, burst overrides, input conflicts, and revoked admin authority',async()=>{
  await readInferenceAccount(db,admin,owner);
  await db.update(schema.inferenceAccounts).set({textBalance:0}).where(eq(schema.inferenceAccounts.userId,owner));
  await expect(reserve()).rejects.toMatchObject({code:'generation_exhausted'});
  await action({kind:'grant',category:'text',amount:3});await action({kind:'overrides',overrides:{textBurst:1}});
  const r=await reserve();await db.transaction(tx=>settleInference(tx,r.id,owner,'succeeded'));
  await expect(reserve()).rejects.toMatchObject({code:'generation_throttled'});
  await action({kind:'overrides',overrides:{textBurst:2}});await reserve();
  await expect(db.transaction(tx=>reserveInference(tx,{id:r.id,userId:owner,category:'text',inputHash:'changed'}))).rejects.toMatchObject({code:'request_conflict'});
  await db.delete(schema.addressRoles).where(eq(schema.addressRoles.walletAddress,'0xinferenceadmin'));
  await expect(action({kind:'grant',category:'text',amount:1})).rejects.toMatchObject({status:403});
 });

 test('text response-loss replay returns the stored result without another provider call or debit',async()=>{
  const input={userId:owner,requestKey:randomUUID(),kind:'profile_creation',model:'gpt-5.6-luna',payload:{idea:'detective'}};
  let calls=0;
  const run=async(record:Parameters<Parameters<typeof runAccountText>[2]>[0])=>{
    calls++;await record({id:'fake-response',object:'chat.completion',created:0,model:'gpt-5.6-luna',choices:[],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});
    return {name:'Mira'};
  };
  expect(await runAccountText(db,input,run)).toEqual({name:'Mira'});
  expect(await runAccountText(db,input,run)).toEqual({name:'Mira'});
  expect(calls).toBe(1);expect((await readInferenceAccount(db,admin,owner)).account.textBalance).toBe(99);
  await expect(runAccountText(db,{...input,payload:{idea:'changed'}},run)).rejects.toMatchObject({code:'request_conflict'});
 });
 test('confirmed text failures refund allowance but retain spend evidence; transport ambiguity remains reserved',async()=>{
  await expect(runAccountText(db,{userId:owner,requestKey:randomUUID(),kind:'profile_creation',model:'test',payload:{}},async record=>{
    await record({id:'bad-response',object:'chat.completion',created:0,model:'test',choices:[],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});
    throw new Error('Invalid structured output');
  })).rejects.toThrow('Invalid structured output');
  expect((await readInferenceAccount(db,admin,owner)).account.textBalance).toBe(100);
  expect((await db.select().from(schema.accountTextOperations))[0]!.promptTokens).toBe(20);
  await expect(runAccountText(db,{userId:owner,requestKey:randomUUID(),kind:'profile_creation',model:'test',payload:{}},async()=>{throw new TypeError('Network disconnected');})).rejects.toThrow('Network disconnected');
  const detail=await readInferenceAccount(db,admin,owner);expect(detail.account.textBalance).toBe(99);expect(detail.pending[0]!.state).toBe('uncertain');
 });

});
