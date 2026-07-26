import { expect, test } from "bun:test";
import {
  PromptReuseAggregate,
  PromptReuseCollector,
  RecallPlanReceiptAggregate,
} from "../prompt-reuse";
import type { RecallPlanReceipt } from "../game-runner.types";
import {
  isStructuralRecallEvaluationJson,
  serializeRecallPlanReceipt,
} from "../context-recall-plan";

test("prompt reuse receipt is structural-only and identifies the first break", () => {
  const collector = new PromptReuseCollector();
  const first = collector.observe([{ role: "system", content: "instructions" }, { role: "user", content: "round one" }], { lane: "player-1", requestShape: "chat_completions" });
  const second = collector.observe([{ role: "system", content: "instructions" }, { role: "user", content: "round two" }], { lane: "player-1", requestShape: "chat_completions" });
  expect(first.comparable).toBe(false);
  expect(second.comparable).toBe(true);
  expect(second.firstBreak).toBe("m1:user");
  expect(JSON.stringify(second)).not.toContain("round two");
});

test("aggregate exposes no per-request hashes or content", () => {
  const aggregate = new PromptReuseAggregate();
  const collector = new PromptReuseCollector();
  aggregate.add(collector.observe([{ role: "system", content: "one" }], { lane: "x", requestShape: "chat_completions" }));
  aggregate.add(collector.observe([{ role: "system", content: "one" }], { lane: "x", requestShape: "chat_completions" }));
  const snapshot = aggregate.snapshot();
  expect(snapshot.requestCount).toBe(2);
  expect(snapshot.reusableCharacters).toBe(3);
  expect(JSON.stringify(snapshot)).not.toContain("canonicalHash");
  expect(JSON.stringify(snapshot)).not.toContain("one");
});

function makeStructuralReceipt(overrides: Partial<RecallPlanReceipt> = {}): RecallPlanReceipt {
  return {
    promptClass: "strategic_decision",
    protectedTokenEstimate: 100,
    hotTokenEstimate: 20,
    historyTokenEstimate: 40,
    selectedLaneCounts: { protected: 5, hot: 2, history: 1 },
    selectedByRankSlot: [{ rankSlot: 0, lane: "history", sourceClass: "public" }],
    eventBoundary: {
      maxAuthorizedEntrySequence: 42,
      authorizedCandidateCount: 7,
      protectedRecordCount: 5,
    },
    protectedOverflow: false,
    ...overrides,
  };
}

test("recall plan receipt aggregate is structural-only and rolls up event boundary", () => {
  const aggregate = new RecallPlanReceiptAggregate();
  aggregate.add(
    makeStructuralReceipt({
      promptClass: "ordinary_speech",
      historyTokenEstimate: 0,
      selectedLaneCounts: { protected: 4, hot: 1, history: 0 },
      selectedByRankSlot: [],
      eventBoundary: {
        maxAuthorizedEntrySequence: 10,
        authorizedCandidateCount: 3,
        protectedRecordCount: 4,
      },
    }),
  );
  aggregate.add(
    makeStructuralReceipt({
      selectedByRankSlot: [
        { rankSlot: 0, lane: "history", sourceClass: "public" },
        { rankSlot: 1, lane: "history", sourceClass: "mingle" },
      ],
      selectedLaneCounts: { protected: 6, hot: 0, history: 2 },
      eventBoundary: {
        maxAuthorizedEntrySequence: 99,
        authorizedCandidateCount: 11,
        protectedRecordCount: 6,
      },
    }),
  );

  const snapshot = aggregate.snapshot();
  expect(snapshot.coverage).toBe("structural_recall_receipts");
  expect(snapshot.requestCount).toBe(2);
  expect(snapshot.byPromptClass.ordinary_speech).toBe(1);
  expect(snapshot.byPromptClass.strategic_decision).toBe(1);
  expect(snapshot.eventBoundary.maxAuthorizedEntrySequence).toBe(99);
  expect(snapshot.eventBoundary.totalAuthorizedCandidateCount).toBe(14);
  expect(snapshot.historySourceClassCounts).toEqual({ public: 1, mingle: 1 });

  const serialized = JSON.stringify(snapshot);
  expect(isStructuralRecallEvaluationJson(serialized)).toBe(true);
  expect(serialized).not.toContain("dialogueText");
  expect(serialized).not.toContain("thinking");
  expect(serialized).not.toContain("reasoningContext");
  expect(serialized).not.toContain("canonicalHash");
  // No names or free-text dialogue.
  expect(serialized).not.toContain("Atlas");
  expect(serialized).not.toContain("Stay on Vera");
});

test("serializeRecallPlanReceipt stays structural and event-boundary-only", () => {
  const receipt = makeStructuralReceipt();
  const serialized = serializeRecallPlanReceipt(receipt);
  expect(isStructuralRecallEvaluationJson(serialized)).toBe(true);
  const parsed = JSON.parse(serialized) as RecallPlanReceipt;
  expect(parsed.eventBoundary).toEqual({
    maxAuthorizedEntrySequence: 42,
    authorizedCandidateCount: 7,
    protectedRecordCount: 5,
  });
  expect(parsed).not.toHaveProperty("dialogueText");
  expect(parsed).not.toHaveProperty("actorId");
  expect(parsed).not.toHaveProperty("actorName");
});
