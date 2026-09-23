import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import type { GameStatus, WsViewerEvent } from "@/lib/api";
import { setWsBase, useGameWebSocket } from "@/app/games/[slug]/components/use-game-websocket";

const globals = ["window", "document", "navigator", "Element", "HTMLElement", "Node", "Event", "localStorage", "WebSocket"] as const;
const original = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
let sockets: FakeSocket[];
class FakeSocket {
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  closed = false;
  constructor(readonly url: string) { sockets.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
beforeEach(() => {
  dom = new HappyDOMWindow();
  sockets = [];
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true,
    value: key === "window" ? dom : key === "WebSocket" ? FakeSocket : dom[key] });
  setWsBase("ws://example.test");
});
afterEach(() => {
  cleanup();
  dom.close();
  setWsBase(process.env.NEXT_PUBLIC_WS_URL ?? "");
  for (const key of globals) {
    const descriptor = original.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("joining a suspended game hydrates dialogue and keeps the same observer connection through resume", () => {
  const received: WsViewerEvent[] = [];
  const view = renderHook(({ status }: { status: GameStatus }) => useGameWebSocket("paused-game", "game-a", status, (event) => received.push(event)),
    { initialProps: { status: "suspended" as GameStatus } });
  expect(sockets).toHaveLength(1);
  expect(new URL(sockets[0]!.url).searchParams.get("afterPublicationSequence")).toBe("0");
  act(() => {
    sockets[0]!.receive({ type: "publication", gameId: "game-a", publicationSequence: 1, turnSequence: 2,
      payload: { type: "message", entry: { entrySequence: 10, round: 1, phase: "LOBBY", from: "player-a", scope: "public", text: "Saved dialogue", timestamp: 1,
        visualScene: { id: "saved-scene", roomId: "lobby" } } } });
    sockets[0]!.receive({ type: "watch_state", state: { gameId: "game-a", status: "suspended" }, throughPublicationSequence: 1 });
  });
  expect(received[1]).toMatchObject({ type: "message", liveCatchUp: true, entry: { text: "Saved dialogue", visualScene: { id: "saved-scene", roomId: "lobby" } } });
  view.rerender({ status: "in_progress" });
  view.rerender({ status: "suspended" });
  expect(sockets).toHaveLength(1);
  expect(sockets[0]!.closed).toBe(false);
  view.rerender({ status: "completed" });
  expect(sockets[0]!.closed).toBe(true);
});

test.each(["waiting", "completed", "cancelled"] as const)("%s uses no live observer connection", (status) => {
  renderHook(() => useGameWebSocket("game-a", "game-a", status, () => {}));
  expect(sockets).toHaveLength(0);
});
