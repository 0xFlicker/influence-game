import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { useEffect } from "react";
import { adminTestWrapper } from "./admin-test-wrapper";
import { EpisodeEditor } from "../app/admin/episode-editor";
import { AdminPostgameMediaPanel } from "../app/admin/admin-postgame-media";
import { AdminSession, useAdminSession, type Operation } from "../app/admin/admin-session";
import { setApiBase, type EpisodePreview, type AdminPostgameMediaResponse } from "../lib/api";

const originalFetch = globalThis.fetch;
const names = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event", "CustomEvent"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let dom: Window, session: AdminSession;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] });
  setApiBase("");
});
afterEach(async () => {
  await act(async () => { cleanup(); }); dom.close(); globalThis.fetch = originalFetch;
  for (const name of names) { const descriptor = saved.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});
function respond(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch;
}
function Capture({ children }: { children: React.ReactNode }) {
  const value = useAdminSession();
  useEffect(() => { session = value; }, [value]);
  return children;
}
const resource = "/api/admin/games/g/episode", mediaResource = "/api/admin/games/g/postgame/media";
const editor = <Capture><EpisodeEditor gameId="g" onSaved={async () => {}} /></Capture>;
const trailer = <Capture><AdminPostgameMediaPanel game={{ id: "g", slug: "saved-slug" }} canManage /></Capture>;
function episode(revision = 1): EpisodePreview & { failure: null } {
  return { episode: { title: "Saved title", description: "Saved description", episodeNumber: null, cast: [], coverUrl: null,
    status: "ready", locked: false, revision, frameOrder: [] }, frames: [], media: { schemaVersion: 1, mediaType: "house_highlights_trailer", status: "not_requested" }, failure: null };
}
function media(status: "ready" | "queued", renderVersion = 1): AdminPostgameMediaResponse {
  return { schemaVersion: 1, mediaType: "house_highlights_trailer", status, renderVersion, attemptNumber: 1,
    timestamps: { createdAt: "2026-10-09T00:00:00Z", updatedAt: `2026-10-09T00:00:0${renderVersion}Z`, claimedAt: null, attemptStartedAt: null, attemptFinishedAt: null } };
}

test("episode drafts survive navigation and require explicit discard after a saved revision changes", async () => {
  let value = episode();
  respond(async url => Response.json(url === resource ? value : media("ready")));
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Saved title"));
  fireEvent.input(view.getByLabelText("Title"), { target: { value: "Operator draft" } });
  view.rerender(<p>Other page</p>); view.rerender(editor);
  expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Operator draft");
  value = episode(2); fireEvent.click(view.getByText("Refresh saved presentation"));
  await waitFor(() => expect(view.getByText(/This draft belongs to an earlier episode revision/)).not.toBeNull());
  expect((view.getByText("Save presentation") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByText("Discard older draft"));
  expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Saved title");
});

test("an unknown PATCH survives close, blocks retry after failed GET and reconciles without another PATCH", async () => {
  let value = episode(), failRead = false, writes = 0;
  respond(async (url, init) => {
    if (init?.method === "PATCH") {
      writes++; const body = JSON.parse(String(init.body));
      value = { ...value, episode: { ...value.episode, ...body, revision: body.revision + 1 } };
      return new Response("Response lost after save", { status: 503 });
    }
    if (url === resource && failRead) return new Response("Read unavailable", { status: 503 });
    return Response.json(url === resource ? value : media("ready"));
  });
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByLabelText("Title")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Title"), { target: { value: "Frozen edit" } });
  fireEvent.click(view.getByText("Save presentation"));
  await waitFor(() => expect(view.getByText("Check saved presentation")).not.toBeNull());
  view.rerender(<p>Closed dialog</p>); view.rerender(editor);
  expect((view.getByText("Save presentation") as HTMLButtonElement).disabled).toBe(true);
  failRead = true; fireEvent.click(view.getByText("Check saved presentation"));
  await waitFor(() => expect(view.getByText("Read unavailable")).not.toBeNull());
  expect(session.get<Operation>(`operation:${resource}:save`)?.phase).toBe("unknown"); expect(writes).toBe(1);
  failRead = false; fireEvent.click(view.getByText("Check saved presentation"));
  await waitFor(() => expect(view.getByText(/The saved presentation matches this edit/)).not.toBeNull());
  expect(writes).toBe(1); expect(session.get<Operation>(`operation:${resource}:save`)?.phase).toBe("accepted");
  expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Frozen edit");
  expect((view.getByText("Save presentation") as HTMLButtonElement).disabled).toBe(false);
});

test("unknown naming must be checked with GET before an explicit retry", async () => {
  let writes = 0;
  respond(async (url, init) => {
    if (init?.method === "POST") { writes++; return new Response("Naming response lost", { status: 503 }); }
    return Response.json(url === resource ? episode() : media("ready"));
  });
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByText("Regenerate title & description")).not.toBeNull());
  fireEvent.click(view.getByText("Regenerate title & description"));
  await waitFor(() => expect(view.getByText("Check saved naming state")).not.toBeNull());
  expect((view.getByText("Regenerate title & description") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByText("Check saved naming state"));
  await waitFor(() => expect(view.getByText(/No matching change is visible/)).not.toBeNull());
  expect(writes).toBe(1); expect((view.getByText("Regenerate title & description") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(view.getByText("Regenerate title & description")); await waitFor(() => expect(writes).toBe(2));
});

test("a rejected PATCH keeps the operator draft and explains the revision conflict", async () => {
  let value = episode();
  respond(async (url, init) => {
    if (init?.method === "PATCH") { value = episode(2); return Response.json({ error: "Episode changed while editing. Reload before saving." }, { status: 409 }); }
    return Response.json(url === resource ? value : media("ready"));
  });
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByLabelText("Title")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Title"), { target: { value: "Keep this draft" } });
  fireEvent.click(view.getByText("Save presentation"));
  await waitFor(() => expect(view.getByText("Episode changed while editing. Reload before saving.")).not.toBeNull());
  expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Keep this draft");
  expect(session.get<Operation>(`operation:${resource}:save`)?.phase).toBe("rejected");
  fireEvent.click(view.getByText("Refresh saved presentation"));
  await waitFor(() => expect(view.getByText(/This draft belongs to an earlier episode revision/)).not.toBeNull());
  expect((view.getByText("Save presentation") as HTMLButtonElement).disabled).toBe(true);
});

test("episode and trailer tools share an unknown operation and its GET reconciliation", async () => {
  let value = media("ready"), writes = 0;
  respond(async (url, init) => {
    if (init?.method === "POST") { writes++; value = media("queued", 2); return new Response("Trailer response lost", { status: 503 }); }
    return Response.json(url === resource ? episode() : value);
  });
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect((view.getByText("Redo trailer & poster") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByText("Redo trailer & poster")); fireEvent.click(view.getByText("Confirm trailer & poster request"));
  await waitFor(() => expect(view.getByText("Check saved trailer state")).not.toBeNull());
  view.rerender(trailer); expect(view.getByText("Check saved trailer state")).not.toBeNull();
  expect((view.getByText("Confirm rerender") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByText("Check saved trailer state"));
  await waitFor(() => expect(view.getByText(/Trailer state changed since the request/)).not.toBeNull());
  expect(writes).toBe(1); expect(session.get<Operation>(`operation:${mediaResource}`)?.phase).toBe("accepted");
});

test("trailer reason and ready-version confirmation survive closing and reopening", async () => {
  respond(async () => Response.json(media("ready")));
  const view = render(trailer, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByLabelText("Reason")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Reason"), { target: { value: "Approved repair" } });
  fireEvent.click(view.getByRole("button", { name: "Rerender trailer" }));
  view.rerender(<p>Other page</p>); view.rerender(trailer);
  expect((view.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("Approved repair");
  expect(view.getByText("Confirm rerender")).not.toBeNull();
});

test("a denied naming command clears the episode draft and cached form on reopen", async () => {
  respond(async (url, init) => init?.method === "POST" ? new Response("Naming permission removed", { status: 403 })
    : Response.json(url === resource ? episode() : media("ready")));
  const view = render(editor, { wrapper: adminTestWrapper() });
  await waitFor(() => expect(view.getByLabelText("Title")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Title"), { target: { value: "Private draft" } });
  fireEvent.click(view.getByText("Regenerate title & description"));
  await waitFor(() => expect(view.queryByLabelText("Title")).toBeNull());
  expect(session.get(`draft:${resource}`)).toBeUndefined(); expect(session.get(`operation:${resource}:naming`)).toBeUndefined();
  view.rerender(<p>Other page</p>); view.rerender(editor);
  expect(view.queryByLabelText("Title")).toBeNull(); expect(view.getByText(/Access is no longer available/)).not.toBeNull();
});
