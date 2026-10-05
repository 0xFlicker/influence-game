import {expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import manifest from "../../public/music/werewolf/v1/manifest.json";

test("all four approved tracks ship as complete hash-verified web assets", () => {
  expect(manifest.tracks).toHaveLength(4);
  for (const track of manifest.tracks) {
    expect(track.durationSeconds).toBeGreaterThan(160);
    expect(track.durationSeconds).toBeLessThan(200);
    expect(track.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    const bytes = readFileSync(resolve(import.meta.dir, "../../public/music/werewolf/v1", track.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(track.sha256);
    expect(bytes.length).toBeGreaterThan(1_000_000);
  }
});
