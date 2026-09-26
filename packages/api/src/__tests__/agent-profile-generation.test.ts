import { allocateGeneratedAgentName, updateGeneratedProfileNameReferences } from "../services/generated-agent-names.js";
import { describe, expect, test } from "bun:test";
import {
  resolveAgentProfileGenerationLlm,
  resolveGeneratedAgentGender,
} from "../routes/agent-profiles.js";

describe("agent profile generation LLM selection", () => {
  test("pins hosted OpenAI and gpt-6-luna when a local LLM base URL is configured", () => {
    const generationLlm = resolveAgentProfileGenerationLlm({
      OPENAI_API_KEY: "openai-key",
      INFLUENCE_LLM_API_KEY: "local-key",
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    });

    expect(generationLlm).not.toBeNull();
    expect(generationLlm?.providerProfileId).toBe("openai");
    expect(generationLlm?.baseURL).toBeUndefined();
    expect(generationLlm?.apiKeySource).toBe("OPENAI_API_KEY");
    expect(generationLlm?.modelId).toBe("gpt-6-luna");
  });
});

describe("generated agent gender", () => {
  test("uses the structured gender returned by the model", () => {
    expect(resolveGeneratedAgentGender({
      gender: "non-binary",
      personality: "They are a patient negotiator.",
    })).toBe("non-binary");
  });

  test("keeps a player-selected gender even if model output conflicts", () => {
    expect(resolveGeneratedAgentGender({
      gender: "male",
      personality: "He is a patient negotiator.",
    }, "female")).toBe("female");
  });

  test("never infers missing structured gender from prose", () => {
    expect(() => resolveGeneratedAgentGender({ personality: "She is decisive." })).toThrow("Structured gender");
  });

});

describe("generated agent names", () => {
  test("keeps a distinct full name and replaces only the surname on a collision", () => {
    const occupiedNames = new Set(["nova quinn"]);

    expect(allocateGeneratedAgentName("Nova Quinn", occupiedNames)).toEqual({
      name: "Nova Hartwell",
      changed: true,
    });
    expect(allocateGeneratedAgentName("Mira Vale", occupiedNames)).toEqual({
      name: "Mira Vale",
      changed: false,
    });
  });

  test("adds a surname when the model returns only a first name", () => {
    expect(allocateGeneratedAgentName("Nova", new Set())).toEqual({
      name: "Nova Hartwell",
      changed: true,
    });
  });

  test("keeps a fallback full name within the saved profile limit", () => {
    const name = "A".repeat(32);
    expect(allocateGeneratedAgentName(name, new Set([name]))).toMatchObject({
      name: `${"A".repeat(23)} Hartwell`,
      changed: true,
    });
  });

  test("keeps generated copy consistent when a collision changes the full name", () => {
    expect(updateGeneratedProfileNameReferences({
      name: "Nova Quinn",
      backstory: "Nova Quinn learned patience at the poker table.",
      personality: "Nova Quinn has a warm but calculating presence.",
      strategyStyle: "Nova Quinn builds alliances before making a move.",
    }, "Nova Hartwell")).toEqual({
      name: "Nova Hartwell",
      backstory: "Nova Hartwell learned patience at the poker table.",
      personality: "Nova Hartwell has a warm but calculating presence.",
      strategyStyle: "Nova Hartwell builds alliances before making a move.",
    });
  });
});

import { decodeCharacterProfile } from "../services/character-profile-contract.js";
const character = { name: "Mira Vale", gender: "female", personaKey: "strategic", backstory: "History", personality: "Patient", strategyStyle: "Build alliances", performanceInstructions: "Open posture", visualDesign: "Blue jacket", introQuips: ["The snacks are an alliance opportunity.", "I brought a plan and backup snacks.", "Trust is great; receipts are better."] as string[] } as const;
describe("complete character contract", () => {
  test("requires performance and visual design alongside the original fields", () => {
    expect(decodeCharacterProfile(JSON.stringify(character))).toEqual(character);
  });
  test.each(["not json", "{}", "```json\n{}\n```", 'Here is {"name":"Mira"}', JSON.stringify({ ...character, extra: true }), JSON.stringify({ ...character, visualDesign: undefined }), JSON.stringify({ ...character, performanceInstructions: "" }), JSON.stringify({ ...character, gender: "unknown" })])("rejects malformed or incomplete output: %s", (output) => {
    expect(() => decodeCharacterProfile(output)).toThrow();
  });
});
