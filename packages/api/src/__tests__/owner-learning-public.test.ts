import { afterEach, describe, expect, test } from "bun:test";
import {
  ownerLearningDeploymentEnabled,
  ownerLearningGenerationEnabled,
} from "../services/owner-learning-public.js";

const originalDisabled = process.env.INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED;
const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  restore("INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED", originalDisabled);
  restore("OPENAI_API_KEY", originalApiKey);
});

describe("owner learning deployment gate", () => {
  test("defaults on, supports an explicit deployment disablement, and requires a provider credential", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED;
    expect(ownerLearningDeploymentEnabled()).toBe(true);
    expect(ownerLearningGenerationEnabled()).toBe(true);

    process.env.INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED = " true ";
    expect(ownerLearningDeploymentEnabled()).toBe(false);
    expect(ownerLearningGenerationEnabled()).toBe(false);

    process.env.INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED = "false";
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
