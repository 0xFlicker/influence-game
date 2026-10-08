import { adminTestWrapper } from "./admin-test-wrapper";
import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { act, cleanup, fireEvent, render as baseRender, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { SceneRepairPanel, type MediaRecords, type MediaAttempt } from "../app/admin/games/[id]/visual/scene-repair-panel";
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
  expect(mounted.getByText(/Version 1 queued/)).not.toBeNull();
  expect((mounted.getByText("Regenerate scene") as HTMLButtonElement).disabled).toBe(true);
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

test("pending provider calls do not show reconciliation; interrupted calls and identity failures stay visible", () => {
  const attempt: MediaAttempt = { id: "attempt", operationKey: "media:job:section:0", status: "pending", costMicrousd: null, receipt: null, reconciliation: null };
  const mounted = render(<SceneRepairPanel {...props({ ...empty(), jobs: [job("rendering")] })} attempts={[attempt]} />);
  expect(mounted.queryByText(/Needs reconciliation:/)).toBeNull();
  mounted.rerender(<SceneRepairPanel {...props({ ...empty(), jobs: [job("needs_reconciliation")] })} attempts={[{ ...attempt, status: "needs_reconciliation" }]} />);
  expect(mounted.getByText(/Needs reconciliation: 1/)).not.toBeNull();
  mounted.rerender(<SceneRepairPanel {...props({ ...empty(), jobs: [{ ...job("failed"), failure: "Character identity could not be verified: Vera" }] })}
    attempts={[{ ...attempt, status: "finished", receipt: { status: 200, chargeUncertain: false, failure: { kind: "identity", message: "Character identity could not be verified: Vera" } } }]} />);
  expect(mounted.queryByText(/Needs reconciliation:/)).toBeNull();
  expect(mounted.getByText("Character identity could not be verified: Vera")).not.toBeNull();
  expect(mounted.getByText(/The image was generated, but character identities/)).not.toBeNull();
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

function render(ui: React.ReactNode) { return baseRender(ui, { wrapper: adminTestWrapper() }); }


test("reviews every retained panel alongside the harmonized scene in clean and numbered modes", async () => {
  respond(async url => Response.json({imageUrl: `/images/${url.split("/").at(-1)}`}));
  const shot = (id: string) => ({imageArtifactId:id, annotatedArtifactId:`${id}-numbered`, participantIds:[], visibleParticipantIds:[], anchors:[], pointers:[]});
  const version: MediaRecords["versions"][number] = {id:"v1",sceneId:"scene",version:1,imageArtifactId:"combined",annotatedArtifactId:"combined-numbered",verificationVersion:"test",localization:{count:0,anchors:[]},
    shots:{mode:"scene",overview:shot("combined"),groups:[shot("left"),shot("middle"),shot("right")]}};
  const mounted = render(<SceneRepairPanel {...props({...empty(),jobs:[job("ready")],versions:[version]})} />);
  fireEvent.click(mounted.getByText("Versions and review"));
  for (const [name,id] of [["Harmonized scene","combined"],["Panel 1","left"],["Panel 2","middle"],["Panel 3","right"]]) {
    await waitFor(() => expect(mounted.getByAltText(`Candidate v1 · ${name}`).getAttribute("src")).toBe(`/images/${id}`));
  }
  fireEvent.click(mounted.getByLabelText("Numbered annotations"));
  await waitFor(() => expect(mounted.getByAltText("Candidate v1 · Panel 3 annotations").getAttribute("src")).toBe("/images/right-numbered"));
});

test("harmonization binds the selected panels and deduplicates clicks without publishing", async () => {
  const writes: Record<string, unknown>[] = [];
  let finish: ((value: Response) => void) | undefined;
  respond(async (_, init) => {
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return new Promise(resolve => { finish = resolve; }); }
    return Response.json({ imageUrl: "data:image/png;base64,AAAA" });
  });
  const shot = (id: string) => ({ imageArtifactId: id, annotatedArtifactId: id, participantIds: [], visibleParticipantIds: [], anchors: [], pointers: [] });
  const version = (n: number): MediaRecords["versions"][number] => ({ id: `v${n}`, sceneId: "scene", version: n, imageArtifactId: `left${n}`, annotatedArtifactId: `left${n}`, verificationVersion: "test", localization: { count: 0, anchors: [] },
    shots: { mode: "groups", overview: null, groups: [shot(`left${n}`), shot(`right${n}`)] } });
  const media = { ...empty(), jobs: [job("ready")], versions: [version(1), version(0)] };
  const mounted = render(<SceneRepairPanel {...props(media)} apiPrefix="/api/admin/production/games" />);
  fireEvent.click(mounted.getByText("Versions and review"));
  fireEvent.change(mounted.getByLabelText("Candidate version"), { target: { value: "v0" } });
  expect(writes).toEqual([]);
  fireEvent.click(mounted.getByText("Harmonize existing panels")); fireEvent.click(mounted.getByText("Harmonize existing panels"));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "harmonize", sourceVersionId: "v0", expectedVersion: 1 });
  await act(async () => finish!(Response.json({ accepted: true, code: "queued", message: "Saved panels queued for harmonization", jobId: "new-job" })));
  expect(mounted.getByText("Saved panels queued for harmonization")).not.toBeNull();
  await act(async () => mounted.rerender(<SceneRepairPanel {...props({ ...media, jobs: [job("rendering")] })} />));
  expect((mounted.getByText("Harmonize existing panels") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => mounted.rerender(<SceneRepairPanel {...props(media)} canOperate={false} />));
  expect(mounted.queryByText("Harmonize existing panels")).toBeNull();
  for (const shots of [{ mode: "portraits" as const, overview: null, groups: [shot("a"), shot("b")] }, { mode: "groups" as const, overview: null, groups: [shot("a")] }]) {
    await act(async () => mounted.rerender(<SceneRepairPanel {...props({ ...media, versions: [{ ...version(0), shots }] })} />));
    expect(mounted.queryByText("Harmonize existing panels")).toBeNull();
  }
  expect(writes).toHaveLength(1);
});

test("regeneration acknowledges uncertain costs only after explicit confirmation; cancellation sends nothing", async () => {
  const writes: Record<string, unknown>[] = [];
  respond(async (_, init) => { writes.push(JSON.parse(String(init?.body))); return Response.json({ accepted: true, code: "queued", message: "Queued", jobId: "new-job" }); });
  const attempt: MediaAttempt = { id: "old-attempt", sceneId: "scene", operationKey: "original-composition", status: "needs_reconciliation", costMicrousd: null, receipt: null, reconciliation: null };
  const mounted = render(<SceneRepairPanel {...props({...empty(),jobs:[job("ready")]})} attempts={[attempt]} />);
  fireEvent.click(mounted.getByRole("button", { name: "Regenerate scene" }));
  expect(mounted.getByRole("dialog", { name: "Regenerate this scene?" }).textContent).toContain("may already have been charged");
  expect(writes).toHaveLength(0);
  fireEvent.click(mounted.getByRole("button", { name: "Cancel" }));
  expect(writes).toHaveLength(0);
  fireEvent.click(mounted.getByRole("button", { name: "Regenerate scene" }));
  const dialog = mounted.getByRole("dialog");
  fireEvent.click(dialog.querySelectorAll("button")[1]!);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({action:"regenerate",sceneId:"scene",expectedVersion:1,acknowledgeUncertainAttempts:["old-attempt"]});
  expect(writes.some(write => write.action === "publish" || write.action === "review")).toBe(false);
});

test("a failed queued render releases controls even when its promised version was never produced", async () => {
  respond(async () => Response.json({ accepted: true, code: "queued", message: "Queued", jobId: "job", versionId: "job", version: 1 }));
  const mounted = render(<SceneRepairPanel {...props()} />);
  fireEvent.click(mounted.getByText("Regenerate scene"));
  await waitFor(() => expect(mounted.getByText(/Request accepted/)).not.toBeNull());
  mounted.rerender(<SceneRepairPanel {...props({...empty(),jobs:[job("needs_reconciliation")]})} />);
  expect(mounted.queryByText(/Request accepted/)).toBeNull();
  expect((mounted.getByText("Correct images") as HTMLButtonElement).disabled).toBe(false);
  expect((mounted.getByText("Regenerate scene") as HTMLButtonElement).disabled).toBe(false);
});
