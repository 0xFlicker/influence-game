import {expect,test} from "bun:test";
import {withResultPresentation} from "../app/games/[slug]/components/result-presentation";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import type {ClassicPresentationCue,EndgamePresentationCue} from "../app/games/[slug]/components/types";
import type {TranscriptEntry} from "../lib/api";

const result:EndgamePresentationCue = {source:"endgame",kind:"endgame_elimination",key:"exit",round:1,phase:"VOTE",canonicalSequence:11,resultEventSequence:10,playerId:"p1",baseDurationMs:4000};
const house:ClassicPresentationCue = {source:"classic",kind:"classic_transcript",key:"speech",round:1,phase:"VOTE",canonicalSequence:11,baseDurationMs:7000,sceneIndex:0,messageIndex:0,stage:"done",houseSummary:true};
function scenes(revision:"historical"|"results-mc-v1",eventSequence=10) {
  const message:TranscriptEntry={id:1,gameId:"game",round:1,phase:"VOTE",scope:"system",fromPlayerId:null,fromPlayerName:null,toPlayerIds:null,text:"The accepted words remain unchanged.",timestamp:0,dialogueKind:"house_summary",houseResult:{eventSequence,authoringRevision:revision}};
  return buildStoryScenes([message]);
}
test("new adjacent MC speech shares the exact resolved event and preserves source identities",()=>{
  const cues=withResultPresentation([result,house],scenes("results-mc-v1"));
  expect(cues.map(c=>c.key)).toEqual(["exit","speech"]);
  expect(cues[0]!.baseDurationMs).toBe(500);
  expect(cues[1]).toMatchObject({houseResultCue:{key:"exit"},minimumDurationMs:6000,baseDurationMs:9000});
});
test("historical speech retains its accepted position and full reading time",()=>{
  const cues=withResultPresentation([result,house],scenes("historical"));
  expect(cues[0]!.baseDurationMs).toBe(6000);
  expect(cues[1]).toMatchObject({houseResultCue:{key:"exit"},baseDurationMs:9000});
});
test("missing, future, or ambiguous associations never borrow a result",()=>{
  for(const input of [[result,house],[result,{...result,key:"duplicate"},house]]) {
    const cues=withResultPresentation(input,scenes("historical",input.length===2?20:10));
    expect(cues.at(-1)).not.toHaveProperty("houseResultCue");
    expect(cues.every(c=>c.resultsPresentation)).toBe(true);
  }
});

test("live publication conversion preserves the engine-owned association", async()=>{
  const {wsEntryToTranscriptEntry}=await import("../app/games/[slug]/components/message-parsing");
  const row=wsEntryToTranscriptEntry({round:1,phase:"VOTE",scope:"system",from:"SYSTEM",text:"Arbitrary speech",timestamp:0,houseResult:{eventSequence:10,authoringRevision:"results-mc-v1"}},"game",1);
  expect(row.houseResult).toEqual({eventSequence:10,authoringRevision:"results-mc-v1"});
});

test("late MC metadata cannot shorten a result already on screen or move the cursor", async()=>{
  const {createPresentationDirector}=await import("../app/games/[slug]/components/influence-presentation-director");
  let time=0;
  const director=createPresentationDirector({clock:{now:()=>time,setTimeout:()=>1,clearTimeout:()=>{}}});
  director.load(withResultPresentation([result],[]));
  director.play();time=1500;
  const elapsed=director.getTimelineElapsedBaseMs();
  director.append(withResultPresentation([result,house],scenes("results-mc-v1")));
  expect(director.getActiveCue()?.key).toBe("exit");
  expect(director.getActiveCue()?.baseDurationMs).toBe(6000);
  expect(director.getTimelineElapsedBaseMs()).toBe(elapsed);
  director.dispose();
});

test("the retained winner still displays accepted unrecorded closing speech", async()=>{
  const {visualWatchPresentation}=await import("../app/games/[slug]/components/visual-watch-model");
  const message=scenes("historical")[0]!.messages[0]!;
  const view=visualWatchPresentation({enabled:false,status:null,portraits:{},scenes:[]},{...result,kind:"endgame_winner",resultsPresentation:true},message,[{id:"p1",name:"Winner",persona:"",status:"alive",shielded:false}]);
  expect(view.beat).toMatchObject({kind:"house-result",text:message.text,result:{kind:"winner"}});
});
