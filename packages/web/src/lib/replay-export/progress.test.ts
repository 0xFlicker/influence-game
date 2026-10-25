import { expect, test } from "bun:test";
import { createRenderProgress } from "./progress";

test("terminal progress estimates remaining work, fits 80 columns, and closes only on completion", () => {
  let time = 0;
  const writes: string[] = [];
  const progress = createRenderProgress({now: () => time, stream: {isTTY: true, columns: 80, write: text => writes.push(text)}});
  try {
    expect(writes.at(-1)).toContain("estimating…");
    expect(writes.at(-1)).toContain("[");
    time = 10_000;
    progress.update({progress: .5, renderedDoneIn: null, stitchStage: "encoding", renderEstimatedTime: 8_000});
    expect(writes.at(-1)).toContain("50% | 00:10 elapsed | ~00:10 left");
    expect(writes.at(-1)!.replace(/\r|\u001b\[2K/g, "").length).toBeLessThan(80);
    expect(writes.at(-1)).not.toEndWith("\n");
    time = 15_000;
    progress.update({progress: .8, renderedDoneIn: 12_000, stitchStage: "muxing", renderEstimatedTime: 8_000});
    expect(writes.at(-1)).toContain("Muxing");
    expect(writes.at(-1)).toContain("~00:04 left");
    progress.finish(true);
    expect(writes.at(-1)).toContain("Rendered");
    expect(writes.at(-1)).toContain("100% | 00:15 elapsed | 00:00 left\n");
  } finally {progress.finish(false);}
});

test("redirected output is sparse plain text and failures never report success", () => {
  let time = 0;
  const writes: string[] = [];
  const progress = createRenderProgress({now: () => time, stream: {write: text => writes.push(text)}});
  const update = (fraction: number) => progress.update({progress: fraction, renderedDoneIn: null, stitchStage: "encoding", renderEstimatedTime: 0});
  try {
    time = 10_000;
    update(.1);
    const count = writes.length;
    for (let n = 11; n < 20; n++) update(n / 100);
    expect(writes).toHaveLength(count);
    time = 40_000;
    update(.19);
    expect(writes).toHaveLength(count + 1);
    update(NaN);
    update(.05);
    progress.finish(false);
    expect(writes.at(-1)).toContain("Stopped 19%");
    expect(writes.join("")).not.toContain("\u001b");
    expect(writes.join("")).not.toContain("100%");
    expect(writes.every(line => line.endsWith("\n"))).toBe(true);
    const finished = writes.length;
    update(1); progress.finish(true);
    expect(writes).toHaveLength(finished);
  } finally {progress.finish(false);}
});
