import {projectWerewolfPresentation} from "../werewolf/presentation";
import {describe, expect, test} from "bun:test";
import {completedHunterFixture} from "../fixtures/werewolf-hunter";
import {werewolfHouseNarrationInput, werewolfHouseNarrationArtifact} from "../werewolf/house-narration";
import {projectWerewolfProductionWatch} from "../werewolf/watch";
import {werewolfHouseSpeech, werewolfNightHouseSpeech} from "../werewolf/house-speech";
import {replayWerewolf} from "../werewolf/rules";
import {observeWerewolf} from "../werewolf/observation";

describe("Werewolf House narration", () => {
  test("exact output rejects malformed, missing, extra and oversized summaries", () => {
    const artifact = werewolfHouseNarrationArtifact(["scene", "snipe"]);
    for (const invalid of [null, [], "prose", {}, {scene: "one"}, {scene: "one", snipe: "two", extra: "three"}, {scene: " ", snipe: "two"}, {scene: "x".repeat(601), snipe: "two"}]) {
      expect(artifact.decodeProviderPayload(invalid).status).toBe("invalid");
      expect(artifact.decodeAcceptedValue(invalid).status).toBe("invalid");
    }
    expect(artifact.decodeProviderPayload({scene: "Dawn breaks.", snipe: "The Hunter holds."}).status).toBe("valid");
  });
  test("audience-safe inputs and saved copy survive projection without changing authority", async () => {
    const events = await completedHunterFixture("double");
    const index = events.findIndex(event => event.type === "werewolf.night_resolved");
    const prefix = events.slice(0, index + 1);
    const mystery = werewolfHouseNarrationInput(prefix, "mystery")!;
    const omniscient = werewolfHouseNarrationInput(prefix, "omniscient")!;
    expect(mystery.actions).toEqual([]);
    expect(mystery.requestedParts).toEqual(["scene"]);
    expect(JSON.stringify(mystery)).not.toContain('"protectedId"');
    expect(JSON.stringify(mystery)).not.toContain('"snipeKilledId"');
    expect(JSON.stringify(mystery)).not.toContain("snipe");
    expect(JSON.stringify(mystery)).not.toContain("pack");
    expect(omniscient.requestedParts).toContain("snipe");
    const before = replayWerewolf(prefix);
    const observation = observeWerewolf(before, before.aliveIds[0]!);
    events[index]!.houseNarration = {mystery: {scene: "Two voices are missing at dawn."}, omniscient: {scene: "The pack and Hunter both struck.", snipe: "One shot breaks the silence."}};
    expect(replayWerewolf(prefix)).toEqual(before);
    expect(observeWerewolf(replayWerewolf(prefix), before.aliveIds[0]!)).toEqual(observation);
    for (const audience of ["mystery", "omniscient"] as const) {
      const window = projectWerewolfProductionWatch(events, audience);
      const moment = window.moments.find(row => row.entry.kind === "night")!;
      expect(werewolfHouseSpeech(moment.entry, moment.snapshot.players, window.rulesVersion)).toBe(events[index]!.houseNarration![audience]!.scene!);
      expect(projectWerewolfPresentation(events,audience,moment.cursor).view.entries.at(-1)!.houseSpeech).toBe(moment.entry.houseSpeech);
      if (audience === "omniscient") {
        const action = moment.night!.actions.find(action => action.kind === "snipe")!;
        expect(werewolfNightHouseSpeech(action, moment.snapshot.players)).toBe("One shot breaks the silence.");
      } else expect(JSON.stringify(window)).not.toContain("One shot breaks the silence.");
    }
  });
  test("night-action authoring cannot see dawn deaths or sibling choices", async () => {
    const events = await completedHunterFixture("double");
    const index = events.findIndex(event => event.type === "werewolf.night_resolved");
    const prefix = events.slice(0,index+1);
    const hunt = werewolfHouseNarrationInput(prefix,"omniscient","hunt")!;
    const shot = werewolfHouseNarrationInput(prefix,"omniscient","snipe")!;
    for (const input of [hunt,shot]) {
      expect(input.entry).toBeNull();
      expect(input.actions).toHaveLength(1);
      expect(input).not.toHaveProperty("recentDialogue");
      expect(JSON.stringify(input)).not.toContain("killedId");
      expect(JSON.stringify(input)).not.toContain("snipeKilledId");
      expect(input.livingPlayerCount).toBe(8);
      expect(input.players.every(player=>player.alive)).toBe(true);
    }
    expect(hunt.requestedParts).toEqual(["hunt"]);
    expect(shot.requestedParts).toEqual(["snipe"]);
    expect(hunt.announcementKind).toBe("night_action");
    expect(hunt.countTiming).toBe("before_night_resolution");
    expect(werewolfHouseNarrationInput(prefix,"mystery","hunt")).toBeNull();
  });
  test("vote narration supplies the living count and exact majority after deaths", async () => {
    const events = await completedHunterFixture("held");
    const index = events.findIndex(event => event.type === "werewolf.phase_started" && event.payload.phase === "vote");
    expect(index).toBeGreaterThan(0);
    const input = werewolfHouseNarrationInput(events.slice(0,index+1),"mystery")!;
    expect(input.livingPlayerCount).toBe(input.players.filter(player => player.alive).length);
    expect(input.requiredVotes).toBe(Math.floor(input.livingPlayerCount/2)+1);
    expect(input.voting).toEqual({method:"strict_majority_of_living",ballots:"public_sequential",abstentionAllowed:true});
    expect(input).not.toHaveProperty("recentDialogue");
  });
  test("every authored beat receives facts without fallback or previously saved prose", async () => {
    const events = await completedHunterFixture("double");
    const seen = new Set<string>();
    for (const [index,event] of events.entries()) {
      event.houseNarration = {mystery:{scene:"SAVED PRIVATE COPY"},omniscient:{scene:"SAVED PRIVATE COPY",snipe:"SAVED PRIVATE COPY"}};
      for (const audience of ["mystery","omniscient"] as const) {
        const prefix=events.slice(0,index+1);
        const input=werewolfHouseNarrationInput(prefix,audience);
        if (!input) continue;
        for (const part of input.requestedParts) {
          const scoped=werewolfHouseNarrationInput(prefix,audience,part)!;
          const serialized=JSON.stringify(scoped);
          expect(scoped).not.toHaveProperty("required");
          expect(scoped).not.toHaveProperty("recentDialogue");
          expect(serialized).not.toContain("SAVED PRIVATE COPY");
          expect(serialized).not.toContain("houseSpeech");
          expect(serialized).not.toContain("The village sleeps");
          expect(serialized).not.toContain("The hunt is on");
          expect(serialized).not.toContain("shot remains unfired");
          seen.add(part === "scene" ? scoped.entry!.kind : part);
        }
      }
    }
    for (const beat of ["phase","pack_vote","night","vote","result","hunt","protect","snipe"]) expect(seen.has(beat)).toBe(true);
  });
  test("Mystery excludes pack dialogue and never falls back to Omniscient narration", async () => {
    const events=await completedHunterFixture("double");
    for (const event of events) event.houseNarration={omniscient:{scene:"PRIVATE PACK ANNOUNCEMENT"}};
    const mystery=projectWerewolfProductionWatch(events,"mystery");
    expect(JSON.stringify(mystery)).not.toContain("PRIVATE PACK ANNOUNCEMENT");
    expect(mystery.moments.some(row=>row.entry.kind === "proposal" || row.entry.kind === "pack_vote" || row.entry.kind === "speech" && row.entry.audience === "pack")).toBe(false);
    for (const [index,event] of events.entries()) {
      const prefix=events.slice(0,index+1);
      if (event.type === "werewolf.pack_vote_resolved") expect(werewolfHouseNarrationInput(prefix,"mystery")).toBeNull();
      if (event.type !== "werewolf.phase_started" || !["pack","day","vote"].includes(event.payload.phase)) continue;
      for (const audience of ["mystery","omniscient"] as const) {
        const input=werewolfHouseNarrationInput(prefix,audience,"scene")!;
        expect(input.entry?.kind).toBe("phase");
        expect(input.actions).toEqual([]);
        expect(input).not.toHaveProperty("recentDialogue");
        expect(JSON.stringify(input)).not.toContain("PRIVATE PACK ANNOUNCEMENT");
      }
    }
  });
  test("historical events retain fixed narration and no new fields in observations", async () => {
    const events = await completedHunterFixture("held");
    const window = projectWerewolfProductionWatch(events, "omniscient");
    const night = window.moments.find(row => row.entry.kind === "night")!;
    expect(night.entry.houseSpeech).toBeUndefined();
    expect(werewolfNightHouseSpeech(night.night!.actions.find(action => action.kind === "snipe")!, night.snapshot.players)).toContain("holds their snipe");
    for (const [index, event] of events.entries()) if (event.type === "werewolf.action_accepted") expect(werewolfHouseNarrationInput(events.slice(0,index+1), "omniscient")).toBeNull();
  });
});

