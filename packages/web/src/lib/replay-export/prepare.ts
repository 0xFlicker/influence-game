import { lstat, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Prepare off to the side so a failed refresh cannot destroy a usable bundle. */
export async function prepareReplayBundle<T>(
  destination: string,
  overwrite: boolean,
  prepare: (directory: string) => Promise<T>,
): Promise<T> {
  const existing = await lstat(destination).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (existing) {
    if (!overwrite)
      throw new Error(
        "Prepared bundle already exists; use --overwrite to refresh it, --bundle to reuse it, or another output path",
      );
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new Error(
        "Refusing to replace a replay bundle path that is not a directory",
      );
    const manifest = JSON.parse(
      await readFile(join(destination, "manifest.json"), "utf8"),
    );
    if (manifest?.schema !== "house.replay-export")
      throw new Error("Refusing to replace a directory that is not a replay bundle");
  }
  await mkdir(dirname(destination), { recursive: true });
  const scratch = await mkdtemp(
    join(dirname(destination), `.${basename(destination)}-prepare-`),
  );
  const pending = join(scratch, "bundle"),
    previous = join(scratch, "previous");
  await mkdir(pending);
  let retainBackup = false;
  try {
    const result = await prepare(pending);
    if (existing) {
      await rename(destination, previous);
      retainBackup = true;
    }
    try {
      await rename(pending, destination);
    } catch (error) {
      if (existing) {
        try {
          await rename(previous, destination);
          retainBackup = false;
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Bundle replacement failed; previous bundle retained at ${previous}`,
          );
        }
      }
      throw error;
    }
    retainBackup = false;
    return result;
  } finally {
    await rm(retainBackup ? pending : scratch, { recursive: true, force: true });
  }
}
