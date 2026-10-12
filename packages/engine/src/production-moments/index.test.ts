import { describe, expect, test } from "bun:test";
import {
  assembleProductionCatalog, decodeProductionSelection, productionMomentKey, resolveProductionMomentIds,
  selectProductionMoments, validateProductionTags,
  type ProductionSource,
} from "./index";
import { werewolfResultsFixture } from "../fixtures/werewolf-results";
import { projectWerewolfProductionProvenance, projectWerewolfWatch } from "../werewolf/watch";

const order = (anchor: number, offset = 0) => ({ anchor, offset });
const transcript = (overrides: Partial<Extract<ProductionSource, { kind: "influence-transcript" }>> = {}): ProductionSource => ({
  kind: "influence-transcript", transcriptId: "row-with-no-historical-sequence", order: order(1),
  presentation: "speech", actorId: "a", thinking: "Keep the promise", defaultThinking: true,
  ...overrides,
});
const influence = (sources: readonly ProductionSource[]) => assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });

describe("stable ProductionMoment catalog", () => {
  test("recipes override each kind, reuse labels with OR, and retain source order", () => {
    const catalog = influence([transcript(), transcript({transcriptId: "second", order: order(2), defaultThinking: false}), transcript({transcriptId: "third", order: order(3)})]);
    const [thought, speech, extraThought, extraSpeech, unmarkedThought, lastSpeech] = catalog.moments;
    const annotations: Record<string, Record<string, string>> = {[thought!.id]: {"label.smart": "true", "label.fourth_wall": "true"}, [speech!.id]: {"label.smart": "true"}, [extraThought!.id]: {"label.fourth_wall": "true"}, [extraSpeech!.id]: {"label.aggressive": "true"}};
    const recipe = decodeProductionSelection({mode: "recipe", thinking: true, base: "full", policies: {thinking: {mode: "any", labels: ["fourth_wall", "smart"]}}});
    expect(selectProductionMoments(catalog, recipe, annotations).map(m => m.id)).toEqual([thought!.id, speech!.id, extraThought!.id, extraSpeech!.id, lastSpeech!.id]);
    expect(selectProductionMoments(catalog, {mode: "recipe", thinking: true, base: "empty", policies: {thinking: {mode: "any", labels: ["smart", "fourth_wall"]}}}, annotations).map(m => m.id)).toEqual([thought!.id, extraThought!.id]);
    expect(selectProductionMoments(catalog, {mode: "recipe", thinking: true, base: "full", policies: {thinking: {mode: "any", labels: []}}}, annotations).map(m => m.kind)).toEqual(["speech", "speech", "speech"]);
    expect(selectProductionMoments(catalog, {mode: "recipe", thinking: true, base: "full", policies: {speech: {mode: "none"}, thinking: {mode: "all"}}}).map(m => m.id)).toEqual([thought!.id, extraThought!.id, unmarkedThought!.id]);
    expect(selectProductionMoments(catalog, {mode: "full", thinking: true}).map(m => m.id)).toEqual([thought!.id, speech!.id, extraSpeech!.id, unmarkedThought!.id, lastSpeech!.id]);
    expect(selectProductionMoments(catalog, {...recipe, thinking: false}, annotations).every(m => m.kind !== "thinking")).toBe(true);
  });

  test("recipe validation is finite and matching is exact, without rewriting frozen shapes", () => {
    const recipe = {mode: "recipe", thinking: true, base: "empty", policies: {thinking: {mode: "any", labels: ["mistake", "smart"]}}};
    expect(JSON.stringify(decodeProductionSelection(recipe))).toBe(JSON.stringify(recipe));
    const catalog = influence([transcript()]), thought = catalog.moments[0]!;
    const nonmatches: Record<string, string>[] = [{"label.smart": "True"}, {smart: "true"}, {"label.fourth-wall": "true"}];
    for (const tags of nonmatches) expect(selectProductionMoments(catalog, decodeProductionSelection(recipe), {[thought.id]: tags})).toEqual([]);
    for (const patch of [{base: "other"}, {policies: null}, {policies: {unknown: {mode: "all"}}}, {policies: {thinking: {mode: "any", labels: ["smart", "smart"]}}}, {policies: {thinking: {mode: "any", labels: ["constructor"]}}}, {policies: {thinking: {mode: "all", labels: []}}}, {policies: {thinking: {mode: "any", labels: ["smart"], extra: true}}}, {policies: JSON.parse('{"__proto__":{"mode":"all"}}')}]) expect(() => decodeProductionSelection({...recipe, ...patch})).toThrow();
    for (const mode of [{mode: "full", thinking: true}, {mode: "tagged", thinking: true, predicate: {cut: "youtube"}}, {mode: "ids", thinking: false, ids: []}]) expect(JSON.stringify(decodeProductionSelection(mode))).toBe(JSON.stringify(mode));
  });
  test("one response produces independently selectable thought and speech", () => {
    const catalog = influence([transcript()]);
    const thought = catalog.moments.find(m => m.kind === "thinking")!;
    const speech = catalog.moments.find(m => m.kind === "speech")!;
    expect(thought.id).not.toBe(speech.id);
    expect(thought.sourceKey).toBe(speech.sourceKey);
    const tags = { [thought.id]: { cut: "youtube" }, [speech.id]: { cut: "other" } };
    expect(selectProductionMoments(catalog, { mode: "tagged", thinking: true, predicate: { cut: "youtube" } }, tags).map(m => m.id)).toEqual([thought.id]);
    expect(selectProductionMoments(catalog, { mode: "tagged", thinking: false, predicate: { cut: "youtube" } }, tags)).toEqual([]);
  });

  test("historical row identity survives text, reveal coordinate and presentation changes", () => {
    const original = influence([transcript()]);
    const changed = influence([transcript({ order: order(900, 8), thinking: "Entirely different pages" })]);
    expect(changed.moments.map(m => m.id)).toEqual(original.moments.map(m => m.id));
    expect(original.moments.every(m => m.source.kind === "influence-transcript" && m.source.transcriptId === "row-with-no-historical-sequence")).toBe(true);
  });

  test("new thinking coverage does not expand default full movies", () => {
    const catalog = influence([transcript(), { kind: "influence-thinking", eventSequence: 30, actorId: "b", thinking: "A ballot decision", order: order(2), defaultThinking: false }]);
    expect(catalog.moments.filter(m => m.kind === "thinking")).toHaveLength(2);
    expect(selectProductionMoments(catalog, { mode: "full", thinking: true }).filter(m => m.kind === "thinking")).toHaveLength(1);
    expect(selectProductionMoments(catalog, { mode: "full", thinking: false }).map(m => m.kind)).toEqual(["speech"]);
    expect(influence([transcript({ thinking: "   " })]).moments.map(m => m.kind)).toEqual(["speech"]);
  });

  test("separate Werewolf accepted thoughts remain distinct at the same reveal cursor and actor", () => {
    const catalog = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "omniscient", sources: [
      { kind: "werewolf-action", eventSequence: 42, actorId: "wolf", action: "attack", thinking: "First thought", order: order(12), defaultThinking: false },
      { kind: "werewolf-action", eventSequence: 45, actorId: "wolf", action: "attack", thinking: "Second thought", order: order(12, 1), defaultThinking: false },
    ] });
    expect(catalog.moments).toHaveLength(2);
    expect(catalog.moments[0]!.id).not.toBe(catalog.moments[1]!.id);
    const moved = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "omniscient", sources: [
      { kind: "werewolf-action", eventSequence: 42, actorId: "wolf", action: "attack", thinking: "First thought changed", order: order(99), defaultThinking: false },
    ] });
    expect(moved.moments[0]!.id).toBe(catalog.moments[0]!.id);
  });

  test("day ballot identity uses voter, preserving canonical reveal order without an index", () => {
    const sources: ProductionSource[] = [{ kind: "werewolf-event", eventSequence: 80, order: order(20), entry: {
      kind: "vote", day: 1, result: { thread: 1, voteMode: "majority", requiredVotes: 2, totals: { a: 1 }, eliminatedId: null, dayEnded: false,
        ballots: [{ voterId: "abstainer", targetId: null, unavailable: false }, { voterId: "voter", targetId: "a", unavailable: false }] },
    } }];
    const catalog = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "omniscient", sources });
    expect(catalog.moments.map(m => m.kind)).toEqual(["ballot", "ballot", "tally", "outcome"]);
    expect(catalog.moments[0]!.actorId).toBe("voter");
    expect(catalog.moments[1]!.actorId).toBe("abstainer");
    const voter = catalog.moments[0]!;
    expect(voter.id).toBe(productionMomentKey("w", { kind: "werewolf-event", eventSequence: 80 }, { kind: "ballot", voterId: "voter", purpose: "day", juryTiebreaker: false, revote: false }));
    expect(selectProductionMoments(catalog, { mode: "ids", ids: [catalog.moments[1]!.id, voter.id], thinking: false }).map(m => m.id)).toEqual([voter.id, catalog.moments[1]!.id]);
  });

  test("finite format stages and jury ballot discriminators cannot collide", () => {
    const catalog = influence([
      { kind: "influence-event", eventSequence: 10, order: order(1), presentation: { kind: "format_selected", stage: "choice_legible" } },
      { kind: "influence-event", eventSequence: 10, order: order(1, 1), presentation: { kind: "format_selected", stage: "rules_reveal" } },
      { kind: "influence-event", eventSequence: 11, order: order(2), presentation: { kind: "endgame_ballot", voterId: "a" } },
      { kind: "influence-event", eventSequence: 11, order: order(2, 1), presentation: { kind: "endgame_ballot", voterId: "a", juryTiebreaker: true } },
    ]);
    expect(new Set(catalog.moments.map(m => m.id)).size).toBe(4);
    const unsupported = { kind: "influence-event", eventSequence: 12, order: order(3), presentation: { kind: "made_up_stage" } };
    expect(() => influence([unsupported as ProductionSource])).toThrow("Unsupported Influence");
  });

  test("duplicates and ambiguous provenance fail with source diagnostics", () => {
    expect(() => influence([transcript(), transcript({ order: order(20), thinking: null })])).toThrow("Duplicate or ambiguous production moment");
    expect(() => influence([transcript({ presentation: "ballot", ballot: undefined })])).toThrow("structured provenance");
    expect(() => influence([{ kind: "werewolf-action", eventSequence: 1, actorId: "a", action: "vote", thinking: "private", order: order(1), defaultThinking: false }])).toThrow("Cross-game");
    expect(() => influence([transcript({ thinking: "secret", actorId: undefined })])).toThrow("thinking actor");
  });

  test("Mystery excludes private sources, night decisions and handcrafted IDs", () => {
    const sources: ProductionSource[] = [
      { kind: "werewolf-event", eventSequence: 12, order: order(2), entry: { kind: "speech", day: 0, actorId: "a", audience: "public", text: "Hello", cue: null } },
      { kind: "werewolf-action", eventSequence: 14, order: order(4), actorId: "wolf", action: "attack", thinking: "PRIVATE_THOUGHT", defaultThinking: true },
      { kind: "werewolf-event", eventSequence: 15, order: order(5), entry: { kind: "speech", day: 1, actorId: "wolf", audience: "pack", text: "PRIVATE_PACK", cue: null } },
      { kind: "werewolf-event", eventSequence: 20, order: order(6), entry: { kind: "night", day: 1, killedId: null, attackTargetId: "a", protectedId: "a" }, nightActions: [
        { kind: "protect", actorId: "doctor", targetId: "a" }, { kind: "hunt", wolfIds: ["wolf"], targetId: "a" },
      ] },
    ];
    const omniscient = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "omniscient", sources });
    const mystery = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "mystery", sources });
    expect(mystery.moments.map(m => m.kind)).toEqual(["speech", "outcome"]);
    expect(JSON.stringify(mystery)).not.toContain("PRIVATE");
    expect(selectProductionMoments(mystery, {mode: "recipe", thinking: true, base: "empty", policies: {thinking: {mode: "all"}, action: {mode: "all"}}})).toEqual([]);
    expect(mystery.moments[0]!.id).toBe(omniscient.moments[0]!.id);
    const privateIds = omniscient.moments.filter(m => m.kind === "thinking" || m.kind === "action" || m.actorId === "wolf").map(m => m.id);
    for (const id of privateIds) expect(() => resolveProductionMomentIds(mystery, [id])).toThrow("Unavailable production moment");
    expect(() => resolveProductionMomentIds(mystery, [productionMomentKey("other-game", { kind: "werewolf-event", eventSequence: 12 }, { kind: "speech" })])).toThrow("Unavailable");
  });

  test("opening is atomic and results are explicit, with exact AND tags and immutable IDs", () => {
    const catalog = influence([
      { kind: "opening", gameKind: "influence", order: order(0) }, transcript(),
      { kind: "influence-event", eventSequence: 90, order: order(9), presentation: { kind: "endgame_winner" } },
    ]);
    const speech = catalog.moments.find(m => m.kind === "speech")!;
    const thought = catalog.moments.find(m => m.kind === "thinking")!;
    const tags = { [speech.id]: { cut: "youtube", tone: "sharp" }, [thought.id]: { cut: "youtube", tone: "Sharp" } };
    const selection = { mode: "tagged" as const, thinking: true, predicate: { cut: "youtube", tone: "sharp" } };
    const selected = selectProductionMoments(catalog, selection, tags);
    expect(selected.map(m => m.id)).toEqual([speech.id]);
    expect(selectProductionMoments(catalog, { ...selection, includeOpening: true, includeResult: true }, tags).map(m => m.kind)).toEqual(["opening", "speech", "result"]);
    expect(selectProductionMoments(catalog, selection, { [speech.id]: { cut: "later" } })).toEqual([]);
    expect(selectProductionMoments(catalog, { mode: "ids", thinking: true, ids: selected.map(m => m.id) }, { [speech.id]: { cut: "later" } }).map(m => m.id)).toEqual([speech.id]);
    expect(() => resolveProductionMomentIds(catalog, [speech.id, speech.id])).toThrow("Duplicate selected");
    expect(() => selectProductionMoments(catalog, { mode: "tagged", thinking: true, predicate: {} })).toThrow("1–32");
  });

  test("flat tags enforce byte limits and exact values without prototype authority", () => {
    expect(validateProductionTags({ cut: " youtube " }).cut).toBe(" youtube ");
    for (const invalid of [[], { cut: "" }, { cut: 1 }, { cut: { nested: "x" } }, { "bad key": "x" }, { constructor: "x" }, { prototype: "x" }, JSON.parse('{"__proto__":"x"}'), { cut: "é".repeat(129) }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`key${i}`, "v"]))]) {
      expect(() => validateProductionTags(invalid)).toThrow();
    }
    expect(Object.keys(validateProductionTags({}))).toEqual([]);
  });

  test("selection decoder rejects unknown modes, coercion, fields and malformed IDs", () => {
    expect(decodeProductionSelection({ mode: "full", thinking: false })).toEqual({ mode: "full", thinking: false });
    expect(decodeProductionSelection({ mode: "ids", thinking: false, ids: [] })).toEqual({ mode: "ids", thinking: false, ids: [] });
    for (const value of [null, [], { mode: "anything", thinking: false }, { mode: "full", thinking: "false" }, { mode: "full", thinking: false, predicate: {} }, { mode: "tagged", thinking: true, predicate: {} }, { mode: "tagged", thinking: true, predicate: { cut: "x" }, includeResult: 1 }, { mode: "ids", thinking: false, ids: "abc" }, { mode: "ids", thinking: false, ids: ["same", "same"] }]) expect(() => decodeProductionSelection(value)).toThrow();
    expect(() => resolveProductionMomentIds(influence([transcript()]), "pm1:bad" as unknown as string[])).toThrow("array");
  });

  test("new pack ballot coverage is independently selectable without expanding default movies", () => {
    const catalog = assembleProductionCatalog({ gameId: "w", gameKind: "werewolf", audience: "omniscient", sources: [
      { kind: "werewolf-event", eventSequence: 30, order: order(8), entry: { kind: "pack_vote", day: 1, result: { attempt: 1, ballots: [{ voterId: "wolf-a", targetId: "target" }, { voterId: "wolf-b", targetId: "target" }], targetId: "target", endReason: "agreed" } } },
    ] });
    expect(catalog.moments.map(m => m.kind)).toEqual(["ballot", "ballot", "tally"]);
    expect(selectProductionMoments(catalog, { mode: "full", thinking: true }).map(m => m.part.kind)).toEqual(["pack_vote"]);
    const first = catalog.moments[0]!;
    expect(selectProductionMoments(catalog, { mode: "tagged", thinking: true, predicate: { cut: "pack" } }, { [first.id]: { cut: "pack" } }).map(m => m.id)).toEqual([first.id]);
  });

  test("producer-only provenance maps both audiences without changing public watch DTOs", async () => {
    const events = await werewolfResultsFixture("saved", "production-provenance");
    const omniscient = projectWerewolfProductionProvenance(events, "omniscient");
    const mystery = projectWerewolfProductionProvenance(events, "mystery");
    const pack = events.find(e => e.type === "werewolf.action_accepted" && e.payload.action === "pack_talk")!;
    expect(omniscient.some(row => row.eventSequence === pack.sequence)).toBe(true);
    expect(mystery.some(row => row.eventSequence === pack.sequence)).toBe(false);
    expect(projectWerewolfProductionProvenance(events, "mystery", 3)).toEqual(mystery.slice(0, 3));
    expect(() => projectWerewolfProductionProvenance(events, "mystery", mystery.length + 1)).toThrow("Unavailable");
    const publicWindow = projectWerewolfWatch(events, "mystery", 1, 64);
    expect(JSON.stringify(publicWindow.moments)).not.toContain("eventSequence");
    expect(publicWindow.moments.every(m => Object.keys(m).includes("cursor"))).toBe(true);
  });
});
