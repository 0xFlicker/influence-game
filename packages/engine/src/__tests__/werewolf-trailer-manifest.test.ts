import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import type { WerewolfDecision } from "../werewolf/types";
import { describe, expect, test } from "bun:test";
import { buildWerewolfTrailerManifest, validateWerewolfTrailerManifest, werewolfTrailerCueSheet } from "../postgame-media/werewolf-trailer-manifest";
import { parseHouseHighlightsTrailerManifest } from "../postgame-media/house-highlights-trailer-manifest";
import { hashHouseHighlightsTrailerManifest } from "../postgame-media/house-highlights-trailer-manifest-hash";
import { werewolfResultsFixture } from "../fixtures/werewolf-results";
import { walkWerewolfHistory } from "../werewolf/watch";
import type { HouseCutsResponse, PublishedHouseCut } from "../house-cuts/publication";

async function fixture(scenario: "village" | "saved" = "village") {
  const events = await werewolfResultsFixture(scenario);
  const frames = [...walkWerewolfHistory(events, "mystery")];
  const state = frames.at(-1)!.state;
  const intro = frames.find(f => f.entry?.kind === "speech" && f.entry.day === 0)!;
  if (intro.entry?.kind !== "speech") throw new Error("Missing introduction");
  const introActor = intro.entry.actorId;
  const cut: PublishedHouseCut = { id: "one", title: "DO NOT COPY LATER OUTCOME", context: "SECRET_ROLE", angle: "FUTURE_WINNER", payoff: "DOCTOR_SAVE",
    quotes: [{ name: state.players.find(p=>p.id===introActor)!.name, text: intro.entry.text! }],
    participants: [], sourceRefs: [`w:${intro.cursor}`], replayHref: null };
  const cuts: HouseCutsResponse = { game: { id: state.gameId, slug: "fixture", kind: "werewolf" }, audience: "mystery", status: "ready",
    publication: { version: "published-v1", audience: "mystery", cuts: [cut] } };
  return { events, frames, cut, cuts, slug: "fixture" };
}

describe("Werewolf House trailer", () => {
  test("pins permitted quotes, normal identities and provenance without editorial hindsight", async () => {
    const f = await fixture(); const manifest = buildWerewolfTrailerManifest(f);
    expect(manifest.story.quotes).toHaveLength(1);
    expect(manifest.story.quotes[0]!.text).toBe("Hello, village.");
    expect(manifest.cast.every(p => p.status === "unknown" && p.placement === null)).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/SECRET_|FUTURE_|DOCTOR_SAVE|finalVote|winnerIds|protectedId|attackTargetId/);
    expect(parseHouseHighlightsTrailerManifest(JSON.stringify(manifest))).toEqual(manifest);
    const changed = structuredClone(manifest); changed.story.publicationVersion = "published-v2";
    expect(hashHouseHighlightsTrailerManifest(changed)).not.toBe(hashHouseHighlightsTrailerManifest(manifest));
  });
  test("freezes saved episode copy while preserving the stable slug", async () => {
    const input = await fixture();
    const episode = { title: "Lanterns and Lies", description: "Six strangers gather at the village table." };
    const manifest = buildWerewolfTrailerManifest({ ...input, episode });
    episode.title = "Later operator edit";
    expect(manifest.story.title).toBe("Lanterns and Lies");
    expect(manifest.story.description).toBe(episode.description);
    expect(manifest.game.slug).toBe(input.slug);
    expect(parseHouseHighlightsTrailerManifest(manifest)).toEqual(manifest);
    expect(buildWerewolfTrailerManifest(input).story.title).toBe(input.slug);
    for (const copy of [{ title: "", description: "Valid" }, { title: "x".repeat(91), description: "Valid" }, { title: "Valid", description: "x".repeat(281) }]) {
      expect(() => buildWerewolfTrailerManifest({ ...input, episode: copy })).toThrow();
    }
  });
  test("does not use a safe quote from a Cut with unsafe or unresolved evidence", async () => {
    const f = await fixture("saved");
    const unsafe = f.frames.find(frame=>frame.entry?.kind === "night")!;
    for (const ref of [`w:${unsafe.cursor}`, "w:999999"]) {
      f.cut.sourceRefs.push(ref);
      expect(buildWerewolfTrailerManifest(f).story.quotes).toEqual([]);
      f.cut.sourceRefs.pop();
    }
    expect(buildWerewolfTrailerManifest(f).cast).toHaveLength(8);
  });
  test("rejects wrong audience, game, unresolved input and incomplete history", async () => {
    const f=await fixture();
    expect(()=>buildWerewolfTrailerManifest({...f,events:f.events.slice(0,-1)})).toThrow();
    expect(()=>buildWerewolfTrailerManifest({...f,cuts:{...f.cuts,audience:"omniscient"}})).toThrow("mismatch");
    expect(()=>buildWerewolfTrailerManifest({...f,cuts:{...f.cuts,game:{...f.cuts.game,id:"other"}}})).toThrow("mismatch");
    expect(()=>buildWerewolfTrailerManifest({...f,cuts:{...f.cuts,status:"pending",publication:null}})).toThrow("waiting");
  });
  test("empty and failed editorial work produce an honest nine-second teaser", async () => {
    const f=await fixture(); f.cuts.publication!.cuts=[];
    for (const cuts of [f.cuts,{...f.cuts,status:"failed" as const,publication:null}]) {
      const m=buildWerewolfTrailerManifest({...f,cuts});
      expect(m.story.quotes).toEqual([]); expect(m.cueSheet.totalDurationSeconds).toBe(9);
      expect(m.cueSheet.segments.map(s=>s.kind)).toEqual(["cast_roster","end_card"]);
    }
  });
  test("omits oversized, misattributed, duplicate and fabricated quotes instead of rewriting them", async () => {
    const f=await fixture();
    f.cut.quotes[0]!.text="fabricated"; expect(buildWerewolfTrailerManifest(f).story.quotes).toEqual([]);
    f.cut.quotes[0]!.text="Hello, village."; f.cut.quotes[0]!.name="wrong"; expect(buildWerewolfTrailerManifest(f).story.quotes).toEqual([]);
    const good=await fixture();good.cuts.publication!.cuts.push(good.cut);
    expect(buildWerewolfTrailerManifest(good).story.quotes).toHaveLength(1);
  });
  test("strict render parsing rejects missing/extra fields, spoilers and cue corruption", async () => {
    const m=buildWerewolfTrailerManifest(await fixture());
    const bad: unknown[]=[{},"{}",{...m,kind:"third"},{...m,schemaVersion:1},{...m,privateState:{}},
      {...m,story:{...m.story,thinking:"secret"}}, {...m,cast:m.cast.map(p=>({...p,status:"winner"}))},
      {...m,cueSheet:{...m.cueSheet,totalFrames:1}}, {...m,story:{...m.story,musicAssetId:"golden-verdict-max"}},
      {...m,story:{...m.story,quotes:[{...m.story.quotes[0]!,speakerId:"not-cast"}]}},
      {...m,story:{...m.story,quotes:[{...m.story.quotes[0]!,text:"x".repeat(231)}]}}];
    for (const value of bad) expect(()=>parseHouseHighlightsTrailerManifest(value)).toThrow();
    expect(validateWerewolfTrailerManifest(m).ok).toBe(true);
  });
  test("reading time grows with quote length while frames remain contiguous", () => {
    const sheet=werewolfTrailerCueSheet([{id:"quote:w:5",sourceRef:"w:5",speakerId:"p",text:"one ".repeat(25)}]);
    expect(sheet.segments[1]!.durationSeconds).toBe(10);
    expect(sheet.totalFrames).toBe(19*30);
    expect(sheet.segments[2]!.startFrame).toBe(sheet.segments[1]!.endFrame);
  });
});


