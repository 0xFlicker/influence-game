import { expect, test } from "bun:test";
import { packStrategyPresentationFixture } from "../../scripts/pack-strategy-presentation-fixture";
import { compilePresentation } from "./presentation";
import { parseTimingProfile } from "./timing";

const settings = {profile:parseTimingProfile({ending:{holdMs:0}}),fps:30,assets:{},music:false};
for (const audience of ["omniscient","mystery"] as const) test(`v13 ${audience} viewer, Studio source and independent cuts share accepted pack content`, async()=>{
  const input = await packStrategyPresentationFixture(audience);
  const source = input.bound;
  const full = compilePresentation({...settings,source,selectedIds:input.catalog.moments.filter(m=>m.defaultIncluded && m.kind !== "thinking").map(m=>m.id)});
  expect(full.cues.map(c=>c.picture)).toEqual(input.base.map(c=>c.picture));
  expect(full.cues.map(c=>c.timing.baseDurationMs)).toEqual(input.base.map(c=>c.timing.baseDurationMs));
  expect(full.cues.map(c=>c.music)).toEqual(input.base.map(c=>c.music));
  const speeches = full.cues.filter(c=>c.picture.kind === "werewolf" && c.picture.cue.moment.entry.kind === "proposal");
  expect(speeches).toHaveLength(audience === "omniscient" ? 4 : 0);
  expect(JSON.stringify(input.catalog)).not.toContain("SECRET_PASS_THINKING");
  if (audience === "mystery") {
    expect(JSON.stringify(full)).not.toContain("Tomorrow I will pressure");
    expect(JSON.stringify(input.catalog)).not.toContain("PRIVATE_PACK_THINKING");
    expect(input.catalog.moments.some(m=>m.kind === "thinking")).toBe(false);
    return;
  }
  expect(speeches.filter(c=>c.speech?.text.startsWith("Tomorrow"))).toHaveLength(2);
  const strategies = input.catalog.moments.filter(m=>{
    const ref = m.source;
    return (ref.kind === "werewolf-event" || ref.kind === "werewolf-action") && input.events.some(e=>e.sequence === ref.eventSequence && e.type === "werewolf.action_accepted" && e.payload.action === "pack_propose" && e.payload.packTurn?.turn === 2);
  });
  expect(strategies.filter(m=>m.kind === "thinking")).toHaveLength(2);
  const speech = strategies.find(m=>m.part.kind === "speech")!;
  const thought = strategies.find(m=>m.kind === "thinking")!;
  const result = input.catalog.moments.find(m=>m.part.kind === "pack_vote")!;
  for (const moment of [speech,thought,result]) {
    expect(moment).toBeDefined();
    const cut = compilePresentation({...settings,source,selectedIds:[moment.id]});
    expect(cut.momentIds).toEqual([moment.id]);
    expect(JSON.stringify(cut)).not.toContain("Let us agree on this attack");
    expect(JSON.stringify(cut)).not.toContain("SECRET_PASS_THINKING");
    if (moment === thought) {
      expect(cut.cues[0]!.picture).toMatchObject({kind:"thinking",gameKind:"werewolf",room:{players:expect.any(Array)}});
      expect(JSON.stringify(cut)).not.toContain("Tomorrow I will pressure");
    }
    if (moment === result) expect(JSON.stringify(cut)).not.toContain("Tomorrow I will pressure");
  }
});
