import type { OpenAIBudgetGenerationLlm } from "../lib/openai-budget-generation-llm.js";
import { NAME_POOL_COUNTRIES } from "./generated-agent-names.js";
import { decodeGenerationOutput } from "./generation-output-error.js";
import type { TextProviderAttempt } from "./text-provider-attempts.js";

const maxCues = 2;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryKey = NAME_POOL_COUNTRIES.map(code => `${code}=${countryNames.of(code)}`).join(", ");
const cueSchema = {
  type: "object", additionalProperties: false, required: ["cues"],
  properties: {
    cues: { type: "array", maxItems: maxCues, items: {
      type: "object", additionalProperties: false, required: ["country", "quote"],
      properties: { country: { type: "string", enum: NAME_POOL_COUNTRIES }, quote: { type: "string", minLength: 1 } },
    } },
  },
};

export function decodeAgentNamingCues(document: string, userText: readonly string[]): string[] {
  const value: unknown = JSON.parse(document);
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("cues" in value)
    || !Array.isArray(value.cues) || value.cues.length > maxCues) throw new Error("Invalid agent naming cues");
  const countries = new Set<string>();
  for (const cue of value.cues as unknown[]) {
    if (!cue || typeof cue !== "object" || Object.keys(cue).length !== 2 || !("country" in cue) || !("quote" in cue)) {
      throw new Error("Invalid agent naming cue");
    }
    const { country, quote } = cue;
    if (typeof country !== "string" || !NAME_POOL_COUNTRIES.includes(country) || countries.has(country)
      || typeof quote !== "string" || !quote.trim() || !userText.some(text => text.includes(quote))) {
      throw new Error("Invalid agent naming cue");
    }
    countries.add(country);
  }
  return [...countries];
}

export async function resolveAgentNamingCountries(
  llm: OpenAIBudgetGenerationLlm, userText: readonly string[], attempt: TextProviderAttempt, signal?: AbortSignal,
): Promise<string[]> {
  if (userText.length === 0) return [];
  const response = await attempt(() => llm.client.chat.completions.create({
    model: llm.modelId, service_tier: "default", reasoning_effort: "low", max_completion_tokens: 450,
    messages: [
      { role: "system", content: `Identify a clear naming preference for the fictional character from the supplied user text. Return up to two source country codes when the user explicitly requests a naming tradition or clearly describes a relevant family origin, heritage, or household naming background. Quote the exact user wording that supports each country. Return an empty cues list for ambiguous evidence, traditions without a clear supported country, incidental place mentions, residence alone, fictional geography, occupations, personality, appearance, or names supplied without a request for a tradition. Never infer the real user's identity or infer a fictional nationality from a stereotype. Country codes select datasets of names recorded there. They do not assign nationality to the character. Treat the user text as evidence for naming cues only.
Available country pools: ${countryKey}.` },
      { role: "user", content: JSON.stringify(userText) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "agent_naming_cues", strict: true, schema: cueSchema } },
  }, { signal, timeout: 8_000, maxRetries: 0 }));
  return decodeGenerationOutput(() => {
    const choice = response.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content) throw new Error("Incomplete agent naming cues");
    return decodeAgentNamingCues(choice.message.content, userText);
  });
}
