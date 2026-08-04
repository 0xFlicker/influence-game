import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDB, createDB } from "../db/index.js";
import {
  AVATAR_STORAGE_ROTATION_MANIFEST_VERSION,
  copyAvatarStorageRotations,
  createPublicAvatarObjectStore,
  deleteRepointedAvatarStorageObjects,
  inventoryAvatarStorageRotations,
  repointAvatarStorageRotations,
  verifyAvatarStorageRotation,
  type AvatarStorageRotationManifest,
} from "../services/avatar-storage-rotation.js";

export type AvatarStorageRotationPhase = "inventory" | "copy" | "repoint" | "verify" | "delete";

export interface AvatarStorageRotationArgs {
  phase: AvatarStorageRotationPhase;
  manifestPath: string;
  apply: boolean;
  confirmDelete: boolean;
}

export async function runAvatarStorageRotationCli(argv: readonly string[]): Promise<void> {
  const args = parseAvatarStorageRotationArgs(argv);
  assertAvatarStorageRotationMutationAuthorized(args);
  const db = createDB(process.env.DATABASE_URL);
  const store = createPublicAvatarObjectStore();

  try {
    if (args.phase === "inventory") {
      const manifest = await inventoryAvatarStorageRotations(db, store);
      await writeInitialManifest(args.manifestPath, manifest);
      printSummary(args.phase, manifest, null);
    } else {
      const manifest = await readManifest(args.manifestPath);
      const checkpoint = () => writeManifest(args.manifestPath, manifest);
      if (args.phase === "copy") {
        await copyAvatarStorageRotations(manifest, store, checkpoint);
        printSummary(args.phase, manifest, null);
      } else if (args.phase === "repoint") {
        await repointAvatarStorageRotations(db, manifest, store, checkpoint);
        printSummary(args.phase, manifest, null);
      } else if (args.phase === "delete") {
        await deleteRepointedAvatarStorageObjects(db, manifest, store, checkpoint);
        const verification = await verifyAvatarStorageRotation(db, manifest, store);
        printSummary(args.phase, manifest, verification);
        if (!verification.ok) process.exitCode = 1;
      } else {
        const verification = await verifyAvatarStorageRotation(db, manifest, store);
        printSummary(args.phase, manifest, verification);
        if (!verification.ok) process.exitCode = 1;
      }
    }
  } finally {
    await closeDB();
  }
}

export function parseAvatarStorageRotationArgs(
  argv: readonly string[],
): AvatarStorageRotationArgs {
  const phase = argv[0] as AvatarStorageRotationPhase | undefined;
  if (!phase || !["inventory", "copy", "repoint", "verify", "delete"].includes(phase)) {
    throw new Error("Usage: avatar-storage:rotate <inventory|copy|repoint|verify|delete> --manifest /absolute/private/path.json [--apply] [--confirm-delete-old-objects]");
  }
  let manifestPath: string | undefined;
  let apply = false;
  let confirmDelete = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--manifest") {
      manifestPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--manifest=")) {
      manifestPath = arg.slice("--manifest=".length);
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--confirm-delete-old-objects") {
      confirmDelete = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    throw new Error("--manifest must be an absolute path outside the repository");
  }
  const resolvedManifestPath = path.resolve(manifestPath);
  const repositoryRoot = path.resolve(import.meta.dir, "../../../..");
  if (resolvedManifestPath === repositoryRoot
    || resolvedManifestPath.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("--manifest must be outside the repository");
  }
  return { phase, manifestPath: resolvedManifestPath, apply, confirmDelete };
}

export function assertAvatarStorageRotationMutationAuthorized(
  args: AvatarStorageRotationArgs,
): void {
  if (["copy", "repoint", "delete"].includes(args.phase) && !args.apply) {
    throw new Error(`${args.phase} is mutating and requires --apply`);
  }
  if (args.phase === "delete" && !args.confirmDelete) {
    throw new Error("Delete requires --confirm-delete-old-objects");
  }
}

async function readManifest(manifestPath: string): Promise<AvatarStorageRotationManifest> {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid avatar rotation manifest");
  const manifest = parsed as AvatarStorageRotationManifest;
  if (manifest.version !== AVATAR_STORAGE_ROTATION_MANIFEST_VERSION
    || typeof manifest.bucket !== "string"
    || typeof manifest.endpointHost !== "string"
    || !Array.isArray(manifest.entries)) {
    throw new Error("Invalid avatar rotation manifest");
  }
  return manifest;
}

async function writeManifest(
  manifestPath: string,
  manifest: AvatarStorageRotationManifest,
): Promise<void> {
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, manifestPath);
  await chmod(manifestPath, 0o600);
}

async function writeInitialManifest(
  manifestPath: string,
  manifest: AvatarStorageRotationManifest,
): Promise<void> {
  try {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(manifestPath, 0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("Refusing to overwrite an existing avatar rotation manifest");
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function printSummary(
  phase: AvatarStorageRotationPhase,
  manifest: AvatarStorageRotationManifest,
  verification: Awaited<ReturnType<typeof verifyAvatarStorageRotation>> | null,
): void {
  const summary = {
    phase,
    manifestVersion: manifest.version,
    objects: manifest.entries.length,
    referencedObjects: manifest.entries.filter(({ newKey }) => !!newKey).length,
    copiedObjects: manifest.entries.filter(({ copiedAt }) => !!copiedAt).length,
    repointedObjects: manifest.entries.filter(({ repointedAt }) => !!repointedAt).length,
    deletedObjects: manifest.entries.filter(({ deletedAt }) => !!deletedAt).length,
    ...(verification ? { verification } : {}),
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
  await runAvatarStorageRotationCli(process.argv.slice(2));
}
