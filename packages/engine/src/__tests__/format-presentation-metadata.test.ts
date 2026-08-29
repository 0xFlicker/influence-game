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
  it("owns current launch-format names and concise fixed rules", () => {
    const formatIds = Object.keys(FORMAT_PRESENTATION_METADATA) as LaunchFormatId[];

    expect(formatIds).toEqual([
      "save_or_eliminate",
      "vote_bomb",
      "safety_bounce",
      "majority_elimination",
      "even_votes",
      "restricted_history",
    ]);
    expect(formatPresentationMetadata("save_or_eliminate")).toMatchObject({
      id: "save_or_eliminate",
      displayName: "Save-or-Exit",
      conciseRules:
        "Cast one sealed SAVE (+1) or EXIT (−1) ballot for another contestant. Lowest net exits; the Empowered contestant breaks a lowest-net tie.",
    });
    expect(formatPresentationMetadata("vote_bomb").conciseRules).toContain(
      "Zero votes is safe",
    );
    expect(formatPresentationMetadata("safety_bounce").conciseRules).toContain(
      "sole Vulnerable contestant exits automatically",
    );
    expect(formatPresentationMetadata("majority_elimination")).toMatchObject({
      id: "majority_elimination",
      displayName: "Highest Count",
    });
    expect(
      formatPresentationMetadata("majority_elimination").conciseRules,
    ).toContain("highest total goes out");
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
      "every remaining contestant has an odd total",
    );
    expect(ruleSheetForFormat("safety_bounce")).toBe(
      "After Mingle, one random starter is SAFE and points publicly. A SAFE contestant's pointer makes the target VULNERABLE; a VULNERABLE contestant's pointer makes the target SAFE until all are classified. Then the vulnerable pool receives a sealed vote; the highest total goes out. A sole vulnerable contestant exits automatically. The Empowered contestant breaks ties.",
    );

    expect(formatPresentationMetadata("save_or_eliminate").displayName).toBe(
      "Save-or-Exit",
    );
    expect(formatPresentationMetadata("vote_bomb").displayName).toBe(
      "The Short List",
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