test("native House requests distinguish dawn from choices and end with authoritative facts", async () => {
  const {default:OpenAI} = await import("openai");
  const {createProviderAdapter} = await import("../provider-adapters");
  const {modelCatalogEntryById} = await import("../model-catalog");
  const {generateWerewolfHouseNarration} = await import("../werewolf/house-narration");
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  let calls = 0;
  for (const mode of ["held","double","saved"] as const) {
    const events = await completedHunterFixture(mode);
    const index = events.findIndex(event => event.type === "werewolf.night_resolved");
    const prefix = events.slice(0,index+1);
    const expectedLiving = mode === "held" ? 7 : mode === "double" ? 6 : 8;
    for (const audience of ["mystery","omniscient"] as const) {
      const seen = new Set<string>();
      const client = new OpenAI({apiKey:"fixture",baseURL:"http://fixture.invalid/v1",maxRetries:0,fetch:async(_url,init)=>{
        const request=JSON.parse(String(init?.body));
        expect(request.messages.map((message:{role:string})=>message.role)).toEqual(["system","user"]);
        const instructions=request.messages[0].content as string;
        const serialized=request.messages.at(-1).content as string;
        const input=JSON.parse(serialized);
        expect(Object.keys(input).indexOf("players")).toBeLessThan(Object.keys(input).indexOf("announcementKind"));
        expect(serialized.endsWith(`"requiredVotes":null,"livingPlayerCount":${input.livingPlayerCount}}`)).toBe(true);
        expect(input.requestedParts).toHaveLength(1);
        seen.add(input.announcementKind);
        if (input.announcementKind === "dawn_result") {
          expect(instructions).toContain("Announce dawn and the result of the completed night");
          expect(instructions).toContain("never subtract the casualties again");
          expect(instructions).toContain("If no deaths are supplied");
          expect(instructions).not.toContain("before night resolution");
          expect(input.countTiming).toBe("after_current_event");
          expect(input.livingPlayerCount).toBe(expectedLiving);
          expect(input.actions).toEqual([]);
          if (audience === "mystery") {
            expect(input.entry.deadPlayerIds).toHaveLength(8-expectedLiving);
            expect(serialized).not.toContain("protectedId");
            expect(serialized).not.toContain("attackTargetId");
          } else if (mode === "saved") {
            expect(input.entry.killedId).toBeNull();
            expect(input.entry.protectedId).toBe(input.entry.attackTargetId);
          }
        } else {
          expect(input.announcementKind).toBe("night_action");
          expect(instructions).toContain("Announce only the supplied night-action choice or held shot");
          expect(instructions).toContain("Do not reveal or predict dawn deaths");
          expect(instructions).toContain("A supplied Seer investigation result belongs to that action and may be announced");
          expect(instructions).not.toContain("Announce dawn");
          expect(input.countTiming).toBe("before_night_resolution");
          expect(input.livingPlayerCount).toBe(8);
          expect(input.entry).toBeNull();
          expect(input.actions).toHaveLength(1);
          expect(serialized).not.toContain("killedId");
        }
        const content=JSON.stringify({[input.requestedParts[0]]:"A fixture announcement."});
        return Response.json({id:`house-order-${calls++}`,object:"chat.completion",created:0,model:model.modelId,
          choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:10}});
      }});
      const runtime={adapter:createProviderAdapter("katana",client),catalogId:model.id,providerProfileId:"katana" as const,modelId:model.modelId,
        modelCapabilities:model.capabilities,reasoningPolicy:"medium" as const,position:0,role:"primary" as const};
      await generateWerewolfHouseNarration({events:prefix,audience,runtimes:[runtime],hooks:{},ownerEpoch:"fixture"});
      expect([...seen].sort()).toEqual(audience === "mystery" ? ["dawn_result"] : ["dawn_result","night_action"]);
    }
  }
});

