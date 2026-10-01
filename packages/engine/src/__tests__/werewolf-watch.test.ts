import {expect,test} from "bun:test";
import {startWerewolf,werewolfConfig} from "../werewolf/rules";
import {runWerewolf, type WerewolfAgent} from "../werewolf/runner";
import {isWerewolfPlayable} from "../werewolf/watch-contract";
import {projectWerewolfWatch} from "../werewolf/watch";
import {projectWerewolfPresentation} from "../werewolf/presentation";
for (const preset of ["one_wolf","two_wolves"] as const) test(`${preset}: bounded watch windows preserve audience, causal snapshots and private staging`,async()=>{
  const players=Array.from({length:preset==="one_wolf"?6:8},(_,i)=>({id:`p${i}`,name:`Player ${i}`,personality:"careful",backstory:"frozen identity",strategy:"PRIVATE STRATEGY",avatarUrl:null}));
  const events=[startWerewolf("window",players,werewolfConfig(preset,2),"window")];
  const agent:WerewolfAgent={async decide({request}){return request.action==="open_thread"?{kind:"opening",text:null,cue:"Waits",recipientIds:[]}:request.legalTargetIds.length?{kind:"target",targetId:request.legalTargetIds[0]!,thinking:"PRIVATE THINKING"}:{kind:"speech",text:request.action==="pack_talk"?"PRIVATE PACK":"Hello",cue:null};}};
  await runWerewolf({read:async()=>structuredClone(events),append:async e=>{events.push(structuredClone(e));}},agent);
  for(const audience of ["mystery","omniscient"] as const){
    const final=projectWerewolfPresentation(events,audience);
    for(let from=1;from<=final.latestCursor;from+=8){
      const window=projectWerewolfWatch(events,audience,from,8);
      expect(window.latestCursor).toBe(final.latestCursor);expect(window.moments.length).toBeLessThanOrEqual(8);
      expect(JSON.stringify(window)).not.toContain("PRIVATE STRATEGY");expect(JSON.stringify(window)).not.toContain("PRIVATE THINKING");
      if(audience==="mystery")expect(JSON.stringify(window)).not.toContain("PRIVATE PACK");
      for(const moment of window.moments){const legacy=projectWerewolfPresentation(events,audience,moment.cursor);const {entries,...snapshot}=legacy.view;
        expect(moment.snapshot).toEqual(snapshot);expect(moment.entry).toEqual(entries.at(-1)!);expect(moment.staging.participantIds).toEqual(legacy.participantIds);
        if(moment.entry.kind==="discussion")expect(isWerewolfPlayable(moment.entry)).toBe(false);
      }
      for(const nav of window.navigation){const entry=final.view.entries[nav.cursor-1]!;expect(isWerewolfPlayable(entry)).toBe(true);}
    }
    expect(projectWerewolfWatch(events,audience,final.latestCursor+1).moments).toEqual([]);
  }
  expect(()=>projectWerewolfWatch(events,"mystery",1,65)).toThrow();
});
