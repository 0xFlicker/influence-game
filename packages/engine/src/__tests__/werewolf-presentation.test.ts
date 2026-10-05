import { expect, test } from "bun:test";
import { projectWerewolfPresentation } from "../werewolf/presentation";
import { startWerewolf, werewolfConfig, replayWerewolf } from "../werewolf/rules";
import { runWerewolf, type WerewolfAgent } from "../werewolf/runner";

for (const preset of ["one_wolf", "two_wolves"] as const) test(`${preset}: complete presentation preserves every audience-local moment and its causal roster`, async () => {
  const players = Array.from({ length: preset === "one_wolf" ? 6 : 8 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "", backstory: "", strategy: "SECRET STRATEGY", avatarUrl: null }));
  const events = [startWerewolf("replay", players, werewolfConfig(preset, 2), "replay-fixture")];
  const agent: WerewolfAgent = { decide: async ({ request }) => request.action === "open_thread" ? { kind: "opening", text: null, cue: "Pauses", recipientIds: [] } : request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "SECRET REASON" } : { kind: "speech", text: request.action === "pack_talk" ? "SECRET PACK" : "Hello", cue: null } };
  await runWerewolf({ read: async () => structuredClone(events), append: async event => { events.push(structuredClone(event)); } }, agent);
  const state = replayWerewolf(events);
  for (const audience of ["mystery", "omniscient"] as const) {
    const final = projectWerewolfPresentation(events, audience);
    expect(final.view.phase).toBe("complete");
    for (let cursor = 1; cursor <= final.latestCursor; cursor++) {
      const frame = projectWerewolfPresentation(events, audience, cursor);
      expect(frame.view.cursor).toBe(cursor);
      expect(frame.view.entries).toEqual(final.view.entries.slice(0, cursor));
      expect(frame.latestCursor).toBe(final.latestCursor);
      expect(JSON.stringify(frame)).not.toContain("SECRET STRATEGY");
      expect(JSON.stringify(frame)).not.toContain("SECRET REASON");
      if (audience === "mystery") {
        expect(frame.roomId).toBe(frame.view.entries.at(-1)!.day === 0 || frame.view.entries.at(-1)!.kind === "night" ? null : "lobby");
        expect(JSON.stringify(frame)).not.toContain("SECRET PACK");
        if (frame.view.phase !== "complete") expect(frame.view.players.every(p => !p.role)).toBe(true);
      } else if (frame.roomId === "mingle-1") expect(frame.participantIds.every(id => state.roles[id] === "werewolf")).toBe(true);
      const entry = frame.view.entries.at(-1)!;
      const eliminated = entry.kind === "night" ? entry.killedId : entry.kind === "vote" ? entry.result.eliminatedId : null;
      if (eliminated) {
        if (entry.kind !== "night" || audience === "omniscient") expect(frame.participantIds).toContain(eliminated);
        expect(frame.view.players.find(p => p.id === eliminated)?.alive).toBe(false);
      }
    }
  }
  expect(() => projectWerewolfPresentation(events, "mystery", 0)).toThrow("Invalid replay position");
});
