export function agentCommandOutputSchema(): Record<string, unknown> {
  const currentRevisionSchema = {
    anyOf: [{
      type: "object",
      required: ["revisionId", "ordinal", "active"],
      properties: {
        revisionId: { type: "string" },
        ordinal: { type: "number" },
        active: { type: "boolean", const: true },
      },
      additionalProperties: false,
    }, { type: "null" }],
  };
  const enrollmentSchema = {
    anyOf: [{
      type: "object",
      required: ["gameId", "slug", "status", "queueType", "revision"],
      properties: {
        gameId: { type: "string" },
        slug: { type: "string" },
        status: { type: "string", enum: ["waiting", "in_progress", "suspended"] },
        queueType: { type: "string", enum: ["daily-free", "open-game"] },
        revision: {
          type: "object",
          required: ["disposition", "effectiveRevisionId"],
          properties: {
            disposition: { type: "string", enum: ["follows-current", "pinned"] },
            effectiveRevisionId: nullableSchema({ type: "string" }),
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    }, { type: "null" }],
  };
  const waitingSeatReferenceSchema = {
    type: "object",
    required: ["gameId", "slug", "disposition", "effectiveRevisionId"],
    properties: {
      gameId: { type: "string" },
      slug: { type: "string" },
      disposition: { type: "string", enum: ["reconciled", "already_current", "crossed_freeze"] },
      effectiveRevisionId: nullableSchema({ type: "string" }),
    },
    additionalProperties: false,
  };
  const receiptSchema = {
    type: "object",
    required: ["schemaVersion", "operation", "agent", "profileRevision", "dailyFree", "waitingSeats", "frozenSeats", "warnings"],
    properties: {
      schemaVersion: { type: "number", const: 1 },
      operation: { type: "string", enum: ["created", "updated"] },
      agent: {
        type: "object",
        required: ["agentProfileId", "identityDisposition"],
        properties: {
          agentProfileId: { type: "string" },
          identityDisposition: { type: "string", enum: ["created", "preserved"] },
        },
        additionalProperties: false,
      },
      profileRevision: {
        type: "object",
        required: ["revisionId", "ordinal", "outcome", "active"],
        properties: {
          revisionId: { type: "string" },
          ordinal: { type: "number" },
          outcome: { type: "string", enum: ["created", "preserved"] },
          active: { type: "boolean", const: true },
        },
        additionalProperties: false,
      },
      dailyFree: { type: "string", enum: ["not_enrolled", "preserved_follows_profile"] },
      waitingSeats: {
        type: "object",
        required: ["total", "reconciled", "alreadyCurrent", "crossedFreeze", "games", "truncatedCount"],
        properties: {
          total: { type: "number" },
          reconciled: { type: "number" },
          alreadyCurrent: { type: "number" },
          crossedFreeze: { type: "number" },
          games: { type: "array", items: waitingSeatReferenceSchema },
          truncatedCount: { type: "number" },
        },
        additionalProperties: false,
      },
      frozenSeats: {
        type: "object",
        required: ["unchanged"],
        properties: { unchanged: { type: "number" } },
        additionalProperties: false,
      },
      avatarCompletion: { type: "object", additionalProperties: true },
      warnings: { type: "array", items: { type: "string", enum: ["avatar_generation_failed"] } },
    },
    additionalProperties: false,
  };
  return {
    type: "object",
    required: ["schemaVersion", "accountRating", "agent", "message", "receipt"],
    properties: {
      schemaVersion: { type: "number", const: 1 },
      accountRating: { type: "object", additionalProperties: true },
      agent: {
        type: "object",
        required: ["id", "displayName", "currentRevision", "queueState", "activeEnrollment"],
        properties: {
          id: { type: "string" },
          displayName: { type: "string" },
          currentRevision: currentRevisionSchema,
          queueState: { type: "object", additionalProperties: true },
          activeEnrollment: enrollmentSchema,
        },
        additionalProperties: true,
      },
      message: { type: "string" },
      receipt: receiptSchema,
      avatarCompletion: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  };
}

function nullableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: "null" }] };
}
