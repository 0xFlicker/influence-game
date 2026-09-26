import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { ReplayVisualProductionPanel } from "../app/admin/replay-visual-production-panel";
import { setApiBase } from "../lib/api";
import type { MediaRecords, MediaAttempt } from "../app/admin/games/[id]/visual/scene-repair-panel";

const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase("");
});
afterEach(() => {
  cleanup(); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
const media = (): MediaRecords => ({ jobs: [], versions: [], requests: [], publications: [] });
const scene = (key: string) => ({ key, previewHash: `preview-${key}`, sceneId: null as string | null, roomName: "Lobby", round: 1, boundarySequence: 1,
  participants: [{ id: "p1", name: "Arden" }], available: false, originalFailed: false });
const inventory = () => ({ gameId: "game", slug: "game", scenes: [scene("first"), scene("second")], media: media(), warnings: [], attempts: [] as Array<MediaAttempt & { provider: string; model: string }> });
const job = (status: string): MediaRecords["jobs"][number] => ({ id: "job", sceneId: "saved", version: 1, status, step: "render section", failure: null,
  candidateArtifactId: null, sourceImageId: null, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null });
function respond(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch;
}
async function loaded(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getAllByText("Render missing image")).toHaveLength(2));
}

test("opening game controls only reads scenes; explicit scene selection queues one request and disables other renders", async () => {
  let data = inventory(), finish: ((response: Response) => void) | undefined;
  const writes: Record<string, unknown>[] = [];
  const locks: boolean[] = [], paths: string[] = [];
  respond(async (url, init) => {
    paths.push(url);
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return new Promise(resolve => { finish = resolve; }); }
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={value => locks.push(value)} />);
  await loaded(view);
  expect(writes).toHaveLength(0); expect(paths).toEqual(["/api/admin/production/games/game/visual"]);
  expect(view.queryByRole("combobox")).toBeNull();
  fireEvent.click(view.getAllByText("Render missing image")[0]!); fireEvent.click(view.getAllByText("Render missing image")[0]!);
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ key: "first", previewHash: "preview-first", requestId: expect.any(String) });
  expect(locks).toEqual([true]);
  data = { ...data, scenes: [{ ...data.scenes[0]!, sceneId: "saved" }, data.scenes[1]!], media: { ...media(), jobs: [job("queued")] } };
  await act(async () => finish!(Response.json({ accepted: true, message: "Image queued" })));
  await waitFor(() => expect(view.getByText(/One image is queued/)).not.toBeNull());
  expect(locks).toEqual([true, false]);
  expect(view.getAllByText("Render missing image").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
});

test("lost responses lock selection and retry the same request without hiding a confirmed rejection", async () => {
  const ids: string[] = [];
  const locks: boolean[] = [];
  respond(async (url, init) => {
    if (init?.method === "POST") {
      ids.push(JSON.parse(String(init.body)).requestId);
      if (ids.length === 1) throw new Error("Connection dropped");
      return Response.json({ error: "Scene evidence changed", code: "stale_preview" }, { status: 409 });
    }
    return Response.json(inventory());
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={value => locks.push(value)} />); await loaded(view);
  fireEvent.click(view.getAllByText("Render missing image")[0]!);
  await waitFor(() => expect(view.getByText("Check render request")).not.toBeNull());
  expect(locks.at(-1)).toBe(true);
  expect(view.getAllByText("Render missing image").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(view.getByText("Check render request"));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Scene evidence changed"));
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  expect(locks.at(-1)).toBe(false);
});

test("saved candidates use Production evidence and publish only by explicit review", async () => {
  const data = inventory(), paths: string[] = [], writes: Record<string, unknown>[] = [];
  data.scenes[0]!.sceneId = "saved";
  data.media = { ...media(), jobs: [job("ready")], versions: [{ id: "job", sceneId: "saved", version: 1, imageArtifactId: "image", annotatedArtifactId: "annotations",
    verificationVersion: "verified", localization: { count: 1, verifiedParticipantIds: ["p1"], anchors: [] } }] };
  respond(async (url, init) => {
    paths.push(url);
    if (url.includes("evidence/artifact")) return Response.json({ imageUrl: "data:image/png;base64,AAAA" });
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return Response.json({ accepted: true, message: "Published for viewers" }); }
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}} />); await loaded(view);
  fireEvent.click(view.getByText("Versions and review"));
  await waitFor(() => expect(view.getByAltText("Candidate v1")).not.toBeNull());
  expect(paths).toContain("/api/admin/production/games/game/visual/evidence/artifact/image");
  expect(writes).toHaveLength(0);
  fireEvent.click(view.getByText("Publish for viewers"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(paths).toContain("/api/admin/production/games/game/visual/media");
  expect(writes[0]).toMatchObject({ action: "publish", sceneId: "saved", versionId: "job", expectedVersion: 1, expectedPublication: 0 });
});

test("receipt review distinguishes active requests, HTTP failures, and interrupted dispatches", async () => {
  const data = inventory(); data.scenes[0]!.sceneId = "saved";
  data.media.jobs = [job("rendering")];
  data.attempts = [{ id: "attempt", operationKey: "media:job:section:0", provider: "openai", model: "gpt-image-2", status: "pending", costMicrousd: null, receipt: null, reconciliation: null }];
  respond(async () => Response.json(data));
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}} />); await loaded(view);
  expect(view.queryByText(/Needs reconciliation:/)).toBeNull();
  expect(view.queryByText("Record reconciliation")).toBeNull();
  expect(view.getByText(/Request in progress; waiting/)).not.toBeNull();
  data.attempts[0] = { ...data.attempts[0]!, status: "finished", receipt: { status: 429, chargeUncertain: false, failure: { kind: "http", message: "Rate limit" } } };
  fireEvent.click(view.getByText("Refresh scenes"));
  await waitFor(() => expect(view.getByText("http: Rate limit")).not.toBeNull());
  expect(view.getByText("HTTP 429 · finished")).not.toBeNull();
  expect(view.queryByText("Record reconciliation")).toBeNull();
  data.media.jobs = [job("needs_reconciliation")];
  data.attempts[0] = { ...data.attempts[0]!, status: "needs_reconciliation", receipt: null };
  fireEvent.click(view.getByText("Refresh scenes"));
  await waitFor(() => expect(view.getByText("Record reconciliation")).not.toBeNull());
  expect(view.getByText(/Needs reconciliation: 1/)).not.toBeNull();
});
