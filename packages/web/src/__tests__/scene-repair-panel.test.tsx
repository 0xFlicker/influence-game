import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { SceneRepairPanel, type MediaRecords } from "../app/admin/games/[id]/visual/scene-repair-panel";
import { useVisualWatch } from "../app/games/[slug]/components/use-visual-watch";
import { setApiBase } from "../lib/api";
const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => { dom = new HappyDOMWindow({ url: "http://localhost" }); for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] }); setApiBase(""); });
afterEach(() => { cleanup(); dom.close(); globalThis.fetch = originalFetch; for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
const empty = (): MediaRecords => ({ jobs: [], versions: [], publications: [], requests: [] });
const props = (media = empty()) => ({ gameId: "game", sceneId: "scene", originalFailed: true, media, canOperate: true, refresh: async () => {}, refreshError: null, onOpen: () => {}, attempts: [] });
const respond = (handler: (input: string, init?: RequestInit) => Promise<Response>) => { globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch; };
const job = (status: string): MediaRecords["jobs"][number] => ({ id: "job", sceneId: "scene", version: 1, status, step: "harmonize", failure: null, candidateArtifactId: null, sourceImageId: null, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null });

test("one click queues one durable request, shows inline receipt and recovered progress", async () => {
  const requests: unknown[] = []; let finish: ((value: Response) => void) | undefined;
  respond(async (_, init) => { requests.push(JSON.parse(String(init?.body))); return new Promise(resolve => { finish = resolve; }); });
  const mounted = render(<SceneRepairPanel {...props()} />);
  fireEvent.click(mounted.getByText("Regenerate scene")); fireEvent.click(mounted.getByText("Regenerate scene"));
  expect(requests).toHaveLength(1);
  await act(async () => finish!(Response.json({ accepted: true, code: "queued", message: "Version 1 queued", jobId: "job" })));
  expect(mounted.getByRole("status").textContent).toContain("Version 1 queued");
  mounted.rerender(<SceneRepairPanel {...props({ ...empty(), jobs: [job("verifying")] })} />);
  expect((mounted.getByText("Regenerate scene") as HTMLButtonElement).disabled).toBe(true);
  expect(mounted.getByText(/verifying · v1/)).not.toBeNull();
  cleanup();
  const reopened = render(<SceneRepairPanel {...props({ ...empty(), jobs: [job("needs_reconciliation")] })} />);
  expect(reopened.getByText(/Review provider receipts/)).not.toBeNull();
  expect(reopened.getByText("Continue failed repair")).not.toBeNull();
});

test("rejections are beside the scene and lost responses reuse the same request ID", async () => {
  let first = true; const ids: string[] = [];
  respond(async (_, init) => { ids.push(JSON.parse(String(init?.body)).requestId); if (first) { first = false; throw new Error("disconnected"); } return Response.json({ accepted: false, error: "Reconcile the uncertain attempt", code: "needs_reconciliation" }, { status: 409 }); });
  const mounted = render(<SceneRepairPanel {...props()} />);
  fireEvent.click(mounted.getByText("Regenerate scene"));
  await waitFor(() => expect(mounted.getByText("Check request")).not.toBeNull());
  fireEvent.click(mounted.getByText("Check request"));
  await waitFor(() => expect(mounted.getByRole("alert").textContent).toContain("Reconcile the uncertain attempt"));
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
});

test("compares annotations, publishes explicitly, restores versions and preserves review on refresh error", async () => {
  const writes: Record<string, unknown>[] = [];
  respond(async (_, init) => { if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return Response.json({ accepted: true, code: "published", message: "Published for viewers" }); } return Response.json({ imageUrl: "data:image/png;base64,AAAA" }); });
  const version = (n: number) => ({ id: `v${n}`, sceneId: "scene", version: n, imageArtifactId: `image${n}`, annotatedArtifactId: `annotations${n}`, verificationVersion: "test", localization: { count: 2, anchors: [] } });
  let media: MediaRecords = { ...empty(), jobs: [job("ready")], versions: [version(1), version(0)] };
  const mounted = render(<SceneRepairPanel {...props(media)} />);
  fireEvent.click(mounted.getByText("Versions and review"));
  await waitFor(() => expect(mounted.getByAltText("Published v0")).not.toBeNull());
  expect(mounted.getByAltText("Candidate v1")).not.toBeNull(); expect(writes).toHaveLength(0);
  fireEvent.click(mounted.getByLabelText("Numbered annotations")); await waitFor(() => expect(mounted.getByAltText("Candidate v1 annotations")).not.toBeNull());
  fireEvent.click(mounted.getByText("Publish for viewers")); await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ action: "publish", versionId: "v1", expectedPublication: 0, expectedVersion: 1 });
  media = { ...media, publications: [{ id: "pub", sceneId: "scene", versionId: "v1", revision: 1, operatorId: "admin", createdAt: new Date().toISOString() }] };
  mounted.rerender(<SceneRepairPanel {...props(media)} refreshError="Offline" />);
  expect(mounted.getByText(/Progress refresh failed/)).not.toBeNull(); expect(mounted.getByLabelText("Candidate version")).not.toBeNull();
  fireEvent.change(mounted.getByLabelText("Candidate version"), { target: { value: "v0" } });
  await waitFor(() => expect((mounted.getByText("Restore for viewers") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(mounted.getByText("Restore for viewers")); await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toMatchObject({ action: "publish", versionId: "v0", expectedPublication: 1 });
});

function Watch({ beat, live = false }: { beat: string; live?: boolean }) {
  const data = useVisualWatch("game", true, live, beat);
  return <p>{data?.scenes[0]?.imageUrl ?? "Portraits"}</p>;
}
test.each([false, true])("published media refreshes silently between beats (live=%s), retaining media through failures", async live => {
  const originalTimeout = globalThis.setTimeout;
  let poll: (() => Promise<void>) | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];
  globalThis.setTimeout = ((callback: () => Promise<void>, delay?: number) => {
    if (delay === (live ? 2_000 : 5_000)) {
      poll = callback;
      const timer = originalTimeout(() => {}, 60_000);
      timers.push(timer);
      return timer;
    }
    return originalTimeout(callback, delay);
  }) as typeof setTimeout;
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  let version = 1, failure = false;
  const urls: string[] = [];
  respond(async url => {
    urls.push(url);
    if (failure) throw new Error("offline");
    return Response.json({ enabled: true, scenes: [{ id: "scene", imageUrl: `/v${version}.png` }], portraits: {}, publicationSnapshot: { scene: version } });
  });
  try {
    const mounted = render(<Watch beat="opening" live={live} />);
    await waitFor(() => expect(poll).toBeDefined());
    mounted.rerender(<Watch beat="speech-1" live={live} />);
    expect(mounted.getByText("/v1.png")).not.toBeNull();
    version = 2;
    await act(async () => { await poll!(); });
    expect(mounted.getByText("/v1.png")).not.toBeNull(); // Paused or speaking: keep the same beat.
    mounted.rerender(<Watch beat="speech-2" live={live} />);
    expect(mounted.getByText("/v2.png")).not.toBeNull();
    failure = true;
    await act(async () => { await poll!(); });
    mounted.rerender(<Watch beat="speech-3" live={live} />);
    expect(mounted.getByText("/v2.png")).not.toBeNull();
    expect(mounted.queryByRole("button")).toBeNull();
    expect(warning).toHaveBeenCalledTimes(1);
    failure = false; version = 3;
    await act(async () => { await poll!(); });
    expect(mounted.getByText("/v2.png")).not.toBeNull();
    mounted.rerender(<Watch beat="speech-4" live={live} />);
    expect(mounted.getByText("/v3.png")).not.toBeNull();
    expect(urls).toHaveLength(4);
    expect(urls.every(url => !url.includes("snapshot="))).toBe(true);
    cleanup();
    const requestsBeforeUnmount = urls.length;
    await act(async () => { await poll!(); });
    // A callback already dequeued at unmount cannot schedule another refresh or apply media.
    expect(urls.length).toBe(requestsBeforeUnmount);
  } finally { for (const timer of timers) clearTimeout(timer); globalThis.setTimeout = originalTimeout; warning.mockRestore(); }
});
