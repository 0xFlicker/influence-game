import { describe, expect, it } from "bun:test";
import {
  ExactStructuredOutputRegistry,
  createExactStructuredOutputArtifact,
} from "../structured-output";
import type { ModelInvocation } from "../model-invocation";

interface ProviderPickPayload {
  target: string;
  rationale: string;
  metadata: {
    confidence: "low" | "high";
  };
}

interface AcceptedPick {
  targetPlayerId: string;
  rationale: string;
  confidence: "low" | "high";
}

const PLAYER_IDS = new Map([
  ["Blair", "player-blair"],
  ["Cleo", "player-cleo"],
]);

function pickArtifact() {
  return createExactStructuredOutputArtifact<ProviderPickPayload, AcceptedPick>({
    action: "test.pick-target.v1",
    name: "pick_target",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["target", "rationale", "metadata"],
      properties: {
        target: { type: "string", minLength: 1 },
        rationale: { type: "string", minLength: 1 },
        metadata: {
          type: "object",
          additionalProperties: false,
          required: ["confidence"],
          properties: {
            confidence: { type: "string", enum: ["low", "high"] },
          },
        },
      },
    },
    decodeProviderPayload(payload) {
      const targetPlayerId = PLAYER_IDS.get(payload.target);
      if (!targetPlayerId) return { status: "invalid", message: "unknown target" };
      if (!payload.rationale.trim()) return { status: "invalid", message: "blank rationale" };
      return {
        status: "valid",
        value: {
          targetPlayerId,
          rationale: payload.rationale,
          confidence: payload.metadata.confidence,
        },
      };
    },
    decodeAcceptedValue(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { status: "invalid", message: "accepted pick must be an object" };
      }
      const record = value as Record<string, unknown>;
      const exactKeys = Object.keys(record).sort().join(",") === "confidence,rationale,targetPlayerId";
      if (
        !exactKeys
        || typeof record.targetPlayerId !== "string"
        || typeof record.rationale !== "string"
        || (record.confidence !== "low" && record.confidence !== "high")
      ) {
        return { status: "invalid", message: "accepted pick shape mismatch" };
      }
      if (![...PLAYER_IDS.values()].includes(record.targetPlayerId)) {
        return { status: "invalid", message: "accepted pick target is not eligible" };
      }
      return {
        status: "valid",
        value: {
          targetPlayerId: record.targetPlayerId,
          rationale: record.rationale,
          confidence: record.confidence,
        },
      };
    },
  });
}

if (false) {
  const artifact = pickArtifact();
  const validStructured: ModelInvocation<AcceptedPick> = {
    messages: [],
    result: { kind: "structured", artifact },
    outputTokenLimit: 100,
  };
  const validText: ModelInvocation = {
    messages: [],
    result: { kind: "text" },
    outputTokenLimit: 100,
  };
  const validTool: ModelInvocation<AcceptedPick> = {
    messages: [],
    result: {
      kind: "tool",
      artifact,
      choice: { name: artifact.name },
      allowParallel: false,
    },
    outputTokenLimit: 100,
  };
  const invalidText: ModelInvocation = {
    messages: [],
    // @ts-expect-error text invocations cannot carry structured artifacts
    result: { kind: "text", artifact },
    outputTokenLimit: 100,
  };
  const invalidStructured: ModelInvocation = {
    messages: [],
    // @ts-expect-error structured invocations require their exact artifact
    result: { kind: "structured" },
    outputTokenLimit: 100,
  };
  const invalidTool: ModelInvocation = {
    messages: [],
    // @ts-expect-error tool invocations require their exact artifact
    result: { kind: "tool", choice: "required" },
    outputTokenLimit: 100,
  };
  void [validStructured, validText, validTool, invalidText, invalidStructured, invalidTool];
}

