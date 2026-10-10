import {expect,test} from "bun:test";
import {werewolfResultsFixture} from "../fixtures/werewolf-results";
import {buildWerewolfResults} from "../werewolf/results";
import {projectWerewolfWatch,walkWerewolfHistory} from "../werewolf/watch";

for (const scenario of ["village","wolves","saved","disagreement","unavailable"] as const) test(`results: ${scenario} canonical outcome and evidence`,async()=>{
 const events=await werewolfResultsFixture(scenario), result=buildWerewolfResults(events);
 expect(result.outcome.faction).toBe(scenario === "village" ? "village" : scenario === "wolves" ? "wolves" : null);
 expect(result.players.filter(p=>p.won).map(p=>p.id).sort()).toEqual([...result.outcome.winnerIds].sort());
 if(scenario === "village" || scenario === "wolves") expect(result.players.some(p=>p.won && !p.alive)).toBe(true);
 if(scenario === "saved") expect(result.recap.some(r=>r.kind==="night" && r.result.attackTargetId === r.result.protectedId && r.result.killedId === null)).toBe(true);
 if(scenario === "disagreement") expect(result.recap.some(r=>r.kind==="night" && r.noAttackReason === "no_agreement")).toBe(true);
 if(scenario === "unavailable") expect(result.recap.some(r=>r.kind==="vote" && r.result.ballots.some(b=>b.unavailable))).toBe(true);
 if(scenario === "saved" || scenario === "disagreement") {
  expect(result.recap.filter(r=>r.kind==="vote")).toHaveLength(8);
  expect(result.recap.at(-1)).toMatchObject({kind:"vote",result:{voteMode:"plurality",eliminatedId:null,dayEnded:true}});
 }
 const json=JSON.stringify(result);
 for(const secret of ["SECRET_SEED","SECRET_THINKING","SECRET_STRATEGY","SECRET_PACK"])expect(json).not.toContain(secret);
 for(const item of result.recap){
  const entry=projectWerewolfWatch(events,"omniscient",item.source.cursor,1).moments[0]!.entry;
  expect(entry.kind).toBe(item.kind);
  if(item.kind === "night") expect(entry).toMatchObject(item.result); else expect("result" in entry && entry.result).toEqual(item.result);
 }
 expect(projectWerewolfWatch(events,"omniscient",result.source.cursor,1).moments[0]!.entry).toMatchObject({kind:"result",outcome:result.outcome});
 for(const audience of ["mystery","omniscient"] as const){
  const frames=[...walkWerewolfHistory(events,audience)];
  for(const frame of frames.filter(f=>f.entry).filter((_,i)=>i%13===0)) expect(projectWerewolfWatch(events,audience,frame.cursor,1).moments[0]!.entry).toEqual(frame.entry!);
 }
 expect(projectWerewolfWatch(events,"omniscient").latestCursor).toBeGreaterThan(projectWerewolfWatch(events,"mystery").latestCursor);
},30_000);

test("results rejects missing terminal events, discontinuity, wrong rules and forged outcomes",async()=>{
 const events=await werewolfResultsFixture("village");
 expect(()=>buildWerewolfResults([])).toThrow();
 expect(()=>buildWerewolfResults(events.slice(0,-1))).toThrow();
 expect(()=>buildWerewolfResults([events[0]!,...events.slice(2)])).toThrow();
 const old=structuredClone(events);if(old[0]!.type!=="werewolf.started")throw Error();Object.assign(old[0]!.payload.config,{rulesVersion:6});
 expect(()=>buildWerewolfResults(old)).toThrow();
 const corrupt=structuredClone(events);const last=corrupt.at(-1)!;if(last.type!=="werewolf.completed")throw Error();last.payload.winnerIds=[];
 expect(()=>buildWerewolfResults(corrupt)).toThrow();
 const night=structuredClone(events);const row=night.find(e=>e.type==="werewolf.night_resolved")!;if(row.type!=="werewolf.night_resolved")throw Error();row.payload.killedId=null;
 expect(()=>buildWerewolfResults(night)).toThrow();
});


test("maximum-duration results remain bounded without conversation or private payloads",async()=>{
 const events=await werewolfResultsFixture("disagreement","maximum-results",20);
 const result=buildWerewolfResults(events);
 expect(result.day).toBe(20);expect(result.recap).toHaveLength(180);
 expect(result.outcome).toMatchObject({faction:null,reason:"day_limit",winnerIds:[]});
 expect(JSON.stringify(result).length).toBeLessThan(200_000);
},30_000);
