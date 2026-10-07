import { describe, expect, test } from "bun:test";
import { cutSource } from "../house-cuts/source";
import { cutInfluenceFixture, cutWerewolfFixture, cutFixtureReports } from "../house-cuts/fixtures";
import { influenceCutSource } from "../house-cuts/influence-source";
import { werewolfCutSource } from "../house-cuts/werewolf-source";
import { discoverCuts, editCutSelection, planCutDiscovery, validateCutProposals, type CutWindow, type CutProposalBatch } from "../house-cuts/editorial";
import { renderCutReview } from "../house-cuts/review-html";
import { projectWerewolfWatch } from "../werewolf/watch";

const input = cutInfluenceFixture();
const source = influenceCutSource(input.events, input.dialogue, "fixture-influence");
const limits = { maxCalls: 100, maxInputBytesPerCall: 32_000, maxOutputTokensPerCall: 4_000 };
const window = planCutDiscovery(source, limits).windows[0]!;
const batch = (w: CutWindow = window): CutProposalBatch => ({ sourceHash: w.sourceHash, windowId: w.id, candidates: [{ id: "warm-audit", title: "A warm audit", context: "Trust meets a question.", angle: "An affectionate contradiction.", payoff: null,
  sourceRefs: w.evidence.slice(0, 2).map(e => e.id), participantIds: w.evidence.slice(0, 2).flatMap(e => e.participantIds),
  quotes: w.evidence.slice(0, 2).map(e => ({ sourceRef: e.id, excerpt: e.content.kind === "dialogue" ? e.content.text : "" })), factRefs: [], rationale: "A standalone exchange." }] });

 test("Influence adapter strips private fields and refuses guessed identity/replay positions", () => {
  const withSecrets = input.dialogue.map(e => ({ ...e, thinking: "PRIVATE_THINKING", reasoningContext: "RAW_REASONING" }));
  withSecrets.push({ ...withSecrets[0]!, scope: "thinking", text: "HIDDEN" });
  const projected = influenceCutSource(input.events, withSecrets, "fixture-influence");
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_THINKING|RAW_REASONING|HIDDEN/);
  expect(projected.evidence[0]!.replayHref).toBeNull();
  expect(() => influenceCutSource(input.events, [{ ...input.dialogue[0]!, speakerPlayerId: undefined }], "fixture")).toThrow("stable speaker");
  expect(() => influenceCutSource(input.events.slice(1), input.dialogue, "fixture")).toThrow();
  expect(() => influenceCutSource(input.events.slice(0, input.events.findIndex(e => e.type === "jury.winner_determined")), [], "fixture")).toThrow("complete");
  const changed = structuredClone(input.dialogue); changed[0]!.text += "!";
  expect(influenceCutSource(input.events, changed, "fixture-influence").hash).not.toBe(source.hash);
 });

 test("Werewolf projection keeps pack and resolved secrets out of Mystery, preserves exact cursors", () => {
  const events = cutWerewolfFixture();
  const mystery = werewolfCutSource(events, "fixture", "mystery"), omni = werewolfCutSource(events, "fixture", "omniscient");
  expect(JSON.stringify(mystery)).not.toContain("agree on a target quietly");
  expect(JSON.stringify(mystery)).not.toMatch(/PRIVATE_THINKING|PRIVATE_STRATEGY|protectedId|attackTargetId|investigation|winnerIds/);
  expect(JSON.stringify(omni)).toContain("agree on a target quietly");
  expect(JSON.stringify(omni)).not.toMatch(/PRIVATE_THINKING|PRIVATE_STRATEGY/);
  expect(mystery.hash).not.toBe(omni.hash);
  // Read replay windows once instead of replaying the full match for every fact.
  const moments = new Map<number, ReturnType<typeof projectWerewolfWatch>["moments"][number]>();
  const lastCursor = Math.max(...mystery.evidence.map(e => e.position));
  for (let cursor = 1; cursor <= lastCursor; cursor += 64) {
    for (const moment of projectWerewolfWatch(events, "mystery", cursor, 64).moments) moments.set(moment.cursor, moment);
  }
  for (const e of mystery.evidence) {
    const moment = moments.get(e.position)!;
    expect(moment.cursor).toBe(e.position);
    expect(e.replayHref).toBe(`/games/fixture/replay?audience=mystery&cursor=${e.position}`);
    if (e.content.kind === "dialogue" && moment.entry.kind === "discussion") expect(e.content.text).toBe(moment.entry.contribution.text!);
  }
  expect(() => werewolfCutSource(events.slice(0, -1), "fixture", "mystery")).toThrow("complete");
  const damaged = structuredClone(events); damaged[2]!.sequence += 1;
  expect(() => werewolfCutSource(damaged, "fixture", "mystery")).toThrow();
 });

 describe("strict candidate acceptance", () => {
  test("one dialogue-led moment with no payoff/alliance/elimination is valid; zero is valid", () => {
    expect(validateCutProposals(batch(), window).candidates).toHaveLength(1);
    expect(validateCutProposals({ ...batch(), candidates: [] }, window).candidates).toHaveLength(0);
  });
  for (const invalid of ["not JSON", "{}", "```json\n{}\n```", {}, { candidates: [] }, { ...batch(), extra: true }]) test(`reject malformed output ${JSON.stringify(invalid).slice(0, 45)}`, () => {
    expect(() => validateCutProposals(invalid, window)).toThrow("Invalid Cut output");
  });
  test("reject invented quote, source, participant and fact; schema extras and omissions", () => {
    const changes = [
      (b: ReturnType<typeof batch>) => { b.candidates[0]!.quotes[0]!.excerpt = "A made-up admission"; },
      (b: ReturnType<typeof batch>) => { b.candidates[0]!.sourceRefs[0] = "another-game"; },
      (b: ReturnType<typeof batch>) => { b.candidates[0]!.participantIds[0] = "not-a-player"; },
      (b: ReturnType<typeof batch>) => { b.candidates[0]!.factRefs = [window.evidence[0]!.id]; },
      (b: ReturnType<typeof batch>) => { b.candidates[0]!.sourceRefs.reverse(); },
      (b: ReturnType<typeof batch>) => { b.sourceHash = "other-audience"; },
      (b: ReturnType<typeof batch>) => { b.windowId = "other-window"; },
      (b: ReturnType<typeof batch>) => { Object.assign(b.candidates[0]!, { invented: true }); },
      (b: ReturnType<typeof batch>) => { Reflect.deleteProperty(b.candidates[0]!, "payoff"); },
      (b: ReturnType<typeof batch>) => { b.candidates.push(structuredClone(b.candidates[0]!)); },
    ];
    for (const mutate of changes) { const b = batch(); mutate(b); expect(() => validateCutProposals(b, window)).toThrow(); }
  });
 });

 test("preflight covers every allowed entry or rejects before invoking anything", async () => {
  const plan = planCutDiscovery(source, limits);
  expect(plan.coverage.includedEntries).toBe(source.evidence.length);
  expect(new Set(plan.windows.flatMap(w => w.evidence.map(e => e.id))).size).toBe(source.evidence.length);
  let calls = 0;
  await expect(discoverCuts(source, async () => { calls++; throw new Error("should not run"); }, { ...limits, maxCalls: 1 })).rejects.toThrow("No calls started");
  expect(calls).toBe(0);
  expect(() => planCutDiscovery(source, { ...limits, maxInputBytesPerCall: 2 })).toThrow("input budget");
  const mutated = structuredClone(source); mutated.cast[0]!.name = "Changed";
  expect(() => planCutDiscovery(mutated, limits)).toThrow("snapshot");
  const { hash: _hash, version: _version, ...original } = source;
  expect(() => cutSource({ ...original, evidence: [source.evidence[0]!, source.evidence[0]!] })).toThrow("reference");
 });

 test("runner supplies native schema and semantic validator; malformed value never yields accepted report", async () => {
  await expect(discoverCuts(source, async request => {
    expect(request.model).toBe("openai:gpt-6-luna");
    expect(request.schema.additionalProperties).toBe(false);
    expect(() => request.accept({})).toThrow();
    return { decoded: {}, kind: "fixture", costUsd: 0 };
  }, limits)).rejects.toThrow("Invalid Cut output");
 });

 test("selection keeps single/empty stories, explains rejected duplicates and validates ranking", async () => {
  const report = await discoverCuts(source, async request => ({ decoded: request.window.id === window.id ? batch(request.window)
    : { sourceHash: request.window.sourceHash, windowId: request.window.id, candidates: [] }, kind: "fixture", costUsd: 0 }), limits);
  expect(editCutSelection(report, []).selected).toHaveLength(0);
  const first = report.candidates[0]!;
  const duplicate = { ...first, key: "alternate", proposal: { ...first.proposal, title: "Another angle" } };
  report.candidates.push(duplicate);
  const selection = editCutSelection(report, [first.key, duplicate.key]);
  expect(selection.selected).toHaveLength(1); expect(selection.rejected[0]!.reason).toContain("Overlapping");
  expect(() => editCutSelection(report, ["missing"])).toThrow();
  expect(() => editCutSelection(report, [first.key, first.key])).toThrow();
 });

 test("HTML review escapes hostile prose, labels fixtures/costs, includes source context and thin results", async () => {
  const reports = await cutFixtureReports();
  reports[0]!.candidates[0]!.proposal.title = '<script>alert("hi")</script>';
  reports[0]!.candidates[0]!.replayHref = "javascript:alert(1)";
  const html = renderCutReview(reports, [[reports[0]!.candidates[0]!.key], [], [], []]);
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("javascript:");
  expect(html).toContain("Synthetic fixture preview"); expect(html).toContain("No selected moment");
  expect(html).toContain("Original context"); expect(html).toContain("$0.0000");
  expect(html).toContain("grid-template-columns:1fr");
 });

 test("private pack dialogue changes do not alter Mystery source identity", () => {
  const events = cutWerewolfFixture(), changed = structuredClone(events);
  const pack = changed.find(e => e.type === "werewolf.action_accepted" && e.payload.action === "pack_talk");
  if (!pack || pack.type !== "werewolf.action_accepted" || pack.payload.decision.kind !== "speech") throw new Error("Missing fixture pack speech");
  pack.payload.decision.text = "A different secret conversation.";
  expect(werewolfCutSource(changed, "fixture", "mystery").hash).toBe(werewolfCutSource(events, "fixture", "mystery").hash);
  expect(werewolfCutSource(changed, "fixture", "omniscient").hash).not.toBe(werewolfCutSource(events, "fixture", "omniscient").hash);
 });

 test("night packets connect canonical choices and first morning; doctor saves are audience-safe seeds", () => {
  for (const outcome of ["save", "miss", "no_attack"] as const) {
    const events = cutWerewolfFixture(outcome);
    const omni = werewolfCutSource(events, "night-fixture", "omniscient");
    const mystery = werewolfCutSource(events, "night-fixture", "mystery");
    const packet = planCutDiscovery(omni, limits).windows.find(w => w.evidence[0]?.group === "night:1")!;
    expect(packet).toBeDefined();
    expect(packet.evidence.some(e => e.content.kind === "dialogue" && e.content.text.includes("quietly"))).toBe(true);
    expect(packet.evidence.some(e => e.content.kind === "dialogue" && e.content.text.includes("Who would you actually protect"))).toBe(true);
    expect(packet.evidence.filter(e => e.content.kind === "fact" && "kind" in e.content.value && e.content.value.kind === "night")).toHaveLength(1);
    expect(JSON.stringify(omni).includes('"doctorSave"')).toBe(outcome === "save");
    expect(JSON.stringify(mystery)).not.toMatch(/doctorSave|protectedId|attackTargetId|investigation|agree on a target quietly/);
    expect(new Set(planCutDiscovery(omni, limits).windows.flatMap(w => w.evidence.map(e => e.id))).size).toBe(omni.evidence.length);
    if (outcome === "save") {
      const fact = packet.evidence.find(e => e.content.kind === "fact" && "doctorSave" in e.content.value)!;
      expect(fact.content.kind).toBe("fact");
      if (fact.content.kind !== "fact" || !("doctorSave" in fact.content.value)) throw new Error("Missing save");
      const save = fact.content.value.doctorSave as { doctorId: string; targetId: string };
      expect(fact.participantIds).toContain(save.doctorId);
      expect(fact.participantIds).toContain(save.targetId);
    }
  }
 });

 test("anonymous fact-led Cut is valid without invented dialogue or participants", () => {
  const mystery = werewolfCutSource(cutWerewolfFixture("save"), "night-fixture", "mystery");
  const packet = planCutDiscovery(mystery, limits).windows.find(w => w.evidence[0]?.group === "night:1")!;
  const fact = packet.evidence.find(e => e.content.kind === "fact")!;
  expect(fact.participantIds).toEqual([]);
  const candidate = { ...batch().candidates[0]!, title: "Everyone made it to morning", sourceRefs: [fact.id], participantIds: [], quotes: [], factRefs: [fact.id] };
  expect(validateCutProposals({ sourceHash: packet.sourceHash, windowId: packet.id, candidates: [candidate] }, packet).candidates).toHaveLength(1);
  expect(() => validateCutProposals({ sourceHash: packet.sourceHash, windowId: packet.id, candidates: [{ ...candidate, factRefs: [] }] }, packet)).toThrow("no quote or fact");
 });
