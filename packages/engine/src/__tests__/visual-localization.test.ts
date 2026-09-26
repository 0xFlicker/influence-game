import { expect, test } from "bun:test";
import { decodeVisualIdentities, decodeVisualComposition, VisualIdentityFailure } from "../visual-localization";
import type { VisualPlayerAnchor } from "../visual-mode";
const candidates: VisualPlayerAnchor[] = [
  { playerId: "a", label: 1, confidence: "clear", head: { x: 0.1, y: 0.2, width: 0.1, height: 0.1 } },
  { playerId: "b", label: 2, confidence: "clear", head: { x: 0.6, y: 0.3, width: 0.1, height: 0.1 } },
];
const matches = [{ playerId: "a", label: 2, confidence: "clear" }, { playerId: "b", label: 1, confidence: "clear" }];
test("identity verification reassigns observed heads independently of reference order", () => {
  const result = decodeVisualIdentities(JSON.stringify({ count: 2, matches }), ["a", "b"], candidates);
  expect(result.anchors[0]?.head).toEqual(candidates[1]!.head);
  expect(result.anchors[1]?.head).toEqual(candidates[0]!.head);
});
test("malformed, uncertain or non-bijective identities never become accepted anchors", () => {
  const valid = JSON.stringify({ count: 2, matches });
  for (const text of ["not JSON", "{}", `\`\`\`json\n${valid}\n\`\`\``, `result ${valid}`, JSON.stringify({ matches }),
    JSON.stringify({ count: 2, matches, extra: true }), JSON.stringify({ count: 3, matches }),
    JSON.stringify({ count: 2, matches: [matches[0], matches[0]] }),
    JSON.stringify({ count: 2, matches: [{ ...matches[0], confidence: "uncertain" }, matches[1]] }),
    JSON.stringify({ count: 2, matches: [{ ...matches[0], label: 1 }, matches[1]] }),
  ]) expect(() => decodeVisualIdentities(text, ["a", "b"], candidates)).toThrow();
});

test("two labels cannot claim the same physical head", () => {
  const duplicateHeads = candidates.map((candidate) => ({ ...candidate, head: candidates[0]!.head }));
  expect(() => decodeVisualIdentities(JSON.stringify({ count: 2, matches }), ["a", "b"], duplicateHeads)).toThrow("overlap");
});

test("composition failures identify uncertain and non-bijective participants from strict structured output", () => {
  const identities = [{ playerId: "a", confidence: "clear" }, { playerId: "b", confidence: "clear" }];
  expect(decodeVisualComposition(JSON.stringify({ count: 2, identities }), ["a", "b"]).verifiedParticipantIds).toEqual(["a", "b"]);
  for (const [entries, ids] of [
    [[identities[0], { ...identities[1], confidence: "uncertain" }], ["b"]],
    [[identities[0], identities[0]], ["a", "b"]],
  ] as const) {
    let failure: unknown;
    try { decodeVisualComposition(JSON.stringify({ count: 2, identities: entries }), ["a", "b"]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(VisualIdentityFailure);
    expect((failure as VisualIdentityFailure).playerIds).toEqual(ids);
  }
  const valid = JSON.stringify({ count: 2, identities });
  for (const text of ["not JSON", "{}", `\`\`\`json\n${valid}\n\`\`\``, `result ${valid}`, JSON.stringify({ identities }),
    JSON.stringify({ count: 2, identities, extra: true }), JSON.stringify({ count: 3, identities }),
    JSON.stringify({ count: 2, identities: [{ playerId: "a" }, identities[1]] }),
  ]) expect(() => decodeVisualComposition(text, ["a", "b"])).toThrow();
});
