import Ajv from "ajv";
import type { MingleWindowState } from "./phases/mingle";
import { Phase } from "./types";
import { computeMingleRoomCount } from "./mingle-turn-execution";

const text = { type: "string" };
const id = { type: "string", minLength: 1 };
const positive = { type: "integer", minimum: 1 };
const nullableText = { type: ["string", "null"] };
const list = (items: object) => ({ type: "array", maxItems: 1000, items });
const object = (properties: Record<string, object>, optional: string[] = []) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties).filter((key) => !optional.includes(key)) });
const player = object({ id, name: id });
const room = object({ roomId: positive, round: positive, beat: positive, playerIds: { ...list(id), uniqueItems: true } });
const intent = object({ seekPlayers: list(text), avoidPlayers: list(text), preferredRoomSize: { enum: ["solo", "pair", "small_group", "large_group", "any"] }, purpose: text, provisionalTarget: nullableText, noTargetReason: nullableText, openingAsk: text, strategicLens: { enum: ["vote_math", "room_traffic", "promise_debt", "power_position", "private_inconsistency", "coalition_geometry", "information_control", "jury_threat", "loyalty_stress", "retaliation_risk", "social_cover", "timing_pattern", "presentation_read", "relationship_repair", "broad_read"] }, strategicLensRationale: text });
const assignment = object({ player, assignedRoomId: positive, source: { enum: ["house", "repaired", "fallback", "movement"] }, repairNotes: list(text), intent: { anyOf: [intent, { type: "null" }] } }, ["repairNotes", "intent"]);
const action = object({ player, turn: positive, fromRoomId: positive, toRoomId: positive, moved: { type: "boolean" }, action: { enum: ["talk", "no_reply"] }, gotoRoomId: { type: ["number", "null"] }, gotoPlayerName: nullableText, gotoRoomIgnored: { type: "boolean" }, gotoStatus: { enum: ["valid", "missing", "invalid", "player_valid", "player_valid_room_ignored", "player_unknown", "player_dead", "player_self", "player_cycle"] } }, ["gotoRoomIgnored"]);
const diagnostics = object({ round: positive, beat: positive, roomCount: positive, eligiblePlayers: list(player), assignments: list(assignment), allocatedRooms: list(object({ roomId: positive, beat: positive, players: list(player), conversationRan: { type: "boolean" } })), actions: list(action) }, ["actions"]);
const validate = new Ajv({ allErrors: true }).compile<MingleWindowState>(object({
  phase: { enum: [Phase.MINGLE, Phase.MINGLE_I, Phase.POST_VOTE_MINGLE, Phase.FORMAT_MINGLE] },
  alivePlayers: list(player), roomCount: positive, beats: { ...positive, maximum: 1000 }, nextBeat: positive,
  initialAllocation: object({ rooms: list(room), diagnostics }),
  roomByPlayerId: { type: "object", maxProperties: 1000, additionalProperties: positive }, allRooms: list(room),
}));

/** Exact persisted shape plus cross-field constraints for resumable simultaneous beats. */
export function validateMingleWindowState(value: unknown): string[] {
  if (!validate(value)) return (validate.errors ?? []).map((error) => `mingle window ${error.instancePath}: ${error.message}`);
  const errors: string[] = [];
  const ids = value.alivePlayers.map((player) => player.id);
  if (new Set(ids).size !== ids.length || computeMingleRoomCount(ids.length) !== value.roomCount) errors.push("mingle window roster or room count is invalid");
  if (value.nextBeat > value.beats + 1) errors.push("mingle window beat exceeds completion");
  if (Object.keys(value.roomByPlayerId).length !== ids.length || ids.some((id) => !Object.hasOwn(value.roomByPlayerId, id) || value.roomByPlayerId[id]! > value.roomCount)) errors.push("mingle window movement map is incomplete");
  const round = value.initialAllocation.diagnostics.round;
  const checkRooms = (rooms: MingleWindowState["allRooms"], beat: number) => {
    const roomIds = rooms.map((room) => room.roomId).sort((a, b) => a - b);
    const occupants = rooms.flatMap((room) => room.playerIds);
    if (roomIds.length !== value.roomCount || roomIds.some((id, index) => id !== index + 1)
      || occupants.length !== ids.length || new Set(occupants).size !== ids.length || occupants.some((id) => !ids.includes(id))
      || rooms.some((room) => room.round !== round || room.beat !== beat)) errors.push("mingle window allocation is inconsistent");
  };
  checkRooms(value.initialAllocation.rooms, 1);
  if (value.nextBeat === 1 && value.initialAllocation.rooms.some((room) => room.playerIds.some((id) => value.roomByPlayerId[id] !== room.roomId))) errors.push("mingle initial movement map differs from allocation");
  if (value.allRooms.length !== (value.nextBeat - 1) * value.roomCount) errors.push("mingle window history is incomplete");
  for (let beat = 1; beat < value.nextBeat; beat += 1) checkRooms(value.allRooms.filter((room) => room.beat === beat), beat);
  return errors;
}
