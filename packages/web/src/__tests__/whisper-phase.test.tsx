import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { GamePlayer, TranscriptEntry } from "../lib/api";
import {
  buildWhisperStageData,
  OpenWhisperRoomsView,
  WhisperAllocationOverview,
  WhisperRoomDM,
} from "../app/games/[slug]/components/whisper-phase";

const players: GamePlayer[] = [
  { id: "p1", name: "Atlas", persona: "strategic", status: "alive", shielded: false },
  { id: "p2", name: "Vera", persona: "strategic", status: "alive", shielded: false },
  { id: "p3", name: "Finn", persona: "strategic", status: "alive", shielded: false },
];

const crowdedPlayers: GamePlayer[] = [
  ...players,
  { id: "p4", name: "Echo", persona: "strategic", status: "alive", shielded: false },
  { id: "p5", name: "Kael", persona: "strategic", status: "alive", shielded: false },
  { id: "p6", name: "Jace", persona: "strategic", status: "alive", shielded: false },
  { id: "p7", name: "Iris", persona: "strategic", status: "alive", shielded: false },
  { id: "p8", name: "Nyx", persona: "strategic", status: "alive", shielded: false },
  { id: "p9", name: "Lyra", persona: "strategic", status: "alive", shielded: false },
  { id: "p10", name: "Sage", persona: "strategic", status: "alive", shielded: false },
];

function entry(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "MINGLE",
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
  it("keeps room portrait previews separate from room selection", () => {
    const currentPlayers: GamePlayer[] = [
      {
        ...players[0]!,
        personaKey: "strategic",
        currentAgent: {
          name: "Atlas After Rename",
          avatarUrl: "/avatars/atlas-current.png",
          role: { key: "aggressive", label: "Aggressor" },
          competition: {
            gamesPlayed: 3,
            wins: 1,
            winRate: 1 / 3,
          },
        },
      },
      players[1]!,
      players[2]!,
    ];
    const html = renderToString(
      <OpenWhisperRoomsView
        phaseKey="round-1-mingle"
        players={currentPlayers}
        phaseEntries={[
          entry({
            text: "Beat 1: Room 12: Atlas, Vera | Room 13: Finn",
            roomMetadata: {
              rooms: [
                { roomId: 12, round: 1, beat: 1, playerIds: ["p1", "p2"] },
                { roomId: 13, round: 1, beat: 1, playerIds: ["p3"] },
              ],
              excluded: [],
            },
          }),
        ]}
      />,
    );

    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain('aria-label="Select Mingle room R1"');
    expect(html).toContain("/avatars/atlas-current.png");
    expect(html).not.toContain("Atlas After Rename");
    expect(html).not.toContain("-space-x");
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("exposes room focus as a keyboard-native sibling action", () => {
    const stage = buildWhisperStageData([
      entry({
        text: "Room 1: Atlas & Vera | Commons: Finn",
      }),
      entry({
        id: 2,
        fromPlayerId: "p1",
        fromPlayerName: "Atlas",
        scope: "mingle",
        toPlayerIds: ["p2"],
        roomId: 1,
        text: "Vera, this room is hot.",
        timestamp: 2,
      }),
    ], players);
    const html = renderToString(
      <WhisperRoomDM
        room={stage.rooms[0]!}
        players={players}
        focused={false}
        onFocus={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Focus room 1"');
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

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
        scope: "mingle",
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
        phaseKey="round-1-mingle"
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
            scope: "mingle",
            toPlayerIds: ["p2"],
            roomId: 12,
            text: "Vera, this room is hot.",
            timestamp: 2,
          }),
        ]}
      />,
    );

    expect(html).toContain("MINGLE");
    expect(html).toContain("MINGLE MAP");
    expect(html).toContain("R1");
    expect(html).toContain("Mingle Feed");
    expect(html).toContain("GROUP");
    expect(html).toContain("SINGLE");
    expect(html).toContain("EMPTY");
    expect(html).toContain("Mingle Movement");
    expect(html).toContain("flex h-full min-h-0 w-full flex-col");
    expect(html).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(html).not.toContain("data-controls");
    expect(html).not.toContain("Whisper Room 12");
    expect(html).not.toContain("MINGLE: OPEN ROOMS");
    expect(html).not.toContain("HOUSE MAP");
    expect(html).not.toContain("Other Rooms");
  });

  it("summarizes crowded room cards without rendering every occupant inline", () => {
    const html = renderToString(
      <OpenWhisperRoomsView
        phaseKey="round-1-mingle"
        players={crowdedPlayers}
        phaseEntries={[
          entry({
            text: "Turn 2: Room 6: Atlas, Vera, Finn, Echo, Kael, Jace, Iris, Nyx, Lyra, Sage | Room 7: Empty",
            roomMetadata: {
              rooms: [
                { roomId: 6, round: 1, beat: 2, playerIds: crowdedPlayers.map((player) => player.id) },
                { roomId: 7, round: 1, beat: 2, playerIds: [] },
              ],
              excluded: [],
            },
          }),
        ]}
      />,
    );

    expect(html).toContain("+<!-- -->7");
    expect(html).toContain("Atlas, Vera, Finn<!-- --> + <!-- -->7<!-- --> more");
    expect(html).toContain(">10<");
    expect(html).toContain("overflow-hidden rounded-xl");
  });

  it("uses Mingle copy for the empty pre-load overview", () => {
    const stage = buildWhisperStageData([], players);
    const html = renderToString(
      <WhisperAllocationOverview stage={stage} players={players} mode="mingle" />,
    );

    expect(html).toContain("MINGLE MAP");
    expect(html).toContain("The House assigns agents to Mingle rooms");
    expect(html).toContain("Waiting for the House to finish assigning Mingle rooms");
    expect(html).not.toContain("data-controls");
    expect(html).not.toContain("Whisper Room Assignments");
    expect(html).not.toContain("secretly chose another player to whisper with");
  });

  it("keeps historical pair-room replay copy out of Mingle mode", () => {
    const stage = buildWhisperStageData([
      entry({ text: "Room 1: Atlas & Vera | Commons: Finn" }),
    ], players);
    const html = renderToString(
      <WhisperAllocationOverview stage={stage} players={players} />,
    );

    expect(html).toContain("Whisper Room Assignments");
    expect(html).toContain("Mutual picks share a private room");
    expect(html).not.toContain("MINGLE MAP");
  });
});
