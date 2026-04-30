import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GamePlayer, TranscriptEntry } from "../lib/api";
import { buildWhisperStageData, OpenWhisperRoomsView } from "../app/games/[slug]/components/whisper-phase";

const players: GamePlayer[] = [
  { id: "p1", name: "Atlas", persona: "strategic", status: "alive", shielded: false },
  { id: "p2", name: "Vera", persona: "strategic", status: "alive", shielded: false },
  { id: "p3", name: "Finn", persona: "strategic", status: "alive", shielded: false },
];

function entry(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "WHISPER",
    fromPlayerId: null,
    fromPlayerName: null,
    scope: "system",
    toPlayerIds: null,
    text: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("buildWhisperStageData", () => {
  it("uses roomMetadata for open-room group, singleton, and empty rooms", () => {
    const stage = buildWhisperStageData([
      entry({
        text: "Beat 1: Room 1: Atlas, Vera | Room 2: Finn | Room 3: Empty",
        roomMetadata: {
          rooms: [
            { roomId: 1, round: 1, beat: 1, playerIds: ["p1", "p2"] },
            { roomId: 2, round: 1, beat: 1, playerIds: ["p3"] },
            { roomId: 3, round: 1, beat: 1, playerIds: [] },
          ],
          excluded: [],
        },
      }),
      entry({
        id: 2,
        fromPlayerId: "p1",
        fromPlayerName: "Atlas",
        scope: "whisper",
        toPlayerIds: ["p2"],
        roomId: 1,
        text: "Vera, this room is hot.",
        timestamp: 2,
      }),
    ], players);

    expect(stage.rooms.map((room) => ({
      id: room.roomId,
      local: room.localRoomNumber,
      names: room.playerNames,
      messages: room.messages.length,
    }))).toEqual([
      { id: 1, local: 1, names: ["Atlas", "Vera"], messages: 1 },
      { id: 2, local: 2, names: ["Finn"], messages: 0 },
      { id: 3, local: 3, names: [], messages: 0 },
    ]);
    expect(stage.hasRoomMetadata).toBe(true);
  });

  it("falls back to allocation text for historical pair-room replays", () => {
    const stage = buildWhisperStageData([
      entry({ text: "Room 1: Atlas & Vera | Commons: Finn" }),
    ], players);

    expect(stage.rooms[0]?.playerNames).toEqual(["Atlas", "Vera"]);
    expect(stage.commons.map((player) => player.name)).toEqual(["Finn"]);
    expect(stage.hasRoomMetadata).toBe(false);
  });

  it("renders open-room telemetry instead of pair-room sequence chrome", () => {
    const html = renderToString(
      <OpenWhisperRoomsView
        phaseKey="round-1-whisper"
        players={players}
        phaseEntries={[
          entry({
            text: "Beat 1: Room 12: Atlas, Vera | Room 13: Finn | Room 14: Empty",
            roomMetadata: {
              rooms: [
                { roomId: 12, round: 1, beat: 1, playerIds: ["p1", "p2"] },
                { roomId: 13, round: 1, beat: 1, playerIds: ["p3"] },
                { roomId: 14, round: 1, beat: 1, playerIds: [] },
              ],
              excluded: [],
            },
          }),
          entry({
            id: 2,
            fromPlayerId: "p1",
            fromPlayerName: "Atlas",
            scope: "whisper",
            toPlayerIds: ["p2"],
            roomId: 12,
            text: "Vera, this room is hot.",
            timestamp: 2,
          }),
        ]}
      />,
    );

    expect(html).toContain("WHISPER: OPEN ROOMS");
    expect(html).toContain("HOUSE MAP");
    expect(html).toContain("R1");
    expect(html).toContain("Private Feed");
    expect(html).toContain("BACKCHANNEL");
    expect(html).toContain("SINGLE");
    expect(html).toContain("EMPTY");
    expect(html).not.toContain("Whisper Room 12");
  });
});
