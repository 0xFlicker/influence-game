import {expect, test} from "bun:test";
import {werewolfMusic} from "../components/games/werewolf/werewolf-music";
import {startWerewolf, werewolfConfig} from "../../../engine/src/werewolf/rules";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";
import type {WerewolfWatchMoment} from "../../../engine/src/werewolf/watch-contract";
import type {WerewolfPublicEntry} from "../../../engine/src/werewolf/observation";
const players=Array.from({length:6},(_,i)=>({id:`p${i}`,name:`P${i}`,personality:"Careful",backstory:"",strategy:"",avatarUrl:null}));
const base=projectWerewolfWatch([startWerewolf("music",players,werewolfConfig("one_wolf",1),"seed")],"mystery").moments[0]!;
const moment=(entry:WerewolfPublicEntry):WerewolfWatchMoment=>({...base,entry});
test("day music follows visible entries, never latest snapshot winner or roles",()=>{
 const before=moment({kind:"phase",phase:"day",day:1});
 const after={...before,snapshot:{...before.snapshot,outcome:{faction:"wolves" as const,winnerIds:["p1"],reason:"wolf_parity" as const}}};
 expect(werewolfMusic(before)).toEqual(werewolfMusic(after));
 expect(werewolfMusic(before)?.title).toBe("The Circle Closes");
 expect(werewolfMusic(moment({kind:"phase",phase:"vote",day:1}))?.key).toBe(werewolfMusic(before)?.key);
 expect(werewolfMusic(moment({kind:"phase",phase:"day",day:2}))?.key).not.toBe(werewolfMusic(before)?.key);
});
test("all introductions share one bed; missing moment, night, dawn and draw are silent",()=>{
 const first=moment({kind:"speech",day:0,actorId:"p1",audience:"public",text:"hello",cue:null});
 expect(werewolfMusic({...first,entry:{...first.entry,kind:"speech",actorId:"p2",audience:"public",text:"world",cue:null}})?.key).toBe(werewolfMusic(first)?.key);
 expect(werewolfMusic(null)).toBeNull();
 for (const entry of [{kind:"phase",phase:"night",day:1},{kind:"night",day:1,killedId:null,attackTargetId:"p1",protectedId:"p1"},{kind:"result",day:3,outcome:{faction:null,winnerIds:[],reason:"day_limit"}}] satisfies WerewolfPublicEntry[]) expect(werewolfMusic(moment(entry))).toBeNull();
});
test("pack music is omniscient only; public wolf result starts a distinct one-shot section",()=>{
 const pack=moment({kind:"speech",day:1,actorId:"p1",audience:"pack",text:"hello",cue:null});
 expect(werewolfMusic(pack)).toBeNull();
 const omni={...pack,snapshot:{...pack.snapshot,audience:"omniscient" as const}};
 expect(werewolfMusic(omni)?.repeat).toBe(true);
 const result={...omni,entry:{kind:"result" as const,day:1,outcome:{faction:"wolves" as const,winnerIds:["p1"],reason:"wolf_parity" as const}}};
 expect(werewolfMusic(result)?.src).toBe(werewolfMusic(omni)?.src);
 expect(werewolfMusic(result)?.key).not.toBe(werewolfMusic(omni)?.key);
 expect(werewolfMusic(result)?.repeat).toBe(false);
 expect(werewolfMusic(result)?.continueAtEnd).toBe(true);
 expect(werewolfMusic(omni)?.continueAtEnd).toBe(false);
 expect(werewolfMusic({...result,snapshot:{...result.snapshot,audience:"mystery"}})?.title).toBe("Wolves at the Festival");
 expect(werewolfMusic({...result,entry:{...result.entry,outcome:{faction:"village",winnerIds:[],reason:"wolves_eliminated"}}})?.title).toBe("Lanterns Still Burning");
});
