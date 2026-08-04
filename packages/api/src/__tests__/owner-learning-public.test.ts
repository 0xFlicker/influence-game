import { afterEach, describe, expect, test } from "bun:test";
import {
  ownerLearningDeploymentEnabled,
  ownerLearningGenerationEnabled,
} from "../services/owner-learning-public.js";

const originalEnabled = process.env.INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  restore("INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED", originalEnabled);
  restore("OPENAI_API_KEY", originalApiKey);
});

describe("owner learning deployment gate", () => {
  test("requires an explicit deployment enablement and a provider credential", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED;
    expect(ownerLearningDeploymentEnabled()).toBe(false);
    expect(ownerLearningGenerationEnabled()).toBe(false);

    process.env.INFLUENCE_OWNER_LEARNING_GENERATION_ENABLED = "true";
    expect(ownerLearningDeploymentEnabled()).toBe(true);
    expect(ownerLearningGenerationEnabled()).toBe(true);

    delete process.env.OPENAI_API_KEY;
    expect(ownerLearningDeploymentEnabled()).toBe(true);
    expect(ownerLearningGenerationEnabled()).toBe(false);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
