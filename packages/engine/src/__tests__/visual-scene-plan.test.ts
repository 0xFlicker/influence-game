import { expect, test } from "bun:test";
import { planVisualScene, sameVisualArrangement, visualRenderGroups } from "../visual-scene-plan";
const cast = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, referenceArtifactId: `ref-${index}`, performanceInstructions: "Still and attentive" }));
const base = { roomId: "lobby" as const, backgroundArtifactId: "lobby-v1", cast };

test("groups explicit allies, excludes absent identities and uses small render groups", () => {
  const plan = planVisualScene({ ...base, allianceGroups: [["p8", "p1", "p3", "absent"], ["p8", "p2"]] });
  expect(plan.allianceGroups).toEqual([["p8", "p1", "p3"], ["p2"]]);
  expect(new Set(plan.placements.filter((p) => ["p8", "p1", "p3"].includes(p.playerId)).map((p) => p.sectionId)).size).toBe(1);
  const groups = visualRenderGroups(plan);
  expect(groups.every((group) => group.length <= 4)).toBe(true);
  expect(groups.flat().map((p) => p.playerId).sort()).toEqual(cast.map((p) => p.id).sort());
});

test("preserves furniture positions while adding/removing occupants without capacity restrictions", () => {
  const previous = planVisualScene({ ...base, roomId: "mingle-1", cast: cast.slice(0, 4) });
  const next = planVisualScene({ ...base, roomId: "mingle-1", cast: cast.slice(1), previous });
  for (const placement of previous.placements.slice(1)) expect(next.placements).toContainEqual(placement);
  expect(next.placements).toHaveLength(11);
  expect(new Set(next.placements.map((p) => `${p.sectionId}:${p.position}`)).size).toBe(11);
});

test("cue changes alone do not invalidate a reusable scene; empty rooms require no render groups", () => {
  const previous = planVisualScene(base);
  const next = planVisualScene({ ...base, previous, cues: [{ playerId: "p1", cue: { behavior: "Folds arms", delivery: "Quiet", intendedAction: "" } }] });
  expect(sameVisualArrangement(previous, next)).toBe(true);
  expect(sameVisualArrangement(previous, planVisualScene({ ...base, previous, cast: cast.slice(1) }))).toBe(false);
  expect(visualRenderGroups(planVisualScene({ ...base, cast: [] }))).toEqual([]);
});

test("role changes re-stage addresses and finalists separately from listeners", () => {
  const previous = planVisualScene({ ...base, roomId: "tribunal", roles: { p0: "addressing" } });
  const next = planVisualScene({ ...base, roomId: "tribunal", previous, roles: { p1: "addressing" } });
  expect(next.placements.find((p) => p.playerId === "p1")?.sectionId).toBe("address");
  expect(next.placements.find((p) => p.playerId === "p0")?.sectionId).toBe("listeners");
  const finals = planVisualScene({ ...base, roomId: "finals", roles: { p0: "finalist", p1: "finalist" } });
  expect(finals.placements.filter((p) => p.sectionId === "finalists").map((p) => p.playerId)).toEqual(["p0", "p1"]);
});