describe("exact structured output", () => {
  it("accepts one complete nested document and returns its decoded domain value", () => {
    const registry = new ExactStructuredOutputRegistry();
    const result = registry.decodeJsonDocument(
      pickArtifact(),
      JSON.stringify({
        target: "Blair",
        rationale: "Blair is exposed.",
        metadata: { confidence: "high" },
      }),
    );

    expect(result).toEqual({
      status: "valid",
      value: {
        targetPlayerId: "player-blair",
        rationale: "Blair is exposed.",
        confidence: "high",
      },
    });
  });

  it("rejects non-document, fenced, embedded, labeled, wrapped, array, and trailing forms", () => {
    const registry = new ExactStructuredOutputRegistry();
    const artifact = pickArtifact();
    const valid = JSON.stringify({
      target: "Blair",
      rationale: "Blair is exposed.",
      metadata: { confidence: "high" },
    });
    const invalidDocuments = [
      "plain text",
      `\`\`\`json\n${valid}\n\`\`\``,
      `Here is the result: ${valid}`,
      `result=${valid}`,
      JSON.stringify({ arguments: JSON.parse(valid) }),
      JSON.stringify({ pick_target: JSON.parse(valid) }),
      JSON.stringify([JSON.parse(valid)]),
      `${valid}\ntrailing`,
    ];

    for (const document of invalidDocuments) {
      expect(registry.decodeJsonDocument(artifact, document).status).toBe("invalid");
    }
  });

  it("rejects structural and semantic gaps without mutating candidates", () => {
    const registry = new ExactStructuredOutputRegistry();
    const artifact = pickArtifact();
    const candidates = [
      {},
      { target: "Blair", rationale: "reason" },
      { target: "Blair", rationale: "reason", metadata: { confidence: "high" }, extra: true },
      { target: "Blair", rationale: "reason", metadata: { confidence: "high", extra: true } },
      { target: ["Blair"], rationale: "reason", metadata: { confidence: "high" } },
      { target: "Blair", rationale: "reason", metadata: { confidence: "medium" } },
      { target: "Blair", rationale: "", metadata: { confidence: "low" } },
      { target: "Unknown", rationale: "reason", metadata: { confidence: "low" } },
    ];

    for (const candidate of candidates) {
      const before = structuredClone(candidate);
      expect(registry.decodeProviderPayload(artifact, candidate).status).toBe("invalid");
      expect(candidate).toEqual(before);
    }
  });

  it("compiles once per immutable artifact identity without name-based aliasing", () => {
    const registry = new ExactStructuredOutputRegistry();
    const first = pickArtifact();
    const second = createExactStructuredOutputArtifact<{ replacement: string }, string>({
      action: "test.pick-replacement.v1",
      name: "pick_target",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["replacement"],
        properties: { replacement: { type: "string", minLength: 1 } },
      },
      decodeProviderPayload: (payload) => ({ status: "valid", value: payload.replacement }),
      decodeAcceptedValue: (value) => typeof value === "string" && value.trim()
        ? { status: "valid", value }
        : { status: "invalid", message: "replacement must be non-empty" },
    });

    registry.decodeProviderPayload(first, {
      target: "Blair",
      rationale: "reason",
      metadata: { confidence: "high" },
    });
    registry.decodeProviderPayload(first, {
      target: "Cleo",
      rationale: "reason",
      metadata: { confidence: "low" },
    });
    expect(registry.observedArtifactCount).toBe(1);
    expect(registry.decodeProviderPayload(second, { replacement: "Cleo" })).toEqual({
      status: "valid",
      value: "Cleo",
    });
    expect(registry.decodeProviderPayload(second, {
      target: "Blair",
      rationale: "reason",
      metadata: { confidence: "high" },
    }).status).toBe("invalid");
    expect(registry.observedArtifactCount).toBe(2);
  });

  it("copies Ajv errors before a later validation overwrites internal state", () => {
    const registry = new ExactStructuredOutputRegistry();
    const artifact = pickArtifact();
    const first = registry.decodeProviderPayload(artifact, {});
    expect(first).toMatchObject({ status: "invalid", kind: "schema_mismatch" });
    if (first.status !== "invalid") throw new Error("Expected invalid structured output.");
    const preserved = structuredClone(first.issues);

    registry.decodeProviderPayload(artifact, {
      target: "Blair",
      rationale: "reason",
      metadata: { confidence: "wrong" },
    });
    expect(first.issues).toEqual(preserved);
  });

  it("fails artifact construction on unsupported schema keywords", () => {
    expect(() => createExactStructuredOutputArtifact<Record<string, unknown>, Record<string, unknown>>({
      action: "test.invalid-schema.v1",
      name: "invalid_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        requird: ["value"],
        properties: { value: { type: "string" } },
      },
      decodeProviderPayload: (value) => ({ status: "valid", value }),
      decodeAcceptedValue: (value) => value && typeof value === "object" && !Array.isArray(value)
        ? { status: "valid", value: value as Record<string, unknown> }
        : { status: "invalid", message: "not an object" },
    })).toThrow("requird");
  });

  it("propagates decoder programming errors instead of classifying them as model output", () => {
    const artifact = createExactStructuredOutputArtifact<{ value: string }, string>({
      action: "test.throwing-decoder.v1",
      name: "throwing_decoder",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: { value: { type: "string" } },
      },
      decodeProviderPayload() {
        throw new Error("decoder programming defect");
      },
      decodeAcceptedValue() {
        throw new Error("accepted decoder programming defect");
      },
    });
    const registry = new ExactStructuredOutputRegistry();

    expect(() => registry.decodeProviderPayload(artifact, { value: "valid" }))
      .toThrow("decoder programming defect");
    expect(() => registry.decodeAcceptedValue(artifact, "valid"))
      .toThrow("accepted decoder programming defect");
  });

  it("validates provider-name and accepted-UUID representations through separate decoders", () => {
    const registry = new ExactStructuredOutputRegistry();
    const artifact = pickArtifact();
    const live = registry.decodeProviderPayload(artifact, {
      target: "Blair",
      rationale: "reason",
      metadata: { confidence: "high" },
    });
    expect(live).toMatchObject({
      status: "valid",
      value: { targetPlayerId: "player-blair" },
    });
    expect(registry.decodeAcceptedValue(artifact, {
      targetPlayerId: "player-blair",
      rationale: "reason",
      confidence: "high",
    })).toEqual(live);
    expect(registry.decodeAcceptedValue(artifact, {
      target: "Blair",
      rationale: "reason",
      metadata: { confidence: "high" },
    }).status).toBe("invalid");
  });

  it("applies the exact provider schema to replay values when both representations match", () => {
    const registry = new ExactStructuredOutputRegistry();
    const artifact = createExactStructuredOutputArtifact<
      { target: string },
      { target: string }
    >({
      action: "test.same-live-and-replay.v1",
      name: "same_live_and_replay",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["target"],
        properties: { target: { type: "string", minLength: 1 } },
      },
      acceptedValueUsesProviderSchema: true,
      decodeProviderPayload: (value) => ({ status: "valid", value }),
      decodeAcceptedValue: (value) => ({
        status: "valid",
        value: value as { target: string },
      }),
    });

    expect(registry.decodeAcceptedValue(artifact, { target: "Blair" })).toEqual({
      status: "valid",
      value: { target: "Blair" },
    });
    expect(registry.decodeAcceptedValue(artifact, {
      target: "Blair",
      extra: true,
    })).toMatchObject({
      status: "invalid",
      kind: "schema_mismatch",
    });
  });
});
