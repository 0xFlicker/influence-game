import { describe, expect, test } from "bun:test";
import {
  PUBLIC_PLAYER_HANDLE_MAX_LENGTH,
  PUBLIC_PLAYER_HANDLE_RESERVED_NAMES,
  PUBLIC_PLAYER_HANDLE_RESERVED_SET_VERSION,
  classifyPublicIdentityOnboarding,
  isPublicPlayerHandleConflict,
  isUuidShapedPublicIdentity,
  normalizePublicPlayerHandle,
  parseOffsetTimestamp,
  slugifyDisplayNameToHandle,
  suggestPublicPlayerHandle,
  validatePublicPlayerHandle,
} from "../lib/public-player-identity.js";
import {
  getPostgresConstraintName,
  isPostgresConstraintViolation,
} from "../lib/postgres-errors.js";

describe("public player handle policy", () => {
  test("normalizes advisory input but validates only canonical lowercase ASCII handles", () => {
    expect(normalizePublicPlayerHandle("  Flick  ")).toBe("flick");
    expect(validatePublicPlayerHandle("flick")).toEqual({ ok: true, handle: "flick" });

    expect(validatePublicPlayerHandle("Flick")).toEqual({
      ok: false,
      reason: "noncanonical",
    });
    expect(validatePublicPlayerHandle(" flick ")).toEqual({
      ok: false,
      reason: "noncanonical",
    });
    expect(validatePublicPlayerHandle("ab")).toEqual({
      ok: false,
      reason: "too_short",
    });
    expect(validatePublicPlayerHandle("a".repeat(31))).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validatePublicPlayerHandle("-flick")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    expect(validatePublicPlayerHandle("flick-")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    expect(validatePublicPlayerHandle("flick--ox")).toEqual({
      ok: true,
      handle: "flick--ox",
    });
    expect(validatePublicPlayerHandle("flick_ox")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    expect(validatePublicPlayerHandle("flíck")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  test("rejects UUID-shaped handles and a versioned reserved route/system set", () => {
    expect(PUBLIC_PLAYER_HANDLE_RESERVED_SET_VERSION).toBe(1);
    expect([...PUBLIC_PLAYER_HANDLE_RESERVED_NAMES]).toEqual(expect.arrayContaining([
      "admin",
      "api",
      "dashboard",
      "games",
      "house",
      "profile",
      "system",
    ]));

    const publicId = "6f1c40ae-1f13-4ae8-9b9e-00f62517c1d0";
    expect(isUuidShapedPublicIdentity(publicId)).toBe(true);
    expect(isUuidShapedPublicIdentity(publicId.toUpperCase())).toBe(true);
    expect(isUuidShapedPublicIdentity("not-a-uuid")).toBe(false);
    expect(validatePublicPlayerHandle(publicId)).toEqual({
      ok: false,
      reason: "uuid_shaped",
    });
    expect(validatePublicPlayerHandle("house")).toEqual({
      ok: false,
      reason: "reserved",
    });
  });

  test("slugifies display names and uses player when the ASCII slug is empty", () => {
    expect(slugifyDisplayNameToHandle("  Flick The Third  ")).toBe("flick-the-third");
    expect(slugifyDisplayNameToHandle("Élodie O'Connor")).toBe("elodie-o-connor");
    expect(slugifyDisplayNameToHandle("🦊✨")).toBe("player");
    expect(slugifyDisplayNameToHandle("x")).toBe("x-player");
    expect(slugifyDisplayNameToHandle("Admin")).toBe("admin-player");
  });

  test("generates deterministic bounded, length-aware suffix suggestions", async () => {
    const occupied = new Set(["flick", "flick-2"]);
    expect(await suggestPublicPlayerHandle("Flick", async (candidate) => !occupied.has(candidate)))
      .toBe("flick-3");

    const longBase = "a".repeat(PUBLIC_PLAYER_HANDLE_MAX_LENGTH);
    expect(await suggestPublicPlayerHandle(longBase, async (candidate) => candidate.endsWith("-2")))
      .toBe(`${"a".repeat(PUBLIC_PLAYER_HANDLE_MAX_LENGTH - 2)}-2`);

    expect(await suggestPublicPlayerHandle(
      "Flick",
      async () => false,
      { maxAttempts: 3 },
    )).toBeNull();
  });

  test("recognizes the handle-specific unique violation through wrapped postgres errors", () => {
    const error = {
      cause: {
        code: "23505",
        constraint_name: "users_handle_lower_unique",
      },
    };
    expect(getPostgresConstraintName(error)).toBe("users_handle_lower_unique");
    expect(isPostgresConstraintViolation(error, {
      code: "23505",
      constraint: "users_handle_lower_unique",
    })).toBe(true);
    expect(isPublicPlayerHandleConflict(error)).toBe(true);
    expect(isPublicPlayerHandleConflict({
      code: "23505",
      constraint: "users_public_id_unique",
    })).toBe(false);
  });
});

describe("public identity onboarding timestamp policy", () => {
  const cutoff = "2026-07-16T18:30:00.000Z";

  test("strictly accepts offset-bearing PostgreSQL and ISO timestamps", () => {
    expect(parseOffsetTimestamp("2026-07-16 12:29:59.999999-06").ok).toBe(true);
    expect(parseOffsetTimestamp("2026-07-16 18:29:59+0000").ok).toBe(true);
    expect(parseOffsetTimestamp("2026-07-16T18:29:59+00:00").ok).toBe(true);
    expect(parseOffsetTimestamp("2026-07-16T18:29:59Z").ok).toBe(true);

    expect(parseOffsetTimestamp(null)).toEqual({ ok: false, reason: "missing" });
    expect(parseOffsetTimestamp("")).toEqual({ ok: false, reason: "missing" });
    expect(parseOffsetTimestamp("2026-07-16 18:29:59")).toEqual({
      ok: false,
      reason: "timezone_required",
    });
    expect(parseOffsetTimestamp("2026-02-30T18:29:59Z")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseOffsetTimestamp("yesterday")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseOffsetTimestamp("2026-07-16T18:29:59+24:00")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("keeps complete identity complete regardless of timestamp", () => {
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: true,
      handle: "flick",
      createdAt: "invalid",
      cutoff,
    })).toEqual({
      state: "complete",
      diagnosticCode: null,
    });
  });

  test("uses exact cutoff boundaries and fails incomplete bad timestamps closed", () => {
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: true,
      handle: null,
      createdAt: "2026-07-16T18:29:59.999999Z",
      cutoff,
    })).toEqual({
      state: "deferrable",
      diagnosticCode: null,
    });
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: true,
      handle: null,
      createdAt: cutoff,
      cutoff,
    })).toEqual({
      state: "required",
      diagnosticCode: null,
    });
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: false,
      handle: "flick",
      createdAt: null,
      cutoff,
    })).toEqual({
      state: "required",
      diagnosticCode: "created_at_missing",
    });
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: false,
      handle: null,
      createdAt: "2026-07-16 18:29:59",
      cutoff,
    })).toEqual({
      state: "required",
      diagnosticCode: "created_at_timezone_required",
    });
    expect(classifyPublicIdentityOnboarding({
      hasSafeDisplayName: false,
      handle: null,
      createdAt: "invalid",
      cutoff,
    })).toEqual({
      state: "required",
      diagnosticCode: "created_at_invalid",
    });
  });

  test("rejects an invalid rollout cutoff instead of silently changing policy", () => {
    expect(() => classifyPublicIdentityOnboarding({
      hasSafeDisplayName: false,
      handle: null,
      createdAt: "2026-07-16T18:29:59Z",
      cutoff: "2026-07-16 18:30:00",
    })).toThrow("identity launch cutoff");
  });
});
