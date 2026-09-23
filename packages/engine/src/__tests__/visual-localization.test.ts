import { expect, test } from "bun:test";
import { decodeVisualIdentities } from "../visual-localization";
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
