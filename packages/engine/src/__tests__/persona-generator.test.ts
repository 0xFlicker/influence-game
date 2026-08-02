import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { generatePersona } from "../persona-generator";

function makeOpenAIStub(requests: Array<Record<string, unknown>>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          requests.push(request as Record<string, unknown>);
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  personality: "A thoughtful strategist.",
                  strategy: "Build trust before making a decisive move.",
                }),
              },
            }],
          };
        },
      },
    },
  } as unknown as OpenAI;
}

describe("persona generation defaults", () => {
  test("sends GPT-5.6 Luna when the model is omitted", async () => {
    const requests: Array<Record<string, unknown>> = [];

    await generatePersona(makeOpenAIStub(requests), "Atlas", "strategic");

    expect(requests[0]).toMatchObject({
      model: "gpt-5.6-luna",
      max_completion_tokens: 4200,
    });
  });
});
