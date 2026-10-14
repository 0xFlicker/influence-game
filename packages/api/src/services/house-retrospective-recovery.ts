import Ajv from "ajv";
import type { DrizzleDB } from "../db/index.js";
import { HouseInspectionError, resolveHouseSpectatorGame } from "./house-game-access.js";
import { resumeGameRetrospective, RetrospectiveRecoveryError } from "./game-retrospective-recovery.js";

export interface HouseRetrospectiveResumeInput { gameIdOrSlug: string; gameKind: "influence" | "werewolf";
  expectedHead: { sequence: number; hash: string }; expectedFailureId: string | null; idempotencyKey: string }
const hash = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
export const retrospectiveResumeInputSchema = { type: "object", additionalProperties: false,
  required: ["gameIdOrSlug", "gameKind", "expectedHead", "expectedFailureId", "idempotencyKey"], properties: {
    gameIdOrSlug: { type: "string", minLength: 1, maxLength: 512 }, gameKind: { type: "string", enum: ["influence", "werewolf"] },
    expectedHead: { type: "object", additionalProperties: false, required: ["sequence", "hash"], properties: { sequence: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, hash } },
    expectedFailureId: { anyOf: [hash, { type: "null" }] }, idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
  } };
const validate = new Ajv({ strict: false }).compile(retrospectiveResumeInputSchema);
export function assertRetrospectiveResumeInput(value: unknown): asserts value is HouseRetrospectiveResumeInput {
  if (!validate(value)) throw new HouseInspectionError("invalid_input", "Recovery arguments do not match the exact schema");
}
export async function resumeHouseGameRetrospective(db: DrizzleDB, input: HouseRetrospectiveResumeInput, actorUserId: string) {
  assertRetrospectiveResumeInput(input);
  const game = await resolveHouseSpectatorGame(db, input.gameIdOrSlug);
  if (game.gameKind !== input.gameKind) throw new HouseInspectionError("unsupported_game_kind", "Requested game kind does not match this game");
  try {
    const result = await resumeGameRetrospective(db, { gameId: game.id, expectedHead: input.expectedHead,
      expectedFailureId: input.expectedFailureId, idempotencyKey: input.idempotencyKey }, actorUserId);
    return { schemaVersion: 1 as const, ...result, gameKind: game.gameKind };
  } catch (error) {
    if (error instanceof RetrospectiveRecoveryError) throw new HouseInspectionError(error.code, error.message);
    throw error;
  }
}
