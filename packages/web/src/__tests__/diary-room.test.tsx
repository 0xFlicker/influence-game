import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import type { GamePlayer, TranscriptEntry } from "../lib/api";
import type { DiaryRoomData } from "../app/games/[slug]/components/types";
import { DiaryRoomChat } from "../app/games/[slug]/components/diary-room";

const dramaticReplaySource = readFileSync(
  join(import.meta.dir, "../app/games/[slug]/components/dramatic-replay-viewer.tsx"),
  "utf8",
);

const player: GamePlayer = {
  id: "p1",
  name: "Mira",
  persona: "strategic",
  status: "alive",
  shielded: false,
};

function entry(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: 1,
    gameId: "game-1",
    round: 1,
    phase: "DIARY_ROOM",
    fromPlayerId: null,
    fromPlayerName: null,
    scope: "diary",
    toPlayerIds: null,
    text: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("DiaryRoomChat", () => {
  it("keeps long diary content inside a bounded scrollable body", () => {
    const room: DiaryRoomData = {
      playerName: "Mira",
      player,
      entries: [
        {
          question: entry({
            text: "Mira, what did you notice before the House changed the room?",
          }),
          answer: entry({
            id: 2,
            fromPlayerId: "p1",
            fromPlayerName: "Mira",
            text: "I noticed the first signal immediately, and I need the leading question to remain visible even when this answer runs long.",
          }),
        },
      ],
    };

    const html = renderToString(<DiaryRoomChat room={room} />);

    expect(html).toContain("flex flex-1 min-h-0 flex-col overflow-hidden");
    expect(html).toContain("flex-shrink-0");
    expect(html).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  it("bounds stacked diary cards in the dramatic replay viewport", () => {
    expect(dramaticReplaySource).toContain("flex max-h-full min-h-0 flex-shrink-0 flex-col opacity-60");
    expect(dramaticReplaySource).toContain("flex max-h-full min-h-0 flex-shrink-0 flex-col");
  });
});
