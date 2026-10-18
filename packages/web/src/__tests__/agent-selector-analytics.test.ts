import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("join opening follows analytics readiness only while the selector is mounted", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window({ url: "http://localhost" });
    for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event"]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom : dom[name] });
    }
    dom.HTMLDialogElement.prototype.showModal = function() {};
    dom.HTMLDialogElement.prototype.close = function() {};
    let active = false;
    const listeners = new Set();
    const events = [];
    mock.module("@/lib/product-analytics", () => ({
      analyticsActive: () => active,
      subscribeAnalyticsActivity: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      captureProductEvent: (event, properties) => events.push({ event, properties }),
      analyticsOperation: () => null,
      measureProductRequest: (operation, request) => request(),
    }));
    const router = { push() {} };
    mock.module("next/navigation", () => ({ useRouter: () => router }));
    mock.module("next/image", () => ({ default: () => null }));
    const { createElement } = await import("react");
    const { render, act, cleanup } = await import("@testing-library/react");
    const { AgentSelector } = await import("./src/components/casting/agent-selector");
    const props = { description: "Join", createHref: "/agents/create", onClose() {}, onSelect() {}, submitLabel: "Join", pendingLabel: "Joining" };
    const changeActivity = async value => act(async () => { active = value; listeners.forEach(listener => listener()); });
    let view;
    await act(async () => { view = render(createElement(AgentSelector, props)); });
    assert.equal(events.length, 0);
    // Region lookup / SDK initialization completes while dialog is still open.
    await changeActivity(true);
    assert.deepEqual(events, [{ event: "join_opened", properties: { game_kind: "influence" } }]);
    await changeActivity(false);
    await changeActivity(true);
    assert.equal(events.length, 1);
    await act(async () => view.unmount());
    await changeActivity(false);
    await act(async () => { view = render(createElement(AgentSelector, { ...props, gameKind: "werewolf" })); });
    await act(async () => view.unmount());
    // A dialog closed before consent/readiness must never be backfilled.
    await changeActivity(true);
    assert.equal(events.length, 1);
    await act(async () => { view = render(createElement(AgentSelector, { ...props, gameKind: "werewolf" })); });
    assert.deepEqual(events[1], { event: "join_opened", properties: { game_kind: "werewolf" } });
    await act(async () => cleanup());
    dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
