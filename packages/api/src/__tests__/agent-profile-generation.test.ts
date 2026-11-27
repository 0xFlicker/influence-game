import { characterNameSchema, decodeCharacterName, drawAgentNameShortlist } from "../services/generated-agent-names.js";
import onomaverse from "../data/onomaverse-v2026.10.json";
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
  test("draws eight distinct given names paired with surnames from the same country pool", () => {
    const occupiedNames = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const shortlist = drawAgentNameShortlist(occupiedNames);
      expect(shortlist).toHaveLength(8);
      const givenNames = shortlist.map(name => {
        expect(name.length).toBeLessThanOrEqual(32);
        expect(occupiedNames.has(` ${name.toLowerCase()} `)).toBe(false);
        occupiedNames.add(` ${name.toLowerCase()} `);
        return onomaverse.flatMap(pool => pool.givenNames.filter(given =>
          name.startsWith(given + " ") && pool.surnames.includes(name.slice(given.length + 1))));
      });
      expect(givenNames.every(names => names.length > 0)).toBe(true);
      // Given names can contain spaces and a pair may occur in more than one country.
      expect(givenNames.every((names, index) => names.some(given =>
        givenNames.every((others, otherIndex) => index === otherIndex || !others.includes(given))))).toBe(true);
    }
  });

  const shortlist = ["Abel Pereira", "Maia Dupont", "Enzo Rizzo", "Eleni Giannou",
    "Nora Larsen", "Isabel Gil", "Alma Berg", "Lucía Cano"];
  const naming = { shortlist, userText: [] };

  test("constrains the default choice to the actual shortlist", () => {
    expect(characterNameSchema(naming)).toMatchObject({
      properties: { source: { enum: ["shortlist"] }, value: { enum: shortlist } },
    });
    expect(decodeCharacterName({ source: "shortlist", value: shortlist[0] }, naming)).toBe(shortlist[0]!);
    expect(() => decodeCharacterName({ source: "shortlist", value: "Mira Vale" }, naming)).toThrow();
    expect(() => decodeCharacterName({ source: "provided", value: "Mira Vale" }, naming)).toThrow();
  });

  test("preserves an explicit mononym and allows original names with a quoted inspiration request", () => {
    const userText = ["Give this character the name Xóchitl.", "Invent a name, using the options as inspiration."];
    const withRequests = { ...naming, userText };
    expect(decodeCharacterName({ source: "provided", value: "Xóchitl", request: userText[0] }, withRequests)).toBe("Xóchitl");
    expect(() => decodeCharacterName({ source: "provided", value: "Xóchitl" }, withRequests)).toThrow();
    expect(() => decodeCharacterName({ source: "provided", value: "Xochitl", request: userText[0] }, withRequests)).toThrow();
    expect(decodeCharacterName({ source: "inspiration", value: "Orris", request: userText[1] }, withRequests)).toBe("Orris");
    expect(() => decodeCharacterName({ source: "inspiration", value: "Orris", request: "Make something up" }, withRequests)).toThrow();
    expect(() => decodeCharacterName({ source: "inspiration", value: "Orris" }, withRequests)).toThrow();
  });

  test("pins a structured name and requires a quoted request to draw a replacement during unscoped refinement", () => {
    const fixed = { fixedName: "Xóchitl" };
    expect(decodeCharacterName({ source: "fixed", value: "Xóchitl" }, fixed)).toBe("Xóchitl");
    expect(() => decodeCharacterName({ source: "fixed", value: "Xóchitl Vale" }, fixed)).toThrow();
    const request = "Give them a different name.";
    const refinement = { ...naming, currentName: "Xóchitl", userText: [request] };
    expect(decodeCharacterName({ source: "fixed", value: "Xóchitl" }, refinement)).toBe("Xóchitl");
    expect(decodeCharacterName({ source: "shortlist", value: shortlist[0], request }, refinement)).toBe(shortlist[0]!);
    expect(() => decodeCharacterName({ source: "shortlist", value: shortlist[0] }, refinement)).toThrow();
  });
});

import { decodeCharacterProfile, characterProfileSchemaFor } from "../services/character-profile-contract.js";
const character = { name: "Mira Vale", gender: "female", personaKey: "strategic", backstory: "History", personality: "Patient", strategyStyle: "Build alliances", performanceInstructions: "Open posture", visualDesign: "Blue jacket", werewolfStrategyStyle: "Test claims as village; bluff consistently as wolf.", introQuips: ["The snacks are an alliance opportunity.", "I brought a plan and backup snacks.", "Trust is great; receipts are better."] as string[] } as const;
const naming = { fixedName: character.name };
const encodedCharacter = { ...character, name: { source: "fixed", value: character.name } };
describe("complete character contract", () => {
  test("Werewolf editing allows untouched blank fields but requires complete valid strategy output", () => {
    const draft = { ...encodedCharacter, strategyStyle: "", visualDesign: "", performanceInstructions: "" };
    const fields = ["werewolfStrategyStyle"] as const;
    expect(decodeCharacterProfile(JSON.stringify(draft), naming, ["strategic"], fields)).toEqual({ ...draft, name: character.name });
    expect(characterProfileSchemaFor(naming, ["strategic"], fields).properties).toMatchObject({ werewolfStrategyStyle: { minLength: 1, maxLength: 2000 }, strategyStyle: { minLength: 0 } });
    expect(() => decodeCharacterProfile(JSON.stringify({ ...draft, name: "" }), naming, ["strategic"], fields)).toThrow();
    for (const bad of [undefined, null, "", " ", 1, "a".repeat(2001)]) {
      expect(() => decodeCharacterProfile(JSON.stringify({ ...draft, werewolfStrategyStyle: bad }), naming, ["strategic"], fields)).toThrow();
    }
  });
  test("requires performance and visual design alongside the original fields", () => {
    expect(decodeCharacterProfile(JSON.stringify(encodedCharacter), naming)).toEqual(character);
  });
  test.each(["not json", "{}", "```json\n{}\n```", 'Here is {"name":"Mira"}', JSON.stringify({ ...encodedCharacter, extra: true }), JSON.stringify({ ...encodedCharacter, visualDesign: undefined }), JSON.stringify({ ...encodedCharacter, performanceInstructions: "" }), JSON.stringify({ ...encodedCharacter, gender: "unknown" })])("rejects malformed or incomplete output: %s", (output) => {
    expect(() => decodeCharacterProfile(output, naming)).toThrow();
  });
});
