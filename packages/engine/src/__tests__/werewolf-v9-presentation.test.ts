import { expect, test } from "bun:test";
import { projectWerewolfEntry } from "../werewolf/observation";
import { werewolfReportEntry } from "../werewolf/report";
import { werewolfStepDurations } from "../werewolf/watch-timing";
import type { WerewolfView } from "../werewolf/observation";
import type { WerewolfHistoryEntry } from "../werewolf/types";

const players = [
  { id: "a", name: "Ada", avatarUrl: null, personaKey: null, alive: true },
  { id: "b", name: "Bea", avatarUrl: null, personaKey: null, alive: true },
];
const view = (audience: "mystery" | "omniscient", rulesVersion: 7 | 8 | 9 = 9) =>
  ({ players, audience, rulesVersion } as WerewolfView);

test("v9 public conversation and ballots retain their typed recipient, reply, and prefix", () => {
  const conversation: WerewolfHistoryEntry = { kind: "conversation", day: 1, id: 2, actorId: "a", text: "Bea, answer this.", cue: null, recipientId: "b", replyToContributionId: 1, unavailable: false, remainingBytes: 1200 };
  const ballot: WerewolfHistoryEntry = { kind: "ballot", day: 1, actorId: "a", targetId: "b", text: "I trust Bea.", cue: null, unavailable: false, totals: { a: 0, b: 1 }, requiredVotes: 2, remainingVoterIds: ["b"] };
  const projectedConversation = projectWerewolfEntry(conversation, "mystery")[0]!;
  const projectedBallot = projectWerewolfEntry(ballot, "mystery")[0]!;
  expect(projectedConversation).toMatchObject({ kind: "conversation", id: 2, recipientId: "b", replyToContributionId: 1, remainingBytes: 1200 });
  expect(projectedBallot).toMatchObject({ kind: "ballot", actorId: "a", targetId: "b", totals: { a: 0, b: 1 }, remainingVoterIds: ["b"] });
  expect(werewolfReportEntry(projectedConversation, view("mystery"))).toContain("reply to contribution 1");
  expect(werewolfReportEntry(projectedBallot, view("mystery"))).toContain("Ada votes Bea");
});

test("v9 proposal history is private to Omniscient and the final vote report does not repeat ballots", () => {
  const proposal: WerewolfHistoryEntry = { kind: "proposal", day: 1, actorId: "a", targetId: "b", text: "Quietly tonight.", cue: null, unavailable: false, beat: 2 };
  expect(projectWerewolfEntry(proposal, "mystery")).toEqual([]);
  const omniscient = projectWerewolfEntry(proposal, "omniscient")[0]!;
  expect(werewolfReportEntry(omniscient, view("omniscient"))).toContain("Pack proposal 2");
  const result: WerewolfHistoryEntry = { kind: "vote", day: 1, result: { thread: 1, voteMode: "majority", ballots: [{ voterId: "a", targetId: "b", unavailable: false }, { voterId: "b", targetId: null, unavailable: false }], totals: { a: 0, b: 1 }, requiredVotes: 2, dayEnded: true, eliminatedId: null } };
  const report = werewolfReportEntry(projectWerewolfEntry(result, "mystery")[0]!, view("mystery"))!;
  expect(report).toContain("Votes: Bea 1");
  expect(report).not.toContain("Ballots:");
  const legacy = werewolfReportEntry(projectWerewolfEntry(result, "mystery")[0]!, view("mystery", 8))!;
  expect(legacy).toContain("Ballots:");
});

test("silent v9 public entries use the same short duration as their browser replay", () => {
  const silent: WerewolfHistoryEntry = { kind: "ballot", day: 1, actorId: "a", targetId: null, text: null, cue: null, unavailable: false, totals: {}, requiredVotes: 2, remainingVoterIds: ["b"] };
  expect(werewolfStepDurations(projectWerewolfEntry(silent, "mystery")[0]!, players, [], 9)).toEqual([2200]);
});
