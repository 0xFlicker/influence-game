import { describe, expect, test } from "bun:test";
import {
  assertAvatarStorageRotationMutationAuthorized,
  parseAvatarStorageRotationArgs,
} from "../scripts/rotate-private-avatar-storage-keys.js";

const MANIFEST_PATH = "/tmp/influence-avatar-storage-rotation-test.json";

describe("avatar storage rotation CLI mutation gates", () => {
  test.each(["copy", "repoint", "delete"] as const)(
    "%s requires --apply",
    (phase) => {
      const args = parseAvatarStorageRotationArgs([
        phase,
        "--manifest",
        MANIFEST_PATH,
        ...(phase === "delete" ? ["--confirm-delete-old-objects"] : []),
      ]);

      expect(() => assertAvatarStorageRotationMutationAuthorized(args))
        .toThrow(`${phase} is mutating and requires --apply`);
    },
  );

  test("delete requires its second explicit confirmation", () => {
    const args = parseAvatarStorageRotationArgs([
      "delete",
      "--manifest",
      MANIFEST_PATH,
      "--apply",
    ]);

    expect(() => assertAvatarStorageRotationMutationAuthorized(args))
      .toThrow("Delete requires --confirm-delete-old-objects");
  });

  test.each(["inventory", "verify"] as const)(
    "%s remains read-only without mutation flags",
    (phase) => {
      const args = parseAvatarStorageRotationArgs([phase, "--manifest", MANIFEST_PATH]);

      expect(() => assertAvatarStorageRotationMutationAuthorized(args)).not.toThrow();
    },
  );

  test("delete proceeds only with both mutation flags", () => {
    const args = parseAvatarStorageRotationArgs([
      "delete",
      "--manifest",
      MANIFEST_PATH,
      "--apply",
      "--confirm-delete-old-objects",
    ]);

    expect(() => assertAvatarStorageRotationMutationAuthorized(args)).not.toThrow();
  });
});
