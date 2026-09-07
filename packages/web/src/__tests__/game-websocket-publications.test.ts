import { describe, expect, test } from "bun:test";
import type { GameWatchState, WsPublicationEvent } from "@/lib/api";
import { GamePublicationBuffer, GamePublicationCatchUp } from "@/app/games/[slug]/components/use-game-websocket";

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
      entry.payload.type === "message" ? entry.payload.entry.text : entry.payload.type
    )).toEqual(["one", "two"]);

    expect(buffer.accept(publication(2, "duplicate two"))).toEqual([]);
    expect(buffer.accept(publication(3, "three")).map((entry) =>
      entry.payload.type === "message" ? entry.payload.entry.text : entry.payload.type
    )).toEqual(["three"]);
    expect(buffer.cursor).toBe(3);
  });

  test("starts after the caller's reconnect cursor", () => {
    const buffer = new GamePublicationBuffer("game-a", 4);

    expect(buffer.accept(publication(4, "old"))).toEqual([]);
    expect(buffer.accept(publication(6, "six"))).toEqual([]);
    expect(buffer.accept(publication(5, "five")).map((entry) =>
      entry.payload.type === "message" ? entry.payload.entry.text : entry.payload.type
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


describe("GamePublicationCatchUp", () => {
  const snapshot = (throughPublicationSequence: number) => ({
    type: "watch_state" as const,
    // This transport test forwards the opaque snapshot without interpreting it.
    state: { gameId: "game-a" } as GameWatchState,
    throughPublicationSequence,
  });

  test("waits for the snapshot and classifies history separately from concurrent live delivery", () => {
    const catchUp = new GamePublicationCatchUp(new GamePublicationBuffer("game-a"));
    expect(catchUp.accept(publication(1, "introduction"))).toEqual([]);
    expect(catchUp.accept(publication(2, "new action"))).toEqual([]);
    const batch = catchUp.accept(snapshot(1));
    expect(batch.map((event) => event.type)).toEqual(["watch_state", "message", "message"]);
    expect(batch[1]).toMatchObject({ publicationSequence: 1, liveCatchUp: true });
    expect(batch[2]).toMatchObject({ publicationSequence: 2, liveCatchUp: false });
    expect(catchUp.ready).toBe(true);
  });

  test("snapshot arriving before the missing suffix does not open playback prematurely", () => {
    const catchUp = new GamePublicationCatchUp(new GamePublicationBuffer("game-a"));
    expect(catchUp.accept(snapshot(2))).toEqual([]);
    expect(catchUp.accept(publication(2, "second"))).toEqual([]);
    expect(catchUp.ready).toBe(false);
    expect(catchUp.accept(publication(1, "first"))).toHaveLength(3);
    expect(catchUp.ready).toBe(true);
  });

  test("retains undelivered history across a disconnect before the snapshot", () => {
    const buffer = new GamePublicationBuffer("game-a");
    const catchUp = new GamePublicationCatchUp(buffer);
    catchUp.accept(publication(1, "first"));
    catchUp.begin();
    catchUp.accept(publication(2, "second"));
    const batch = catchUp.accept(snapshot(2));
    expect(batch.filter((event) => event.type === "message").map((event) => event.publicationSequence)).toEqual([1, 2]);
    expect(buffer.cursor).toBe(2);
  });
});
