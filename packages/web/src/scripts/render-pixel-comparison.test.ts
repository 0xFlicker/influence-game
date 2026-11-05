import {expect, test} from "bun:test";
import {compareCapturePixels} from "./render-pixel-comparison";

const blank = () => new Uint8Array(40 * 4);
test("capture comparison accepts exact pixels and the measured baseline raster budget", () => {
  expect(compareCapturePixels(blank(), blank()).matches).toBe(true);
  const actual = blank();
  for (let pixel = 0; pixel < 7; pixel++) actual[pixel * 4] = 6;
  for (let pixel = 0; pixel < 5; pixel++) actual[pixel * 4 + 1] = 6;
  actual[5 * 4 + 1] = 2;
  expect(compareCapturePixels(blank(), actual)).toMatchObject({matches:true,changedPixels:7,maxChannelDifference:6,totalDifference:74});
});
test("capture comparison rejects one visible pixel, excess count or total, and alpha changes", () => {
  for (const level of [7, 255]) {
    const actual=blank(); actual[0]=level;
    expect(compareCapturePixels(blank(), actual).matches).toBe(false);
  }
  const count=blank(); for(let pixel=0;pixel<8;pixel++) count[pixel*4]=1;
  expect(compareCapturePixels(blank(), count).matches).toBe(false);
  const total=blank(); for(let pixel=0;pixel<7;pixel++){total[pixel*4]=6;total[pixel*4+1]=5;}
  expect(compareCapturePixels(blank(), total).matches).toBe(false);
  const alpha=blank(); alpha[3]=1;
  expect(compareCapturePixels(blank(), alpha).matches).toBe(false);
});
test("capture comparison rejects missing text-sized regions, shifts and malformed buffers", () => {
  const label=blank(); for(let pixel=0;pixel<20;pixel++) label[pixel*4]=200;
  expect(compareCapturePixels(label, blank()).matches).toBe(false);
  const shifted=blank(); shifted.set(label.subarray(0,-4),4);
  expect(compareCapturePixels(label, shifted).matches).toBe(false);
  expect(()=>compareCapturePixels(blank(),new Uint8Array(8))).toThrow("dimensions");
  expect(()=>compareCapturePixels(new Uint8Array(),new Uint8Array())).toThrow("empty");
});