test("only the first public discussion before the first ballot is eligible, with a three-moment ceiling", async () => {
  const initial = (await fixture()).frames.at(-1)!.state;
  const events = [startWerewolf("discussion-fixture", initial.players, werewolfConfig("one_wolf", 2), "discussion-seed")];
  let state = replayWerewolf(events);
  while (!state.outcome) {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") break;
    let event;
    if (step.kind === "event") event = werewolfEvent(state, step.event);
    else {
      const request = step.request;
      const decision: WerewolfDecision = request.action === "open_thread"
        ? {kind:"opening", text:`Question ${state.sequence}`, cue:null, recipientIds:request.legalRecipientIds.slice(0,1)}
        : request.action === "vote" && request.voteMode === "majority"
          ? {kind:"target",targetId:null,thinking:""}
          : request.legalTargetIds.length
            ? {kind:"target",targetId:request.legalTargetIds[0]!,thinking:""}
            : {kind:"speech",text:`Statement ${state.sequence}`,cue:null};
      event = werewolfEvent(state, {type:"werewolf.action_accepted",payload:{...request,decision,fallback:null}});
    }
    state=applyWerewolfEvent(state,event); events.push(event);
  }
  const frames=[...walkWerewolfHistory(events,"mystery")];
  const ballot=frames.find(f=>f.entry?.kind === "vote" && f.entry.day === 1)!;
  expect(ballot).toBeDefined();
  const discussion=frames.filter(f=>f.entry?.kind === "discussion");
  expect(discussion.some(f=>f.cursor > ballot.cursor)).toBe(true);
  const cuts=discussion.map(f=>{
    if(f.entry?.kind!=="discussion") throw new Error("Missing discussion");
    const entry=f.entry;
    return {id:`cut-${f.cursor}`,title:"Ignored",context:"",angle:"",payoff:"",participants:[],replayHref:null,sourceRefs:[`w:${f.cursor}`],
      quotes:[{name:state.players.find(p=>p.id===entry.contribution.actorId)!.name,text:f.entry.contribution.text!}]};
  });
  const input={events,slug:"fixture",cuts:{game:{id:state.gameId,slug:"fixture",kind:"werewolf" as const},audience:"mystery" as const,status:"ready" as const,publication:{version:"v1",audience:"mystery" as const,cuts}}};
  const manifest=buildWerewolfTrailerManifest(input);
  expect(manifest.story.quotes).toHaveLength(3);
  expect(manifest.story.quotes.every(q=>Number(q.sourceRef.slice(2)) < ballot.cursor)).toBe(true);
  input.cuts.publication.cuts=cuts.filter(c=>Number(c.sourceRefs[0]!.slice(2)) > ballot.cursor);
  expect(buildWerewolfTrailerManifest(input).story.quotes).toEqual([]);
});
