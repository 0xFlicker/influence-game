import {expect, test} from "bun:test";
import {layoutThought} from "../components/watch/thought-layout";
for (const [width,height] of [[1200,700],[390,440],[600,240]]) {
  test(`thought and speech fit the same scene at ${width}x${height}`, () => {
    const layout = layoutThought(width!,height!,{left:12,top:height!*.5,width:Math.min(480,width!-24),height:180},{x:width!*.3,y:height!*.4});
    for (const box of [layout.thought,layout.speech]) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left+box.width).toBeLessThanOrEqual(width!);
      expect(box.top+box.height).toBeLessThanOrEqual(height!);
    }
    expect(layout.thought.top+layout.thought.height).toBeLessThan(layout.speech.top);
    expect(layout.thought.height).toBeGreaterThan(70);
  });
}

test("measuring spoken text does not move the thought bubble", () => {
  const head = {x:220,y:240};
  const before = layoutThought(1000,600,{left:480,top:140,width:440,height:308},head);
  const after = layoutThought(1000,600,{left:480,top:250,width:440,height:120},head);
  expect(after.thought).toEqual(before.thought);
});
