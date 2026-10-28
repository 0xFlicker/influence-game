import {expect, test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {HouseNarration, narrationWindow} from "../components/watch/house-narration";
import {PresentationDirector, type PresentationClock} from "../components/watch/watch-director";
import {werewolfCues, werewolfMomentCues, werewolfWatchPolicy, werewolfCueMoment, werewolfHouseCentered} from "../components/games/werewolf/werewolf-watch-model";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfProductionWatch} from "@influence/engine/werewolf/watch";
import {WerewolfContentFrame} from "../components/games/werewolf/werewolf-watch-stage";
import {villageEliminationFrame} from "../components/games/werewolf/werewolf-vote-outcome";
import type {WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";
import {SoloPresentation} from "../app/games/[slug]/components/solo-presentation";
import {SampledStageProvider} from "../components/watch/sampled-stage";

class Clock implements PresentationClock {
  time=0; now(){return this.time;} setTimeout(){return 1;} clearTimeout(){};
}
const moment: WerewolfWatchMoment = {cursor:20,chapterId:"day:2",sceneId:"day:2:vote",mediaKey:null,
  snapshot:{gameId:"g",rulesVersion:11,preset:"two_wolves",audience:"mystery",day:2,maxDays:5,phase:"vote",cursor:20,discussion:null,outcome:null,
    players:[{id:"a",name:"Arden",personaKey:null,avatarUrl:"/a.png",fullBodyReferenceUrl:"/body-a.png",alive:false},{id:"b",name:"Marlow",personaKey:null,avatarUrl:"/b.png",alive:true}]},
  entry:{kind:"vote",day:2,result:{thread:1,voteMode:"majority",requiredVotes:2,dayEnded:true,eliminatedId:"a",totals:{a:2},ballots:[{voterId:"a",targetId:"a",unavailable:false},{voterId:"b",targetId:"a",unavailable:false}]}}};

test("narration keeps the entire message on one screen throughout recorded audio",()=>{
  const text="The village has chosen. ".repeat(30).trim();
  expect(narrationWindow(-1,30000)).toBeNull(); expect(narrationWindow(30000,30000)).toBeNull();
  expect(renderToStaticMarkup(<HouseNarration text={text} window={null}/>)).toBe("");
  for(const time of [0,15000,29999]){
    const html=renderToStaticMarkup(<HouseNarration text={text} window={narrationWindow(time,30000)}/>);
    expect(html).toContain(text);expect(html).toContain('alt="The House"');
    expect(html.match(/data-house-narration="true"/g)).toHaveLength(1);
  }
});
test("an established thought portrait stays visible at the speech handoff but still exits normally",()=>{
  const render=(elapsedMs:number, continuedActorId:string|null)=>renderToStaticMarkup(<SampledStageProvider value={{images:{},previousScene:null,previousSpeaker:null,firstInScene:true,continuedActorId}}>
    <SoloPresentation beat={{kind:"portrait",purpose:"Ballot",player:{id:"a",name:"Arden",persona:"",fullBodyReferenceUrl:"/body-a.png"},speech:{id:"vote",playerId:"a",speaker:"Arden",text:"I vote for Marlow."}}} elapsedMs={elapsedMs}/>
  </SampledStageProvider>);
  expect(render(0,"a")).toContain("opacity:1");
  expect(render(0,null)).toContain("opacity:0");
  expect(render(60000,"a")).toContain("opacity:0");
});
test("the completed closing frame shows canonical cast and elimination recap with no repeated House narration", async()=>{
  const events=await completedCurrentWerewolfFixture("ending-recap",11);
  for(const audience of ["mystery","omniscient"] as const){
    const projected=projectWerewolfProductionWatch(events,audience);
    const cue=werewolfCues([{...projected,audience,status:"completed",slug:"ending-recap",publicationCutoff:"now",media:{}}]).at(-1)!;
    expect(cue.reprise).toBe(true);
    const html=renderToStaticMarkup(<WerewolfContentFrame cue={cue} scene={null} elapsed={6000} reduced/>);
    expect(html).toContain("data-werewolf-ending");expect(html).toContain("How the game unfolded");
    expect(html).not.toContain("data-house-narration");
    for(const player of cue.moment.snapshot.players){
      expect(html).toContain(player.name);
      if(player.elimination) expect(html).toContain(`${player.elimination.kind === "night" ? "Night" : "Day"} ${player.elimination.day}`);
    }
  }
});
test("recording clock survives pause, seek, and speed without trailing House overlay",()=>{
  const cue=werewolfMomentCues(moment).at(-1)!, clock=new Clock();
  const director=new PresentationDirector({clock,policy:werewolfWatchPolicy});
  director.load([cue]);director.setRecordings(cue.key,{speechMs:12000});director.seekTimeline(0,6000);
  expect(director.getAudioPosition()).toEqual({part:"speech",offsetMs:6000});
  director.pause();clock.time+=5000;expect(director.getAudioPosition()?.offsetMs).toBe(6000);
  director.setSpeed(2);director.play();clock.time+=1000;expect(director.getAudioPosition()?.offsetMs).toBe(8000);
  director.seekTimeline(0,12000);expect(director.getAudioPosition()).toBeNull();
  director.seekTimeline(0,0);expect(director.getAudioPosition()?.offsetMs).toBe(0);director.dispose();
});
test("village elimination desaturates only the actual recorded outcome, with stable seeks and reduced motion",()=>{
  const cues=werewolfMomentCues(moment);
  const render=(index:number,time:number)=>renderToStaticMarkup(<WerewolfContentFrame cue={cues[index]!} scene={null} elapsed={time} reduced={false}/>);
  expect(render(0,2000)).not.toContain("data-village-elimination");
  expect(render(cues.length-1,0)).toContain('grayscale(0) brightness(1)');
  expect(render(cues.length-1,1150)).toContain('grayscale(1) brightness(0.55)');
  expect(render(cues.length-1,700)).toBe(render(cues.length-1,700));
  expect(villageEliminationFrame(0,true)).toEqual(villageEliminationFrame(10000,true));
  if (moment.entry.kind !== "vote") throw new Error("fixture");
  const noExit: WerewolfWatchMoment={...moment,entry:{...moment.entry,result:{...moment.entry.result,eliminatedId:null}}};
  expect(renderToStaticMarkup(<WerewolfContentFrame cue={werewolfMomentCues(noExit).at(-1)!} scene={null} elapsed={1500} reduced/>)).not.toContain("data-village-elimination");
});

test("House owns backdrop-only scenes and every private action has its own spoken result", async () => {
  const events = await completedCurrentWerewolfFixture("house-scenes", 11);
  for (const audience of ["omniscient", "mystery"] as const) {
    const projected = projectWerewolfProductionWatch(events, audience);
    for (const row of projected.moments) {
      const cues = werewolfMomentCues(row);
      expect(cues.map(cue => cue.baseDurationMs)).toEqual(projected.playback.find(item => item.cursor === row.cursor)?.durationsMs ?? []);
      for (const cue of cues) {
        const line = werewolfCueMoment(cue);
        if (cue.nightAction && !cue.nightDecision) {
          expect(audience).toBe("omniscient"); expect(line.house).toBe(true); expect(line.speaker).toBe("The House");
          expect(werewolfWatchPolicy.speech(cue)).not.toBeNull();
          expect(line.text).toContain(cue.nightAction.kind === "investigate" ? "The result:" : cue.nightAction.kind === "protect" ? "protects" : "hunts");
        }
        if (cue.nightDecision) expect(line.house).toBe(false);
        if (line.house && !cue.ballot && !line.actor && !cue.nightAction) {
          expect(werewolfHouseCentered(cue)).toBe(true);
          const html = renderToStaticMarkup(<WerewolfContentFrame cue={cue} scene={null} elapsed={0} reduced/>);
          expect(html).toContain('data-house-layout="center"');
          expect(html.match(/data-house-narration="true"/g)).toHaveLength(1);
        }
      }
    }
  }
});
