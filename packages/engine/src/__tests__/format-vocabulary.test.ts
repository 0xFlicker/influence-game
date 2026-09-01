import { describe, expect, it } from "bun:test";
import {
  FORMAT_SURFACE_IDS,
  canonicalFormatIdForSurface,
  formatSurfaceId,
} from "../format-vocabulary";
import { LAUNCH_FORMAT_IDS } from "../format-presentation-metadata";

describe("format surface vocabulary", () => {
  it("maps every canonical format to one unique current surface id", () => {
    expect(Object.keys(FORMAT_SURFACE_IDS).sort()).toEqual(
      [...LAUNCH_FORMAT_IDS].sort(),
    );
    expect(new Set(Object.values(FORMAT_SURFACE_IDS)).size).toBe(
      LAUNCH_FORMAT_IDS.length,
    );

    expect(formatSurfaceId("save_or_eliminate")).toBe("save_or_exit");
    expect(formatSurfaceId("vote_bomb")).toBe("short_list");
    expect(formatSurfaceId("majority_elimination")).toBe("highest_count");
    expect(formatSurfaceId("two_names")).toBe("two_names");
  });

  it("maps current surface ids back to canonical authority and rejects unknown ids", () => {
    for (const canonicalId of LAUNCH_FORMAT_IDS) {
      expect(canonicalFormatIdForSurface(formatSurfaceId(canonicalId))).toBe(
        canonicalId,
      );
    }

    expect(canonicalFormatIdForSurface("save_or_exit")).toBe(
      "save_or_eliminate",
    );
    expect(canonicalFormatIdForSurface("short_list")).toBe("vote_bomb");
    expect(canonicalFormatIdForSurface("highest_count")).toBe(
      "majority_elimination",
    );
    expect(canonicalFormatIdForSurface("vote_bomb")).toBeNull();
    expect(canonicalFormatIdForSurface("unknown_format")).toBeNull();
  });
});
