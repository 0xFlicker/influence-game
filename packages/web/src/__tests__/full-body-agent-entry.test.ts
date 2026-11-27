import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("the game picker preselects the sole agent and routes the explicit action", () => {
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
    mock.module("@/lib/product-analytics", () => ({ analyticsActive: () => false, captureRequestFailure: () => {}, markReportedRequest: () => {}, subscribeAnalyticsActivity: () => () => {}, captureProductEvent: () => {} }));
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
    assert.equal(view.getByRole("radio", { name: "Avery" }).checked, true);
    assert.ok(view.getByText("Full-body image needed"));
    fireEvent.click(view.getByRole("button", { name: /Prepare Avery & join/ }));
    assert.deepEqual(paths, ["/agents/prepare?flow=join_game&gameId=game-1&agentId=agent"]);
    assert.equal(joins, 0);
    cleanup();
    body = "/api/uploads/local?key=body.png";
    view = render(createElement(AgentSelector, props));
    await waitFor(() => assert.ok(view.getByRole("radio", { name: "Avery" })));
    fireEvent.click(view.getByRole("button", { name: /Join with Avery/ }));
    await waitFor(() => assert.equal(joins, 1));
    assert.equal(paths.length, 1);
    cleanup(); dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("entry saves artwork, resumes review and handles actual lobby and season results", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window({ url: "http://localhost/agents/prepare" });
    for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "Node", "Event"]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom : dom[name] });
    }
    Object.defineProperty(document, "hidden", { value: false });
    const gameIntent = { flow: "join_game", gameId: "game-1" };
    const dailyIntent = { flow: "daily_free", seasonId: "s1", season: "season-1" };
    let storedIntent = null;
    let body = null;
    let review = "accepted";
    let gameKind = "influence";
    let status = "waiting";
    let players = [];
    let joinResult = async () => {};
    const paths = [], joins = [], saves = [], clears = [], queue = [];
    const router = { replace: path => paths.push(path) };
    const agent = () => ({
      id: "agent", name: "Avery", personality: "Patient", backstory: null,
      strategyStyle: null, personaKey: "strategic", avatarUrl: null,
      fullBodyReferenceUrl: body, gamesPlayed: 0, gamesWon: 0,
      ownerContent: { reviewState: review, entryIntent: storedIntent, availability: "available" },
    });
    class ApiError extends Error {
      constructor(status, message) { super(message); this.status = status; }
    }
    const game = () => ({ slug: "friday-night", status, playerCount: 2, players });
    mock.module("next/navigation", () => ({ useRouter: () => router }));
    mock.module("next/link", () => ({ default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) }));
    mock.module("@/lib/api", () => ({
      ApiError, getAgent: async () => agent(), getGame: async () => game(), listAgents: async () => [],
      apiFetchMedia: async () => new Blob(), resolveApiUrl: url => url,
      clearAgentEntryIntent: async (_, intent) => { clears.push(intent); storedIntent = null; },
      joinGame: async (gameId, { agentProfileId }) => { joins.push(["influence", gameId, agentProfileId]); await joinResult(); },
      joinFreeQueue: async (id, seasonId) => { queue.push([id, seasonId]); await joinResult(); },
      updateAgent: async (_, params) => {
        saves.push(params);
        storedIntent = params.entryIntent;
        if (review !== "reviewing") body = params.fullBodyReferenceUrl;
        // PATCH returns the mutation receipt. Only GET returns ownerContent.
        const { ownerContent, ...saved } = agent();
        return { ...saved, receipt: { publication: review === "reviewing" ? "reviewing" : "published" } };
      },
    }));
    mock.module("@/lib/game-entry", () => ({
      getGameEntry: async () => ({ gameKind, id: "game-1", slug: "friday-night" }),
    }));
    mock.module("@/lib/werewolf-api", () => ({
      getWerewolfLobby: async () => game(),
      joinWerewolfLobby: async (gameId, agentId) => { joins.push(["werewolf", gameId, agentId]); await joinResult(); },
    }));
    mock.module("./src/app/dashboard/agents/agent-form", () => ({
      AgentForm: ({ entryArtwork, onSubmit, submitLabel }) => createElement("section", null,
        entryArtwork.target,
        createElement("button", { onClick: () => onSubmit({ fullBodyReferenceUrl: "/body.png", submissionId: "save" }) }, submitLabel),
      ),
    }));
    const { createElement } = await import("react");
    const { render, fireEvent, waitFor, cleanup, act } = await import("@testing-library/react");
    const { AgentEntryPreparation } = await import("./src/app/dashboard/agents/agent-entry-preparation");
    const mount = (intent = gameIntent) => render(createElement(AgentEntryPreparation, { agentId: "agent", intent }));
    let view = mount();
    await waitFor(() => assert.ok(view.getByText("Influence · friday-night")));
    assert.equal(joins.length, 0);
    review = "reviewing";
    fireEvent.click(view.getByRole("button", { name: "Save image & join" }));
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Waiting for approval" })));
    assert.deepEqual(saves[0].entryIntent, gameIntent);
    assert.equal(joins.length, 0);
    review = "accepted";
    body = "/body.png";
    let completeJoin;
    joinResult = () => new Promise(resolve => { completeJoin = resolve; });
    await act(async () => { dom.dispatchEvent(new dom.Event("focus")); });
    await waitFor(() => assert.ok(view.getByRole("status").textContent.includes("Joining game")));
    assert.deepEqual(joins, [["influence", "game-1", "agent"]]);
    await act(async () => completeJoin());
    await waitFor(() => assert.deepEqual(paths, ["/games/friday-night"]));
    assert.deepEqual(clears, [gameIntent]);
    cleanup();

    gameKind = "werewolf";
    body = null;
    view = mount();
    await waitFor(() => assert.ok(view.getByText("Werewolf · friday-night")));
    joinResult = async () => {
      players = [{ agentProfileId: "someone" }, { agentProfileId: "another" }];
      throw new ApiError(409, "The village is full.");
    };
    fireEvent.click(view.getByRole("button", { name: "Save image & join" }));
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "The lobby is full" })));
    assert.equal(view.getByRole("link", { name: "View lobby" }).getAttribute("href"), "/games/friday-night");
    assert.equal(body, "/body.png");
    assert.deepEqual(joins.at(-1), ["werewolf", "game-1", "agent"]);
    assert.equal(paths.length, 1);
    cleanup();

    body = null;
    status = "in_progress";
    view = mount();
    await waitFor(() => assert.ok(view.getByRole("link", { name: "Watch game" })));
    assert.equal(view.queryByRole("button", { name: "Save image & join" }), null);
    assert.equal(saves.length, 2);
    cleanup();

    body = "/body.png";
    storedIntent = null;
    view = mount(dailyIntent);
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Enter with Avery" })));
    assert.equal(queue.length, 0, "Opening a prepare URL alone must not enroll an agent");
    cleanup();

    storedIntent = dailyIntent;
    joinResult = async () => { throw new ApiError(409, "Season is no longer accepting entries"); };
    view = mount(dailyIntent);
    await waitFor(() => assert.equal(view.getByRole("alert").textContent, "Season is no longer accepting entries"));
    const originalPathCount = paths.length;
    assert.deepEqual(queue, [["agent", "s1"]]);
    joinResult = async () => {};
    fireEvent.click(view.getByRole("button", { name: "Check entry again" }));
    await waitFor(() => assert.equal(paths.length, originalPathCount + 1));
    assert.deepEqual(queue, [["agent", "s1"], ["agent", "s1"]]);
    assert.equal(paths.at(-1), "/seasons?season=season-1");
    cleanup();
    dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
