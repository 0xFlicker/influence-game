import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("the game picker routes Agents without body art to completion and joins ready Agents", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window({ url: "http://localhost" });
    for (const name of ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom : dom[name] });
    }
    dom.HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
    dom.HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
    const paths = [];
    const router = { push: path => paths.push(path) };
    let joins = 0;
    let body = null;
    mock.module("next/navigation", () => ({ useRouter: () => router }));
    mock.module("next/image", () => ({ default: () => null }));
    mock.module("@/lib/product-analytics", () => ({ analyticsActive: () => false, subscribeAnalyticsActivity: () => () => {}, captureProductEvent: () => {} }));
    mock.module("@/lib/api", () => ({ getAuthToken: () => "token", listAgents: async () => [{ id: "agent", name: "Avery", personality: "Patient", backstory: null, strategyStyle: null, personaKey: "strategic", avatarUrl: null, fullBodyReferenceUrl: body, gamesPlayed: 0, gamesWon: 0, createdAt: "2026", updatedAt: "2026" }] }));
    mock.module("@/components/agent-avatar", () => ({ useAgentAvatarUrl: () => () => "/avatar.png" }));
    mock.module("@/lib/personas", () => ({ getPersonaLabel: () => "Strategist" }));
    mock.module("@/components/agent-model-label", () => ({ AgentModelLabel: () => null, agentModelLabel: () => null }));
    const { createElement } = await import("react");
    const { render, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
    const { AgentSelector } = await import("./src/components/casting/agent-selector");
    const props = { description: "Join", createHref: "/agents/create", intent: { flow: "join_game", gameId: "game-1" }, onClose() {}, onSelect() { joins++; }, submitLabel: "Join game", pendingLabel: "Joining" };
    let view = render(createElement(AgentSelector, props));
    await waitFor(() => assert.ok(view.getByRole("radio", { name: "Avery" })));
    fireEvent.click(view.getByRole("radio", { name: "Avery" }));
    assert.ok(view.getByText("Full-body image needed"));
    fireEvent.click(view.getByRole("button", { name: /Complete & join/ }));
    assert.deepEqual(paths, ["/agents/prepare?flow=join_game&gameId=game-1&agentId=agent"]);
    assert.equal(joins, 0);
    cleanup();
    body = "/api/uploads/local?key=body.png";
    view = render(createElement(AgentSelector, props));
    await waitFor(() => assert.ok(view.getByRole("radio", { name: "Avery" })));
    fireEvent.click(view.getByRole("radio", { name: "Avery" }));
    fireEvent.click(view.getByRole("button", { name: /Join game/ }));
    await waitFor(() => assert.equal(joins, 1));
    assert.equal(paths.length, 1);
    cleanup(); dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("missing art opens the workspace and entry waits for acceptance", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window({ url: "http://localhost/agents/prepare" });
    for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "Node", "Event"]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom : dom[name] });
    }
    let body = null, accepted = false, starts = 0, joins = 0;
    const paths = [];
    const router = { replace: path => paths.push(path) };
    const agent = () => ({ id: "agent", latestContentRevisionId:"new",contentRevisionId:accepted?"new":null,ownerContent:{reviewState:accepted?"accepted":"reviewing"}, name: "Avery", personality: "Patient", backstory: null, strategyStyle: null, personaKey: "strategic", avatarUrl: null, fullBodyReferenceUrl: body, gamesPlayed: 0, gamesWon: 0, createdAt: "2026", updatedAt: "2026" });
    mock.module("next/navigation", () => ({ useRouter: () => router }));
    mock.module("next/link", () => ({ default: ({ href, children, ...props }) => { const React = require("react"); return React.createElement("a", { href, ...props }, children); } }));
    mock.module("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetchMedia: async () => new Blob(), resolveApiUrl: url => url, clearAgentEntryIntent: async () => {}, getAgent: async () => agent(), startAgentVisualUpdate: async () => { starts++; }, joinGame: async () => { joins++; }, joinFreeQueue: async () => {}, listAgents: async () => [] }));
    mock.module("@/lib/game-entry", () => ({ getGameEntry: async () => ({ gameKind: "influence", slug: "game-1" }) }));
    mock.module("@/lib/game-links", () => ({ gameHref: slug => "/games/" + slug }));
    mock.module("@/lib/werewolf-api", () => ({ joinWerewolfLobby: async () => {} }));
    const { createElement } = await import("react");
    const { render, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
    const { AgentEntryPreparation } = await import("./src/app/dashboard/agents/agent-entry-preparation");
    const view = render(createElement(AgentEntryPreparation, { agentId: "agent", intent: { flow: "join_game", gameId: "game-1" } }));
    await waitFor(() => assert.ok(view.getByRole("link",{name:"Edit"})));
    assert.equal(view.getByRole("link",{name:"Edit"}).getAttribute("href"),"/dashboard/agents/agent/edit?flow=join_game&gameId=game-1");
    assert.equal(view.getByRole("button",{name:"Join"}).disabled,true);assert.equal(starts,0);assert.equal(joins,0);
    body="/api/uploads/local?key=body.png";
    await act(async()=>{dom.dispatchEvent(new dom.Event("focus"));});
    assert.equal(view.getByRole("button",{name:"Join"}).disabled,true);
    accepted=true;await act(async()=>{dom.dispatchEvent(new dom.Event("focus"));});
    await waitFor(()=>assert.equal(view.getByRole("button",{name:"Join"}).disabled,false));
    assert.equal(joins,0);fireEvent.click(view.getByRole("button",{name:"Join"}));await waitFor(()=>assert.equal(joins,1));
    assert.deepEqual(paths, ["/games/game-1"]);
    cleanup(); dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
