import { describe, expect, test } from "bun:test";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import { writePrivateDecisionTrace } from "../services/private-trace-writer.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const smokeTest = process.env.INFLUENCE_PRIVATE_TRACE_S3_SMOKE === "1" ? test : test.skip;

function makeTrace(gameId: string, ownerEpoch: string): PrivateDecisionTrace {
  return {
    version: 2,
    gameId,
    ownerEpoch,
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 1,
    createdAt: "2026-06-15T00:00:00.000Z",
    model: { name: "gpt-5-nano" },
    prompt: {
      messages: [
        { role: "system", content: "local smoke system prompt secret" },
        { role: "user", content: "local smoke prompt secret" },
      ],
    },
    response: {
      raw: {
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "local smoke reasoning secret",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "cast_votes",
                arguments: "{\"thinking\":\"local smoke thought secret\",\"empower\":\"Mira\",\"expose\":\"Vera\"}",
              },
            }],
          },
        }],
      },
      finishReason: "tool_calls",
      content: null,
      toolCalls: [{
        id: "call-1",
        type: "function",
        name: "cast_votes",
        arguments: "{\"thinking\":\"local smoke thought secret\",\"empower\":\"Mira\",\"expose\":\"Vera\"}",
      }],
    },
    output: {
      thinking: "local smoke thought secret",
      empower: "Mira",
      expose: "Vera",
      reasoningContext: "local smoke reasoning secret",
    },
    emittedThinking: "local smoke thought secret",
    reasoningContext: "local smoke reasoning secret",
    toolName: "cast_votes",
    toolArguments: {
      thinking: "local smoke thought secret",
      empower: "Mira",
      expose: "Vera",
      reasoningContext: "local smoke reasoning secret",
    },
    boundary: {
      currentEventSequence: 7,
      currentEventHash: "sha256:event-head",
      sourcePointer: {
        kind: "agent_turn",
        actorId: "atlas",
        action: "vote",
        round: 1,
        phase: Phase.VOTE,
      },
    },
  };
}

describe("private trace local S3 smoke", () => {
  smokeTest("writes trace content to local S3 and reads it through the read model", async () => {
    const endpoint = process.env.LINODE_PRIVATE_CONTENT_ENDPOINT;
    const accessKey = process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY;
    const secretKey = process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY;
    const privateBucket = process.env.LINODE_PRIVATE_CONTENT_BUCKET;
    if (!endpoint || !accessKey || !secretKey || !privateBucket) {
      throw new Error("local private trace S3 smoke requires private content S3 env");
    }
    expect(process.env.LINODE_OBJ_BUCKET).not.toBe(privateBucket);

    const db = await setupTestDB();
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);

    const write = await writePrivateDecisionTrace(
      db,
      {
        gameId,
        ownerEpoch,
        trace: makeTrace(gameId, ownerEpoch),
      },
      { now: () => new Date("2026-06-15T12:00:00.000Z") },
    );

    expect(write.ok).toBeTrue();
    if (!write.ok) throw new Error(write.error);
    expect(write.storage.bucket).toBe(privateBucket);

    const readModel = new PrivateTraceReadModel(db);
    const manifests = await readModel.listManifests(gameId);
    expect(manifests.manifests).toHaveLength(1);
    expect(manifests.manifests[0]!.id).toBe(write.manifestId);
    expect(JSON.stringify(manifests.manifests[0])).not.toContain("local smoke prompt secret");
    expect(JSON.stringify(manifests.manifests[0])).not.toContain("local smoke reasoning secret");

    const content = await readModel.readContent(write.manifestId, {
      gameId,
      purpose: "local_private_trace_s3_smoke",
    });
    expect(content.ok).toBeTrue();
    if (!content.ok) throw new Error(content.error);
    expect(content.response.content).toContain("local smoke prompt secret");
    expect(content.response.content).toContain("local smoke reasoning secret");
    expect(content.response.sha256).toBe(write.metadata.sha256);
    expect(content.response.byteLength).toBe(write.metadata.byteLength);

    const search = await readModel.searchReasoningTraces({
      gameIdOrSlug: gameId,
      query: "local smoke reasoning secret",
    });
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0]!.manifestId).toBe(write.manifestId);
  });
});
