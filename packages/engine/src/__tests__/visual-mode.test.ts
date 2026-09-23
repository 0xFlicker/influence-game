import { describe, expect, it } from "bun:test";
import { Phase } from "../types";
import { VISUAL_ROOMS, assertVisualAnchors, latestSceneCues, mingleVisualRoom, visualRoomForPhase, type AcceptedVisualScene, type VisualPlayerAnchor } from "../visual-mode";

const anchor: VisualPlayerAnchor = { playerId: "a", label: 1, confidence: "clear", head: { x: .2, y: .3, width: .1, height: .1 } };

describe("visual scenes", () => {
  it("has stable five-room Mingle identities and no implicit default room", () => {
    expect(Object.keys(VISUAL_ROOMS)).toHaveLength(8);
    expect(mingleVisualRoom(4)).toBe("mingle-4");
    expect(mingleVisualRoom(5)).toBe("mingle-5");
    expect(visualRoomForPhase(Phase.FORMAT_MINGLE, 5)).toBe("mingle-5");
    for (const invalid of [0, 6, 1.5, NaN]) expect(() => mingleVisualRoom(invalid)).toThrow();
    expect(() => visualRoomForPhase(Phase.FORMAT_MINGLE)).toThrow();
  });

  it("never generates scenes for portraits or procedural phases", () => {
    for (const phase of [Phase.INTRODUCTION, Phase.VOTE, Phase.FORMAT_RESOLVE, Phase.DIARY_ROOM, Phase.JURY_VOTE, Phase.END]) {
      expect(visualRoomForPhase(phase)).toBeNull();
    }
    expect(visualRoomForPhase(Phase.LOBBY)).toBe("lobby");
    expect(visualRoomForPhase(Phase.PLEA, undefined, "reckoning")).toBe("lobby");
    expect(visualRoomForPhase(Phase.LOBBY, undefined, "tribunal")).toBe("tribunal");
    expect(visualRoomForPhase(Phase.DEFENSE)).toBe("tribunal");
    expect(visualRoomForPhase(Phase.JURY_QUESTIONS)).toBe("finals");
  });

  it("rejects partial, ambiguous, duplicated or out-of-bounds localization", () => {
    expect(() => assertVisualAnchors([anchor], ["a"])).not.toThrow();
    expect(() => assertVisualAnchors([anchor], ["a", "b"])).toThrow();
    expect(() => assertVisualAnchors([anchor, anchor], ["a", "b"])).toThrow();
    expect(() => assertVisualAnchors([{ ...anchor, confidence: "uncertain" }], ["a"])).toThrow();
    expect(() => assertVisualAnchors([{ ...anchor, head: { ...anchor.head, x: .95 } }], ["a"])).toThrow();
    expect(() => assertVisualAnchors([{ ...anchor, head: { ...anchor.head, y: NaN } }], ["a"])).toThrow();
  });

  it("shares only latest cues of current occupants in the accepted scene", () => {
    const scene: AcceptedVisualScene = { id: "scene-2", roomId: "mingle-1", version: 2, imageUrl: "clean", annotatedImageUrl: "numbered", participantIds: ["a"], anchors: [anchor] };
    const cue = "Looks down. Quiet.";
    const records = [
      { sceneId: "scene-1", playerId: "a", turnId: "1", cue },
      { sceneId: "scene-2", playerId: "b", turnId: "2", cue },
      { sceneId: "scene-2", playerId: "a", turnId: "3", cue },
      { sceneId: "scene-2", playerId: "a", turnId: "4", cue },
    ];
    expect(latestSceneCues(scene, records)).toEqual([records[3]!]);
  });
});

import { decodeVisualLocalization } from "../visual-localization";

describe("exact scene localization", () => {
  const valid = { count: 1, anchors: [anchor] };
  it("accepts exact observations and rejects non-JSON, wrappers, missing and extra fields", () => {
    expect(decodeVisualLocalization(JSON.stringify(valid), ["a"])).toEqual(valid);
    for (const raw of ["not json", "{}", `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, JSON.stringify({ ...valid, extra: true }), JSON.stringify({ anchors: [anchor] }), JSON.stringify({ count: 2, anchors: [anchor] })]) {
      expect(() => decodeVisualLocalization(raw, ["a"])).toThrow();
    }
  });
});