test("House authoring retries malformed native payloads and rejects exhausted output", async () => {
  const {default:OpenAI} = await import("openai");
  const {createProviderAdapter} = await import("../provider-adapters");
  const {modelCatalogEntryById} = await import("../model-catalog");
  const {generateWerewolfHouseNarration} = await import("../werewolf/house-narration");
  const events = (await completedHunterFixture("held")).slice(0,1);
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  const valid = JSON.stringify({scene:"Welcome to the village. Introduce yourselves."});
  const run = async (responses:string[]) => {
    let calls = 0;
    const client = new OpenAI({apiKey:"fixture",baseURL:"http://fixture.invalid/v1",maxRetries:0,fetch:async(_url,init)=>{
      const request=JSON.parse(String(init?.body));
      expect(request.messages[0].content).toContain("game-show announcer");
      expect(request.messages[0].content).toContain("Introduce only the supplied current phase");
      expect(request.messages[0].content).not.toContain("Announce dawn");
      expect(request.messages[0].content).not.toContain("Announce only the supplied night-action choice");
      const input=JSON.parse(request.messages[1].content);
      expect(input).not.toHaveProperty("required");
      expect(input.requestedParts).toEqual(["scene"]);
      expect(input.entry).toEqual({kind:"phase",day:0,phase:"introduction"});
      expect(input.announcementKind).toBe("phase");
      expect(input.countTiming).toBe("after_current_event");
      expect(JSON.stringify(input)).not.toContain("Introduce yourselves");
      const content=responses[Math.min(calls++,responses.length-1)]!;
      return Response.json({id:`house-${calls}`,object:"chat.completion",created:0,model:model.modelId,
        choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
    }});
    const runtime = {adapter:createProviderAdapter("katana",client),catalogId:model.id,providerProfileId:"katana" as const,modelId:model.modelId,
      modelCapabilities:model.capabilities,reasoningPolicy:"medium" as const,position:0,role:"primary" as const};
    const result = generateWerewolfHouseNarration({events,audience:"mystery",runtimes:[runtime],hooks:{},ownerEpoch:"fixture"});
    return {result,calls:()=>calls};
  };
  for (const malformed of ["plain prose",'{"scene":',"{} {}","{}",'{"scene":"hello","extra":"no"}']) {
    const invocation=await run([malformed,valid]);
    expect((await invocation.result)?.copy.scene).toBe("Welcome to the village. Introduce yourselves.");
    expect(invocation.calls()).toBe(2);
  }
  const wrapped=await run([`\`\`\`json\n${valid}\n\`\`\``]);
  expect((await wrapped.result)?.copy.scene).toBe("Welcome to the village. Introduce yourselves.");
  const exhausted=await run(["{}"]);
  await expect(exhausted.result).rejects.toThrow();
  expect(exhausted.calls()).toBe(3);
  expect(events[0]!.houseNarration).toBeUndefined();
},30_000);
