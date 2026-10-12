import {expect, test} from "bun:test";
import {boundedFrame, framePixel, pixelFrame, boundedScroll, centeredScroll, playbackScroll, visibleScroll, edgeScrollSpeed, maximumZoom, wheelPixels} from "./timeline-viewport";

test("zoom centers the same frame, clamps ends and fits zero/one-frame timelines", () => {
  for (const width of [400, 800, 3200]) {
    for (const frame of [0, 100, 499, 999]) expect(pixelFrame(framePixel(frame, 1000, width), 1000, width)).toBe(frame);
    expect(centeredScroll(500, 1000, width, 400)).toBe(Math.max(0, width / 2 - 200));
    expect(centeredScroll(0, 1000, width, 400)).toBe(0);
    expect(centeredScroll(999, 1000, width, 400)).toBe(Math.max(0, width - 400));
  }
  for (const duration of [0, 1]) expect(pixelFrame(900, duration, 400)).toBe(0);
  expect(pixelFrame(200, 1000, 0)).toBe(0);
  expect(boundedFrame(NaN, 1000)).toBe(0);
  expect(boundedScroll(-100, 1000, 400)).toBe(0);
  expect(boundedScroll(900, 1000, 400)).toBe(600);
});

test("playback pages ahead, manual windows remain stable, navigation reveals destinations", () => {
  expect(playbackScroll(89, 1000, 4000, 400, 0)).toBe(0);
  expect(playbackScroll(90, 1000, 4000, 400, 0)).toBe(280);
  expect(playbackScroll(999, 1000, 4000, 400, 3500)).toBe(3600);
  expect(visibleScroll(120, 1000, 4000, 400, 280)).toBe(280);
  expect(visibleScroll(600, 1000, 4000, 400, 280)).toBe(2200);
  expect(playbackScroll(0, 1000, 4000, 400, 280)).toBe(0);
});

test("drag edges have bounded proportional speeds and long games allow useful zoom", () => {
  expect(edgeScrollSpeed(200, 0, 400)).toBe(0);
  expect(edgeScrollSpeed(24, 0, 400)).toBe(-300);
  expect(edgeScrollSpeed(-100, 0, 400)).toBe(-600);
  expect(edgeScrollSpeed(500, 0, 400)).toBe(600);
  expect(edgeScrollSpeed(0, 0, 0)).toBe(0);
  expect(maximumZoom(30 * 3600, 30)).toBe(1800);
  expect(maximumZoom(30, 30)).toBe(8);
  expect(wheelPixels(2, 1, 400)).toBe(32);
  expect(wheelPixels(1, 2, 400)).toBe(400);
});
