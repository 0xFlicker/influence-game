import { expect, test } from "bun:test";
import { werewolfResultsFixture } from "../fixtures/werewolf-results";
import { replayWerewolf } from "../werewolf/rules";
import { werewolfSceneInventory } from "../werewolf/visual-scenes";
import { projectWerewolfWatch } from "../werewolf/watch";

for (const scenario of ["village", "wolves", "saved", "disagreement"] as const) test(`${scenario}: production scenes and hunt staging use canonical, audience-safe casts`, async () => {
  const events = await werewolfResultsFixture(scenario);
  const scenes = werewolfSceneInventory(events);
  expect(scenes.every(scene => scene.day > 0)).toBe(true);
  const nights = events.filter(event => event.type === "werewolf.night_resolved");
  const hunts = scenes.filter(scene => scene.purpose === "hunt");
  expect(hunts).toHaveLength(nights.filter(event => event.payload.attackTargetId !== null).length);
  for (const scene of scenes) {
    const before = replayWerewolf(events.filter(event => event.sequence <= scene.boundarySequence));
    expect(scene.participantIds.every(id => before.aliveIds.includes(id))).toBe(true);
    expect(scene.wolfIds.every(id => before.roles[id] === "werewolf")).toBe(true);
    if (scene.purpose === "hunt") expect(scene.participantIds).toEqual([...scene.wolfIds, scene.targetId!]);
    if (scene.purpose === "pack") expect(scene.wolfIds.length).toBeGreaterThan(1);
  }
  if (scenario === "village") expect(scenes.some(scene => scene.purpose === "pack")).toBe(false);
  if (scenario === "saved") expect(hunts.length).toBeGreaterThan(0);
  if (scenario === "disagreement") expect(hunts).toHaveLength(0);
  for (const audience of ["mystery", "omniscient"] as const) {
    const all = projectWerewolfWatch(events, audience);
    const moments = Array.from({length: all.latestCursor}, (_, i) => projectWerewolfWatch(events, audience, i + 1, 1).moments[0]!);
    const staged = moments.filter(moment => moment.night?.actions.some(action => action.kind === "hunt"));
    expect(staged).toHaveLength(audience === "omniscient" ? hunts.length : 0);
    if (audience === "mystery") expect(moments.every(moment => !moment.night)).toBe(true);
    if (audience === "mystery") expect(moments.filter(moment => moment.entry.kind === "night").every(moment => moment.staging.roomId === null)).toBe(true);
    for (const moment of staged) {
      expect(moment.night!.before.players.find(player => player.id === moment.night!.actions.find(action => action.kind === "hunt")!.targetId)!.alive).toBe(true);
      expect(all.playback.find(step => step.cursor === moment.cursor)?.steps).toBe(moment.night!.actions.length + 1);
    }
  }
});
