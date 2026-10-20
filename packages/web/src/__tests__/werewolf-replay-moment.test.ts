import { expect, test } from "bun:test";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { replayWerewolf } from "@influence/engine/werewolf";
import { projectWerewolfView } from "@influence/engine/werewolf/observation";
import type { WerewolfHistoryEntry } from "@influence/engine/werewolf/types";
import { SILENT_BALLOT_DURATION_MS } from "@influence/engine/visual-speech";
import { replayMoment } from "../components/games/werewolf/replay-moment";

test("v9 result copy describes majority and proposal outcomes without replaying choices", async () => {
  const events = await completedWerewolfResultsFixture("saved", "replay-copy-v8", 1);
  const historical = projectWerewolfView(replayWerewolf(events), "omniscient");
  const vote = historical.entries.find(entry => entry.kind === "vote");
  const packVote = historical.entries.find(entry => entry.kind === "pack_vote");
  if (vote?.kind !== "vote" || packVote?.kind !== "pack_vote") throw new Error("Fixture is missing vote entries");
  const v9View = { ...historical, rulesVersion: 9 as const, entries: [
    { ...vote, result: { ...vote.result, voteMode: "majority" as const, requiredVotes: 5, dayEnded: true, eliminatedId: null } },
  ] };
  const ballotResult = replayMoment(v9View);
  expect(ballotResult.title).toBe("Day 1 · Public vote result");
  expect(ballotResult.text).toBe("No majority. Nobody is eliminated.");
  expect(ballotResult.details.some(detail => detail.includes("→"))).toBe(false);
  const packResult = replayMoment({ ...v9View, entries: [{ ...packVote, result: { ...packVote.result, targetId: null, endReason: "attempt_limit" as const } }] });
  expect(packResult.title).toBe("Pack proposal result");
  expect(packResult.text).toBe("No agreement. No attack tonight.");

  const legacyBallot = replayMoment({ ...historical, entries: [vote] });
  expect(legacyBallot.title).toContain("Vote after thread");
});

test("silent v9 ballot replay uses the canonical short beat duration", async () => {
  const events = await completedWerewolfResultsFixture("saved", "silent-v9-ballot-replay", 1);
  const historical = projectWerewolfView(replayWerewolf(events), "mystery");
  const silent: WerewolfHistoryEntry = { kind: "ballot", day: 1, actorId: historical.players[0]!.id, targetId: null, text: null, cue: null, unavailable: false, totals: {}, requiredVotes: 3, remainingVoterIds: [] };
  expect(replayMoment({ ...historical, rulesVersion: 9, entries: [silent] }).duration).toBe(SILENT_BALLOT_DURATION_MS);
});
