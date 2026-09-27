import { describe, expect, test } from "bun:test";
import { sceneImageLayers, type SceneCameraView } from "../app/games/[slug]/components/scene-image";

const from: SceneCameraView = { url: "/frame-0", frame: { width: 720, height: 1080, left: 600, top: 0 }, focusX: .5, panelTreatment: "focal" };
const to: SceneCameraView = { ...from, url: "/frame-1", frame: { ...from.frame, left: 780 }, focusX: .25 };

describe("director-owned scene transitions", () => {
  test("outgoing pixels blur and fade before removal while incoming pixels become sharp", () => {
    const start = sceneImageLayers(from, to, 0, 1);
    expect(start[0]!.frame).toEqual(from.frame);
    expect(start[0]!.opacity).toBe(1);
    expect(start[1]!.opacity).toBe(0);
    const middle = sceneImageLayers(from, to, 225, 1);
    expect(middle[0]!.opacity).toBeGreaterThan(0);
    expect(middle[0]!.opacity).toBeLessThan(1);
    expect(middle[0]!.blur).toBeGreaterThan(0);
    expect(middle[0]!.exiting).toBe(true);
    expect(middle[1]!.frame.left).not.toBe(to.frame.left);
    expect(middle[1]!.blur).toBeGreaterThan(0);
    expect(sceneImageLayers(from, to, 450, 1)).toEqual([{ ...to, opacity: 1, blur: 0, exiting: false }]);
  });

  test("a held director time freezes the complete scene rather than only its camera", () => {
    const held = sceneImageLayers(from, to, 180, -1);
    expect(sceneImageLayers(from, to, 180, -1)).toEqual(held);
    expect(sceneImageLayers(from, to, 300, -1)).not.toEqual(held);
  });

  test("speaker changes in the same image interpolate both framing and the focal mask", () => {
    const nextSpeaker = { ...to, url: from.url };
    const start = sceneImageLayers(from, nextSpeaker, 0, 0);
    const middle = sceneImageLayers(from, nextSpeaker, 225, 0);
    expect(start[0]!.frame).toEqual(from.frame);
    expect(start[0]!.focusX).toBe(from.focusX);
    expect(middle).toHaveLength(1);
    expect(middle[0]!.focusX).toBeGreaterThan(to.focusX);
    expect(middle[0]!.focusX).toBeLessThan(from.focusX);
    expect(middle[0]!.frame.left).toBeGreaterThan(from.frame.left);
    expect(middle[0]!.frame.left).toBeLessThan(to.frame.left);
    expect(middle[0]!.opacity).toBe(1);
    expect(middle[0]!.blur).toBe(0);
  });

  test("unrelated images dissolve in place and separate panels retain their original step", () => {
    const dissolve = sceneImageLayers(from, to, 225, 0);
    expect(dissolve[0]!.frame).toEqual(from.frame);
    expect(dissolve[1]!.frame).toEqual(to.frame);
    const separate = sceneImageLayers({ ...from, panelTreatment: "separate" }, { ...to, panelTreatment: "separate" }, 0, 1);
    expect(separate[1]!.frame.left - from.frame.left).toBe(from.frame.width);
  });
});
