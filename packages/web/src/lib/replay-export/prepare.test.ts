import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareReplayBundle } from "./prepare";

test("overwrite refreshes the whole bundle, removing stale layouts and media", async () => {
  const root = await mkdtemp(join(tmpdir(), "replay-prepare-"));
  const destination = join(root, "movie.bundle");
  const prepare = async (directory: string) => {
    await writeFile(join(directory, "manifest.json"), JSON.stringify({schema: "house.replay-export", revision: "current"}));
    return "fresh";
  };
  try {
    await prepareReplayBundle(destination, false, prepare);
    await writeFile(join(destination, "stale-media"), "old");
    await expect(prepareReplayBundle(destination, false, prepare)).rejects.toThrow("--overwrite");
    expect(await prepareReplayBundle(destination, true, prepare)).toBe("fresh");
    expect(await readdir(destination)).toEqual(["manifest.json"]);
    expect(await readdir(root)).toEqual(["movie.bundle"]);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("failed preparation preserves the old bundle and output and cleans temporary assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "replay-prepare-"));
  const destination = join(root, "movie.bundle");
  try {
    await mkdir(destination);
    const original = JSON.stringify({schema: "house.replay-export", revision: "old"});
    await writeFile(join(destination, "manifest.json"), original);
    await writeFile(join(root, "movie.mp4"), "existing movie");
    await expect(prepareReplayBundle(destination, true, async directory => {
      await writeFile(join(directory, "partial"), "partial download");
      throw new Error("Asset unavailable");
    })).rejects.toThrow("Asset unavailable");
    expect(await readFile(join(destination, "manifest.json"), "utf8")).toBe(original);
    expect(await readFile(join(root, "movie.mp4"), "utf8")).toBe("existing movie");
    expect((await readdir(root)).sort()).toEqual(["movie.bundle", "movie.mp4"]);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("overwrite refuses unrelated directories and symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "replay-prepare-"));
  try {
    const destination = join(root, "movie.bundle");
    await mkdir(destination);
    await writeFile(join(destination, "manifest.json"), '{"schema":"other"}');
    await expect(prepareReplayBundle(destination, true, async () => {})).rejects.toThrow("not a replay bundle");
    await symlink(destination, join(root, "link.bundle"));
    await expect(prepareReplayBundle(join(root, "link.bundle"), true, async () => {})).rejects.toThrow("not a directory");
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("failed promotion restores the previous bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "replay-prepare-"));
  const destination = join(root, "movie.bundle");
  const original = JSON.stringify({schema: "house.replay-export", revision: "old"});
  try {
    await mkdir(destination);
    await writeFile(join(destination, "manifest.json"), original);
    await expect(prepareReplayBundle(destination, true, async directory => {
      // Simulate losing the staged directory before the rename can complete.
      await rm(directory, {recursive: true});
    })).rejects.toThrow();
    expect(await readFile(join(destination, "manifest.json"), "utf8")).toBe(original);
    expect(await readdir(root)).toEqual(["movie.bundle"]);
  } finally { await rm(root, {recursive: true, force: true}); }
});
