import { describe, expect, it } from "bun:test";
import {
  displayNameForFormat,
  FORMAT_PRESENTATION_METADATA,
  formatPresentationMetadata,
  isLaunchFormatId,
  type LaunchFormatId,
} from "../format-presentation-metadata";
import { ruleSheetForFormat } from "../format-pressure";

describe("format presentation metadata", () => {
  it("owns immutable launch-format names and concise fixed rules", () => {
    const formatIds = Object.keys(FORMAT_PRESENTATION_METADATA) as LaunchFormatId[];

    expect(formatIds).toEqual([
      "save_or_eliminate",
      "vote_bomb",
      "safety_bounce",
      "majority_elimination",
      "even_votes",
    ]);
    expect(formatPresentationMetadata("save_or_eliminate")).toMatchObject({
      id: "save_or_eliminate",
      displayName: "Save-or-Eliminate",
      conciseRules:
        "Cast one sealed SAVE (+1) or ELIMINATE (−1) ballot against another agent. Lowest net is eliminated; the Empowered agent breaks a lowest-net tie.",
    });
    expect(formatPresentationMetadata("vote_bomb").conciseRules).toContain(
      "Zero votes is safe",
    );
    expect(formatPresentationMetadata("safety_bounce").conciseRules).toContain(
      "Sole Vulnerable is automatically eliminated",
    );
    expect(formatPresentationMetadata("majority_elimination")).toMatchObject({
      id: "majority_elimination",
      displayName: "Majority Elimination",
    });
    expect(
      formatPresentationMetadata("majority_elimination").conciseRules,
    ).toContain("Most votes out");
    expect(
      formatPresentationMetadata("majority_elimination").ruleSheet.length,
    ).toBeGreaterThan(0);
    expect(formatPresentationMetadata("even_votes")).toMatchObject({
      id: "even_votes",
      displayName: "Even Votes",
    });
    expect(formatPresentationMetadata("even_votes").ruleSheet).toContain(
      "including zero",
    );
    expect(formatPresentationMetadata("even_votes").ruleSheet).toContain(
      "every living player has an odd total",
    );
    expect(ruleSheetForFormat("safety_bounce")).toBe(
      "After mingle: one random starter is SAFE and points publicly. A SAFE player's pointer makes the target VULNERABLE; a VULNERABLE player's pointer makes the target SAFE until all are classified. Then a sealed vote among the vulnerable pool only — most votes out. Sole vulnerable auto-elims. Empowered breaks ties.",
    );

    expect(formatPresentationMetadata("save_or_eliminate").displayName).toBe(
      "Save-or-Eliminate",
    );
    expect(formatPresentationMetadata("vote_bomb").displayName).toBe(
      "Vote Bomb",
    );
    expect(formatPresentationMetadata("safety_bounce").displayName).toBe(
      "Safety Bounce",
    );
  });

  it("rejects prototype keys as format IDs", () => {
    expect(isLaunchFormatId("toString")).toBe(false);
    expect(displayNameForFormat("toString")).toBe("toString");
  });
});
