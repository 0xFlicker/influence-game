import { expect, test } from "bun:test";
import { validateMingleWindowState } from "../mingle-window-contract";
import { allocateRooms, type MingleWindowState } from "../phases/mingle";
import { Phase } from "../types";

function window(): MingleWindowState {
  const alivePlayers = Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}` }));
  const initialAllocation = allocateRooms(null, alivePlayers, 3, 1);
  return { phase: Phase.FORMAT_MINGLE, alivePlayers, roomCount: 3, beats: 2, nextBeat: 1,
    initialAllocation, roomByPlayerId: Object.fromEntries(initialAllocation.rooms.flatMap((room) => room.playerIds.map((id) => [id, room.roomId]))), allRooms: [] };
}

test("accepts exact serialized Mingle boundaries and completed windows", () => {
  const state = window();
  expect(validateMingleWindowState(JSON.parse(JSON.stringify(state)))).toEqual([]);
  state.allRooms = [...structuredClone(state.initialAllocation.rooms), ...state.initialAllocation.rooms.map((room) => ({ ...room, beat: 2 }))];
  state.nextBeat = 3;
  expect(validateMingleWindowState(state)).toEqual([]);
});

test("rejects malformed shapes, unknown fields, inconsistent history and incomplete movement", () => {
  for (const value of ["{}", {}, { ...window(), unknown: true }, { ...window(), nextBeat: 4 },
    { ...window(), nextBeat: 2 }, { ...window(), roomByPlayerId: {} },
    { ...window(), alivePlayers: [window().alivePlayers[0], window().alivePlayers[0]] }]) {
    expect(validateMingleWindowState(value).length).toBeGreaterThan(0);
  }
  const duplicate = window();
  duplicate.initialAllocation.rooms[0]!.playerIds.push("p0");
  expect(validateMingleWindowState(duplicate).length).toBeGreaterThan(0);
  const extra = window();
  Object.assign(extra.initialAllocation.diagnostics.assignments[0]!, { bogus: "not a persisted field" });
  expect(validateMingleWindowState(extra).length).toBeGreaterThan(0);
});


test("preserves invalid requested destinations as diagnostics without accepting them as positions", () => {
  const state = window();
  state.initialAllocation.diagnostics.actions = [{ player: state.alivePlayers[0]!, turn: 1,
    fromRoomId: 1, toRoomId: 1, moved: false, action: "no_reply", gotoRoomId: -1,
    gotoPlayerName: null, gotoStatus: "invalid" }];
  expect(validateMingleWindowState(state)).toEqual([]);
  state.roomByPlayerId.p0 = -1;
  expect(validateMingleWindowState(state).length).toBeGreaterThan(0);
});
