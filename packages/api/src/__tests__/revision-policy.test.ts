import { describe, expect, test } from "bun:test";
import {
  canonicalizeEffectiveRuntimeSnapshot,
  classifyRevision,
  combinedTextDistance,
  fingerprintEffectiveRuntimeSnapshot,
  recalibrateRatingForRevision,
  type EffectiveAgentRuntimeSnapshot,
} from "../services/revision-policy.js";
import { INITIAL_COMPETITION_SIGMA } from "../services/season-policy.js";

const BASE_SNAPSHOT: EffectiveAgentRuntimeSnapshot = {
  name: "Mira Vale",
  personality: "Calm, observant, and deliberate in every social exchange.",
  backstory: "A retired negotiator who notices what others avoid saying.",
  strategyInstructions: "Build trust early, then compare private commitments against public votes.",
  personaKey: "strategic",
  model: "gpt-5-nano",
  providerProfileId: "openai",
  catalogId: "openai:gpt-5-nano",
  reasoningPolicy: "low",
  toolChoiceMode: "auto",
  temperature: 0.9,
};

describe("effective revision fingerprints", () => {
  test("creates an initial revision for the first effective snapshot", () => {
    const result = classifyRevision(null, BASE_SNAPSHOT);
    expect(result.magnitude).toBe("initial");
    expect(result.previousFingerprint).toBeNull();
    expect(result.nextFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("normalizes case and whitespace before fingerprinting", () => {
    const changed = {
      ...BASE_SNAPSHOT,
      name: "  MIRA   VALE ",
      personality: "CALM, OBSERVANT, AND DELIBERATE IN EVERY SOCIAL EXCHANGE.",
    };
    expect(fingerprintEffectiveRuntimeSnapshot(changed))
      .toBe(fingerprintEffectiveRuntimeSnapshot(BASE_SNAPSHOT));
    expect(classifyRevision(BASE_SNAPSHOT, changed).magnitude).toBe("none");
  });

  test("ignores presentation-only properties", () => {
    const withAvatar = {
      ...BASE_SNAPSHOT,
      avatarUrl: "https://example.test/new-avatar.png",
    } as EffectiveAgentRuntimeSnapshot;
    expect(fingerprintEffectiveRuntimeSnapshot(withAvatar))
      .toBe(fingerprintEffectiveRuntimeSnapshot(BASE_SNAPSHOT));
  });

  test("returns a canonical snapshot without mutating its input", () => {
    const source = { ...BASE_SNAPSHOT, name: "  Mira   Vale " };
    const canonical = canonicalizeEffectiveRuntimeSnapshot(source);
    expect(canonical.name).toBe("mira vale");
    expect(source.name).toBe("  Mira   Vale ");
  });
});

describe("revision magnitude policy v1", () => {
  test("classifies one low-distance text edit as small", () => {
    const result = classifyRevision(BASE_SNAPSHOT, {
      ...BASE_SNAPSHOT,
      personality: BASE_SNAPSHOT.personality.replace("deliberate", "deliberately"),
    });
    expect(result.magnitude).toBe("small");
    expect(result.evidence.changedBehaviorFields).toEqual(["personality"]);
    expect(result.evidence.maximumTextDistance).toBeLessThan(0.15);
  });

  test("classifies multiple behavior edits as material", () => {
    const result = classifyRevision(BASE_SNAPSHOT, {
      ...BASE_SNAPSHOT,
      personality: BASE_SNAPSHOT.personality.replace("deliberate", "deliberately"),
      strategyInstructions: `${BASE_SNAPSHOT.strategyInstructions} Take bigger risks near the finale.`,
    });
    expect(result.magnitude).toBe("material");
  });

  test("classifies persona changes as material", () => {
    expect(classifyRevision(BASE_SNAPSHOT, {
      ...BASE_SNAPSHOT,
      personaKey: "chaotic",
    }).magnitude).toBe("material");
  });

  test("classifies resolved execution changes above text distance", () => {
    const result = classifyRevision(BASE_SNAPSHOT, {
      ...BASE_SNAPSHOT,
      model: "gpt-5-mini",
      providerProfileId: "katana",
      catalogId: "katana:gpt-5-mini",
    });
    expect(result.magnitude).toBe("execution");
    expect(result.evidence.changedExecutionFields).toEqual([
      "model",
      "providerProfileId",
      "catalogId",
    ]);
  });

  test("uses reproducible edit and token-set distance", () => {
    const first = combinedTextDistance("Build trust early", "Build trust very early");
    const second = combinedTextDistance("Build trust early", "Build trust very early");
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
  });
});

describe("revision rating recalibration", () => {
  test("preserves mu while widening sigma by magnitude", () => {
    const current = { mu: 31, sigma: 2 };
    const small = recalibrateRatingForRevision(current, "small");
    const material = recalibrateRatingForRevision(current, "material");
    const execution = recalibrateRatingForRevision(current, "execution");
    expect(small.after.mu).toBe(current.mu);
    expect(material.after.mu).toBe(current.mu);
    expect(execution.after.mu).toBe(current.mu);
    expect(small.after.sigma).toBeGreaterThan(current.sigma);
    expect(material.after.sigma).toBeGreaterThan(small.after.sigma);
    expect(execution.after.sigma).toBeGreaterThan(material.after.sigma);
    expect(execution.after.sigma).toBeLessThanOrEqual(INITIAL_COMPETITION_SIGMA);
  });

  test("does not change rating for initial or presentation-equivalent snapshots", () => {
    const current = { mu: 25, sigma: 4 };
    expect(recalibrateRatingForRevision(current, "none").after).toEqual(current);
    expect(recalibrateRatingForRevision(current, "initial").after).toEqual(current);
  });

  test("caps uncertainty at the initial sigma", () => {
    const result = recalibrateRatingForRevision(
      { mu: 25, sigma: INITIAL_COMPETITION_SIGMA },
      "execution",
    );
    expect(result.after.sigma).toBe(INITIAL_COMPETITION_SIGMA);
  });
});
