import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("React errors report once when active and never backfill unmounted errors", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window();
    for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event"]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom : dom[name] });
    }
    let active = false;
    const listeners = new Set(), captured = [];
    mock.module("@/lib/product-analytics", () => ({
      analyticsActive: () => active,
      subscribeAnalyticsActivity: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      captureProductException: error => captured.push(error),
    }));
    const { createElement } = await import("react");
    const { render, act, cleanup } = await import("@testing-library/react");
    const { ReportClientError } = await import("./src/components/report-client-error");
    const error = new Error("private");
    const activity = value => act(async () => { active = value; listeners.forEach(listener => listener()); });
    let view;
    await act(async () => { view = render(createElement(ReportClientError, { error })); });
    assert.equal(captured.length, 0);
    await activity(true);
    assert.deepEqual(captured, [error]);
    await activity(false);
    await activity(true);
    assert.equal(captured.length, 1);
    await act(async () => view.unmount());
    await activity(false);
    await act(async () => { view = render(createElement(ReportClientError, { error: new Error("closed") })); });
    await act(async () => view.unmount());
    await activity(true);
    assert.equal(captured.length, 1);
    cleanup(); dom.close();
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
