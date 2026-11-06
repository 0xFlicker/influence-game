import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { usePagedGames } from "../hooks/use-paged-games";

const names = ["window", "document", "navigator", "localStorage"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalFetch = globalThis.fetch;
let dom: HappyDOMWindow;

function setup() {
  dom = new HappyDOMWindow({ url: "http://localhost/games" });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] });
}
afterEach(async () => {
  await act(async () => { cleanup(); });
  dom?.close(); globalThis.fetch = originalFetch;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

function Harness({ query }: { query: string }) {
  const library = usePagedGames(query);
  return <div>
    {library.loading && <p>Loading</p>}
    {library.items.map(item => <p key={item.game.id}>Game {item.game.id}</p>)}
    {!library.loading && !library.error && library.items.length === 0 && !library.nextCursor && <p>No results</p>}
    {library.error && <div role="alert">{library.error}<button onClick={() => void library.retry()}>Retry</button></div>}
    {library.nextCursor && <button disabled={library.loading} onClick={() => void library.loadMore()}>Load more games</button>}
    <button onClick={() => void library.refresh()}>Refresh</button>
  </div>;
}

test("a management refresh aborts an in-flight page and ignores its stale response", async () => {
  setup(); let calls = 0, resolveOld!: (value: Response) => void, oldSignal: AbortSignal | null | undefined;
  globalThis.fetch = Object.assign((_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    if (calls === 2) { oldSignal = init?.signal; return new Promise<Response>(resolve => { resolveOld = resolve; }); }
    return Promise.resolve(Response.json({ items: [{ kind: "influence", game: { id: calls === 1 ? "before" : "after" } }], nextCursor: calls === 1 ? "next" : null }));
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<Harness query="kind=all" />);
  await view.findByText("Game before");
  fireEvent.click(view.getByRole("button", { name: "Load more games" }));
  await waitFor(() => expect(oldSignal).toBeDefined());
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  await view.findByText("Game after"); expect(oldSignal?.aborted).toBe(true);
  await act(async () => { resolveOld(Response.json({ items: [{ kind: "werewolf", game: { id: "stale" } }], nextCursor: null })); });
  expect(view.queryByText("Game before")).toBeNull(); expect(view.queryByText("Game stale")).toBeNull();
  expect(calls).toBe(3);
});

test("an empty batch offers explicit continuation and never auto-fetches", async () => {
  setup(); let calls = 0;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.credentials).toBe("omit"); calls++;
    return Promise.resolve(Response.json(calls === 1 ? { items: [], nextCursor: "cursor1" } : { items: [{ kind: "werewolf", game: { id: "wolf" } }], nextCursor: null }));
  }) as typeof fetch;
  const view = render(<Harness query="kind=werewolf" />);
  await view.findByRole("button", { name: "Load more games" });
  expect(view.queryByText("No results")).toBeNull(); expect(calls).toBe(1);
  fireEvent.click(view.getByRole("button", { name: "Load more games" }));
  await view.findByText("Game wolf");
  expect(calls).toBe(2); expect(view.queryByRole("button", { name: "Load more games" })).toBeNull();
});

test("changing filters aborts the old request and ignores its late response", async () => {
  setup(); let oldSignal: AbortSignal | null | undefined, resolveOld!: (value: Response) => void;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("status=waiting")) {
      oldSignal = init?.signal;
      return new Promise<Response>(resolve => { resolveOld = resolve; });
    }
    return Promise.resolve(Response.json({ items: [{ kind: "influence", game: { id: "new" } }], nextCursor: null }));
  }) as typeof fetch;
  const view = render(<Harness query="status=waiting" />);
  await waitFor(() => expect(oldSignal).toBeDefined());
  view.rerender(<Harness query="status=completed" />);
  await view.findByText("Game new");
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { resolveOld(Response.json({ items: [{ kind: "influence", game: { id: "old" } }], nextCursor: null })); });
  expect(view.queryByText("Game old")).toBeNull(); expect(view.getByText("Game new")).toBeTruthy();
});

test("changing filters immediately hides already loaded results", async () => {
  setup();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => String(input).includes("status=waiting")
    ? Promise.resolve(Response.json({ items: [{ kind: "influence", game: { id: "old" } }], nextCursor: "next" }))
    : new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }))) as typeof fetch;
  const view = render(<Harness query="status=waiting" />);
  await view.findByText("Game old");
  view.rerender(<Harness query="status=completed" />);
  expect(view.queryByText("Game old")).toBeNull();
  expect(view.queryByRole("button", { name: "Load more games" })).toBeNull();
  expect(view.getByText("Loading")).toBeTruthy();
});

test("a failed later page keeps prior results and retries only on request", async () => {
  setup(); let calls = 0;
  globalThis.fetch = Object.assign(() => {
    calls++;
    if (calls === 2) return Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 }));
    return Promise.resolve(Response.json(calls === 1 ? { items: [{ kind: "influence", game: { id: "first" } }], nextCursor: "next" }
      : { items: [{ kind: "influence", game: { id: "first" } }, { kind: "werewolf", game: { id: "second" } }], nextCursor: null }));
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<Harness query="kind=all" />);
  await view.findByText("Game first");
  fireEvent.click(view.getByRole("button", { name: "Load more games" }));
  await view.findByRole("alert");
  expect(view.getByText("Game first")).toBeTruthy(); expect(calls).toBe(2);
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await view.findByText("Game second");
  expect(view.getAllByText("Game first")).toHaveLength(1); expect(calls).toBe(3);
});

test("a nonadvancing cursor is surfaced instead of repeatedly fetching it", async () => {
  setup(); let calls = 0;
  globalThis.fetch = Object.assign(() => { calls++; return Promise.resolve(Response.json({ items: [], nextCursor: "same" })); }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = render(<Harness query="kind=all" />);
  await view.findByRole("button", { name: "Load more games" });
  fireEvent.click(view.getByRole("button", { name: "Load more games" }));
  expect((await view.findByRole("alert")).textContent).toContain("Invalid library response");
  expect(calls).toBe(2);
});
