import { afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import React from "react";
import {
  containedFocusTargetIndex,
  DAILY_AGENT_PROMPT_DELAY_MS,
  DAILY_AGENT_RETRY_DELAYS_MS,
  dailyAgentPromptBranch,
  shouldLoadDailyAgentPrompt,
  transitionDailyAgentPromptHandoff,
} from "../components/standing-daily-agent-prompt-model";
import { setApiBase, type AdminFreeQueueStatus } from "../lib/api";

mock.module("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (permission: string) => permission === "schedule_free_game",
  }),
}));

const { FreeQueuePanel } = await import("../app/admin/free-queue-panel");

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
let activeDomWindow: HappyDOMWindow | null = null;

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const domWindow = activeDomWindow;
  activeDomWindow = null;
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  domWindow?.close();
});

const freePage = readFileSync(
  join(import.meta.dir, "../app/games/free/free-game-content.tsx"),
  "utf8",
);
const adminPanel = readFileSync(
  join(import.meta.dir, "../app/admin/free-queue-panel.tsx"),
  "utf8",
);
const providers = readFileSync(
  join(import.meta.dir, "../app/providers.tsx"),
  "utf8",
);

describe("standing Daily Agent acquisition", () => {
  it("selects zero, one, and many-agent branches with bounded delays", () => {
    expect(dailyAgentPromptBranch(0)).toBe("create");
    expect(dailyAgentPromptBranch(1)).toBe("single");
    expect(dailyAgentPromptBranch(2)).toBe("choose");
    expect(DAILY_AGENT_PROMPT_DELAY_MS).toBe(3000);
    expect(DAILY_AGENT_RETRY_DELAYS_MS).toEqual([2000, 5000]);
  });

  it("consumes an immediate handoff once and delays later queue changes normally", () => {
    const publicId = "8d91d5d0-bb3f-4559-a51a-64e1d2236f21";
    const immediate = transitionDailyAgentPromptHandoff(publicId, "eligible");
    expect(immediate).toEqual({
      nextPublicId: null,
      consumedPublicId: publicId,
      openDelayMs: 0,
    });

    expect(transitionDailyAgentPromptHandoff(
      immediate.nextPublicId,
      "eligible",
    )).toEqual({
      nextPublicId: null,
      consumedPublicId: null,
      openDelayMs: DAILY_AGENT_PROMPT_DELAY_MS,
    });
  });

  it("retains the handoff through retries and consumes conclusive failures", () => {
    const publicId = "8d91d5d0-bb3f-4559-a51a-64e1d2236f21";
    expect(transitionDailyAgentPromptHandoff(publicId, "retry")).toEqual({
      nextPublicId: publicId,
      consumedPublicId: null,
      openDelayMs: null,
    });
    for (const outcome of ["ineligible", "exhausted"] as const) {
      expect(transitionDailyAgentPromptHandoff(publicId, outcome)).toEqual({
        nextPublicId: null,
        consumedPublicId: publicId,
        openDelayMs: null,
      });
    }
  });

  it("keeps keyboard focus inside from edges and outside focus", () => {
    expect(containedFocusTargetIndex(3, -1, false)).toBe(0);
    expect(containedFocusTargetIndex(3, -1, true)).toBe(2);
    expect(containedFocusTargetIndex(3, 0, true)).toBe(2);
    expect(containedFocusTargetIndex(3, 2, false)).toBe(0);
    expect(containedFocusTargetIndex(3, 1, false)).toBeNull();
  });

  it("does not arm until authentication and the root invite gate resolve", () => {
    const ready = { signedIn: true, needsInvite: false, hasAuthToken: true, sessionDismissed: false };
    expect(shouldLoadDailyAgentPrompt(ready)).toBe(true);
    expect(shouldLoadDailyAgentPrompt({ ...ready, needsInvite: true })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, signedIn: false })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, hasAuthToken: false })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, sessionDismissed: true })).toBe(false);
  });

  it("remounts acquisition state when the active public identity changes", () => {
    expect(providers).toContain('key={identity?.publicId ?? "legacy"}');
  });

  it("keeps owner and admin removal direct and free of consequence warnings", () => {
    expect(freePage).toContain('onClick={onLeave}');
    expect(adminPanel).toContain('onClick={() => void remove(entry.userId)}');
    const removalSource = `${freePage}\n${adminPanel}`.toLowerCase();
    expect(removalSource).not.toContain("are you sure");
    expect(removalSource).not.toContain("next season");
    expect(removalSource).not.toContain("won't get");
  });

  it("lets authorized operators draw and start the queue without a confirmation gate", () => {
    expect(adminPanel).toContain('<PermissionGate permission="schedule_free_game">');
    expect(adminPanel).toContain("Run queue now");
    expect(adminPanel.toLowerCase()).not.toContain("confirm");
  });

  it("starts the exact game returned by the draw", async () => {
    installDom();
    setApiBase("https://api.example.test");
    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/api/admin/free-queue")) return jsonResponse(queueStatus(null));
      if (url.endsWith("/api/free-queue/draw")) {
        return jsonResponse({
          drawn: true,
          gameId: "drawn/game",
          gameSlug: "drawn-game",
          playersDrawn: 6,
          aiPlayersFilled: 6,
          totalPlayers: 12,
          supersededGameCount: 1,
          rated: true,
          seasonId: "season-1",
        }, 201);
      }
      if (url.endsWith("/api/free-queue/start?gameId=drawn%2Fgame")) {
        return jsonResponse({
          started: true,
          gameId: "drawn/game",
          gameSlug: "drawn-game",
          players: 12,
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as typeof fetch;

    const mounted = render(React.createElement(FreeQueuePanel));
    fireEvent.click(await mounted.findByRole("button", { name: "Run queue now" }));

    await waitFor(() => expect(mounted.getByText("Game started.")).not.toBeNull());
    await waitFor(() => {
      expect(mounted.getByRole("button", { name: "Run queue now" }).hasAttribute("disabled")).toBe(false);
    });
    expect(requests.map(({ url, method }) => `${method} ${url}`)).toEqual([
      "GET https://api.example.test/api/admin/free-queue",
      "POST https://api.example.test/api/free-queue/draw",
      "POST https://api.example.test/api/free-queue/start?gameId=drawn%2Fgame",
      "GET https://api.example.test/api/admin/free-queue",
    ]);
  });

  it("retries an already waiting game without drawing another", async () => {
    installDom();
    setApiBase("https://api.example.test");
    const requests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/admin/free-queue")) {
        return jsonResponse(queueStatus({
          id: "waiting-game",
          slug: "waiting-game",
          status: "waiting",
        }));
      }
      if (url.endsWith("/api/free-queue/start?gameId=waiting-game")) {
        return jsonResponse({
          started: true,
          gameId: "waiting-game",
          gameSlug: "waiting-game",
          players: 12,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const mounted = render(React.createElement(FreeQueuePanel));
    fireEvent.click(await mounted.findByRole("button", { name: "Retry start" }));

    await waitFor(() => expect(mounted.getByText("Game started.")).not.toBeNull());
    await waitFor(() => {
      expect(mounted.getByRole("button", { name: "Retry start" }).hasAttribute("disabled")).toBe(false);
    });
    expect(requests.some((request) => request.includes("/api/free-queue/draw"))).toBe(false);
    expect(requests).toContain(
      "POST https://api.example.test/api/free-queue/start?gameId=waiting-game",
    );
  });

  it("retries the drawn game after provider readiness fails without drawing again", async () => {
    installDom();
    setApiBase("https://api.example.test");
    let queueReads = 0;
    let draws = 0;
    let starts = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/api/admin/free-queue")) {
        queueReads += 1;
        return jsonResponse(queueStatus(queueReads === 1 ? null : {
          id: "retry-game",
          slug: "retry-game",
          status: "waiting",
        }));
      }
      if (url.endsWith("/api/free-queue/draw")) {
        draws += 1;
        return jsonResponse({
          drawn: true,
          gameId: "retry-game",
          gameSlug: "retry-game",
          playersDrawn: 6,
          aiPlayersFilled: 6,
          totalPlayers: 12,
          supersededGameCount: 0,
          rated: true,
          seasonId: "season-1",
        }, 201);
      }
      if (url.endsWith("/api/free-queue/start?gameId=retry-game")) {
        starts += 1;
        return starts === 1
          ? jsonResponse({ error: "Provider unavailable" }, 503)
          : jsonResponse({
              started: true,
              gameId: "retry-game",
              gameSlug: "retry-game",
              players: 12,
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const mounted = render(React.createElement(FreeQueuePanel));
    fireEvent.click(await mounted.findByRole("button", { name: "Run queue now" }));
    const retry = await mounted.findByRole("button", { name: "Retry start" });
    expect(mounted.getByText("The waiting game is ready to retry.")).not.toBeNull();
    fireEvent.click(retry);

    await waitFor(() => expect(mounted.getByText("Game started.")).not.toBeNull());
    await waitFor(() => {
      expect(mounted.getByRole("button", { name: "Retry start" }).hasAttribute("disabled")).toBe(false);
    });
    expect(draws).toBe(1);
    expect(starts).toBe(2);
  });
});

function installDom() {
  const domWindow = new HappyDOMWindow({ url: "http://localhost/admin?tab=free-queue" });
  activeDomWindow = domWindow;
  Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: domWindow.localStorage });
}

function queueStatus(
  waitingGame: AdminFreeQueueStatus["waitingGame"],
): AdminFreeQueueStatus {
  return {
    eligibleCount: 6,
    availableHumanSeats: 12,
    longestWaitSince: "2026-08-04T00:00:00.000Z",
    waitingGame,
    entries: [],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
