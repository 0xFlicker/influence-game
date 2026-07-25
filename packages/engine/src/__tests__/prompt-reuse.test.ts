import { expect, test } from "bun:test";
import { PromptReuseAggregate, PromptReuseCollector } from "../prompt-reuse";

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
