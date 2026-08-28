import { describe, expect, test } from "bun:test";
import type { WsPublicationEvent } from "@/lib/api";
import { GamePublicationBuffer } from "@/app/games/[slug]/components/use-game-websocket";

function publication(
  publicationSequence: number,
  message: string,
  gameId = "game-a",
): WsPublicationEvent {
  return {
    type: "publication",
    gameId,
    publicationSequence,
    turnSequence: publicationSequence,
    payload: {
      type: "message",
      entry: {
        entrySequence: publicationSequence,
        round: 1,
        phase: "LOBBY",
        from: "player-a",
        scope: "public",
        text: message,
        timestamp: publicationSequence,
      },
    },
  };
}

describe("GamePublicationBuffer", () => {
  test("releases catch-up and live overlap exactly once in contiguous order", () => {
    const buffer = new GamePublicationBuffer("game-a");

    expect(buffer.accept(publication(2, "two"))).toEqual([]);
    expect(buffer.accept(publication(1, "one")).map((entry) =>
      entry.type === "message" ? entry.entry.text : entry.type
    )).toEqual(["one", "two"]);

    expect(buffer.accept(publication(2, "duplicate two"))).toEqual([]);
    expect(buffer.accept(publication(3, "three")).map((entry) =>
      entry.type === "message" ? entry.entry.text : entry.type
    )).toEqual(["three"]);
    expect(buffer.cursor).toBe(3);
  });

  test("starts after the caller's reconnect cursor", () => {
    const buffer = new GamePublicationBuffer("game-a", 4);

    expect(buffer.accept(publication(4, "old"))).toEqual([]);
    expect(buffer.accept(publication(6, "six"))).toEqual([]);
    expect(buffer.accept(publication(5, "five")).map((entry) =>
      entry.type === "message" ? entry.entry.text : entry.type
    )).toEqual(["five", "six"]);
    expect(buffer.cursor).toBe(6);
  });

  test("rejects cross-game and invalid publication identities", () => {
    const buffer = new GamePublicationBuffer("game-a");

    expect(buffer.accept(publication(1, "wrong", "game-b"))).toEqual([]);
    expect(buffer.accept({ ...publication(1, "invalid"), publicationSequence: 0 })).toEqual([]);
    expect(buffer.cursor).toBe(0);
  });

  test("fails closed on conflicting copies of one pending publication", () => {
    const buffer = new GamePublicationBuffer("game-a");

    expect(buffer.accept(publication(2, "first"))).toEqual([]);
    expect(() => buffer.accept(publication(2, "conflict"))).toThrow(
      "Conflicting publication game-a:2",
    );
    expect(buffer.cursor).toBe(0);
  });

  test("rejects an invalid initial reconnect cursor", () => {
    expect(() => new GamePublicationBuffer("game-a", -1)).toThrow(
      "afterPublicationSequence must be a non-negative safe integer",
    );
  });
});
