import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (path: string) => pushed.push(path) }),
}));

const { CreateGameForm } = await import("./create-game-form");

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;
let activeWindow: HappyDOMWindow | null = null;

afterEach(() => {
  cleanup();
  pushed.length = 0;
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  activeWindow?.close();
  activeWindow = null;
});

describe("new game form", () => {
  test("shows Primary and fallbacks with approved models and Adaptive reasoning", async () => {
    installDom();
    globalThis.fetch = (async () => jsonResponse(providerInventory())) as unknown as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByText("Provider route")).not.toBeNull());

    expect(mounted.getByText("Primary")).not.toBeNull();
    expect(mounted.getAllByText("Fallback 1").length).toBeGreaterThan(0);
    expect(mounted.getAllByText("Fallback 2").length).toBeGreaterThan(0);
    expect(mounted.queryByText(/Mixed/)).toBeNull();
    expect(mounted.getAllByText("Adaptive").length).toBe(3);

    const routeSelectors = Array.from(mounted.container.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="model"]',
    ));
    expect(routeSelectors.map((select) => select.value)).toEqual([
      "openai:gpt-5.6-luna",
      "katana:glm-5-2",
      "katana:grok-4-5",
    ]);

    const options = Array.from(mounted.container.querySelectorAll("option"))
      .map((option) => option.textContent);
    expect(options).toContain("xAI Grok 4.5");
    expect(options).toContain("Katana GLM 5.2");
    expect(options).toContain("Katana deepseek-v3");
  });

  test("reorders the route and submits only the sealed provider manifest", async () => {
    installDom();
    const createBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) {
        return jsonResponse(providerInventory());
      }
      createBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: "game-1", slug: "bright-coral-moon" }, 201);
    }) as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByText("Provider route")).not.toBeNull());
    fireEvent.click(mounted.getByRole("button", { name: "Move primary down" }));
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));

    await waitFor(() => expect(pushed).toEqual(["/games/bright-coral-moon"]));
    const createBody = createBodies[0]!;
    expect(createBody).not.toHaveProperty("slotType");
    expect(createBody).not.toHaveProperty("modelSelection");
    expect(createBody.providerManifest).toEqual([
      { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy" },
      { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "medium", maxCallsPerGame: 12 },
      { catalogId: "katana:grok-4-5", reasoningPolicy: "action-policy", maxCallsPerGame: 12 },
    ]);
    expect(createBody.formatManifest).toEqual([
      "save_or_eliminate",
      "vote_bomb",
      "safety_bounce",
      "majority_elimination",
      "even_votes",
      "restricted_history",
      "two_names",
    ]);
  });

  test("selects a single format and submits it as the frozen rotation", async () => {
    installDom();
    const createBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) {
        return jsonResponse(providerInventory());
      }
      createBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: "game-1", slug: "bright-coral-moon" }, 201);
    }) as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getAllByRole("checkbox")).toHaveLength(7));
    expect(mounted.getAllByRole("checkbox").every((checkbox) => (
      checkbox.getAttribute("aria-checked") === "true"
    ))).toBe(true);

    fireEvent.click(mounted.getByRole("button", { name: "Only Highest Count" }));
    expect(mounted.getByText("1/7 selected")).not.toBeNull();
    fireEvent.click(mounted.getByRole("checkbox", { name: "Highest Count" }));
    expect(mounted.getByText("1/7 selected")).not.toBeNull();
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));

    await waitFor(() => expect(pushed).toEqual(["/games/bright-coral-moon"]));
    expect(createBodies[0]?.formatManifest).toEqual(["majority_elimination"]);
  });

  test("explains Restricted History eligibility from the selected player count", async () => {
    installDom();
    globalThis.fetch = (async () => jsonResponse(providerInventory())) as unknown as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByText("Unavailable with 6 players")).not.toBeNull());
    expect(
      (mounted.getByRole("button", { name: "Only Restricted History" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(mounted.getByRole("button", { name: "8" }));
    expect(mounted.getByText("8+ players")).not.toBeNull();
  });

  test("requires an opening-round format when Restricted History is the only selection", async () => {
    installDom();
    let createRequestCount = 0;
    globalThis.fetch = (async (request) => {
      if (String(request).endsWith("/api/provider-models")) {
        return jsonResponse(providerInventory());
      }
      createRequestCount += 1;
      return jsonResponse({ id: "game-1", slug: "bright-coral-moon" }, 201);
    }) as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getAllByRole("checkbox")).toHaveLength(7));
    fireEvent.click(mounted.getByRole("button", { name: "Only Save-or-Exit" }));
    fireEvent.click(mounted.getByRole("checkbox", { name: "Restricted History" }));
    fireEvent.click(mounted.getByRole("checkbox", { name: "Save-or-Exit" }));

    expect(mounted.getByRole("alert").textContent).toContain(
      "Select at least one format available in the opening round",
    );
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    expect(createRequestCount).toBe(0);
    expect(pushed).toEqual([]);
  });

  test("does not add unconfigured fallback providers to a new game's default route", async () => {
    installDom();
    const createBodies: Array<Record<string, unknown>> = [];
    const inventory = providerInventory();
    inventory.models = inventory.models.map((model) => ({
      ...model,
      configured: model.providerProfileId === "openai",
    }));
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) {
        return jsonResponse(inventory);
      }
      createBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: "game-1", slug: "bright-coral-moon" }, 201);
    }) as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getAllByText("Primary").length).toBeGreaterThan(0));
    await waitFor(() => expect(mounted.queryByText("Fallback 1")).toBeNull());
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));

    await waitFor(() => expect(pushed).toEqual(["/games/bright-coral-moon"]));
    expect(createBodies[0]?.providerManifest).toEqual([
      { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "medium" },
    ]);
  });

  test("omits unavailable recommended models and constrains fallback caps", async () => {
    installDom();
    const inventory = providerInventory();
    inventory.models = inventory.models.map((model) => ({
      ...model,
      available: model.catalogId === "katana:glm-5-2" ? false : true,
    }));
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) {
        return jsonResponse(inventory);
      }
      void init;
      return jsonResponse({ id: "game-1", slug: "bright-coral-moon" }, 201);
    }) as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getAllByText("Fallback 1").length).toBeGreaterThan(0));
    expect(mounted.queryByText("Fallback 2")).toBeNull();
    const glmOption = Array.from(mounted.container.querySelectorAll("option"))
      .find((option) => option.value === "katana:glm-5-2");
    expect(glmOption?.disabled).toBe(true);

    const maxCallsInput = mounted.getByRole("spinbutton", {
      name: "Fallback 1 max calls per game",
    });
    expect(maxCallsInput.getAttribute("min")).toBe("1");
    expect(maxCallsInput.getAttribute("max")).toBe("10000");
  });
});

function installDom() {
  activeWindow = new HappyDOMWindow({ url: "https://influence.test/admin/games/new" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: activeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: activeWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: activeWindow.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: activeWindow.localStorage });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerInventory() {
  const base = {
    configured: true,
    available: true,
    capabilities: {
      supportsReasoningEffort: true,
      supportsToolReasoningEffort: true,
      usesMaxCompletionTokens: false,
      supportsTemperature: true,
      supportsOpenAIResponses: false,
      supportsStructuredOutput: true,
      supportsTools: true,
    },
    notes: null,
  };
  return {
    status: "complete",
    models: [
      {
        ...base,
        catalogId: "openai:gpt-5.6-luna",
        providerProfileId: "openai",
        modelId: "gpt-5.6-luna",
        displayName: "OpenAI gpt-5.6-luna",
        defaultReasoningPolicy: "action-policy",
        allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
      },
      {
        ...base,
        catalogId: "katana:grok-4-5",
        providerProfileId: "katana",
        modelId: "grok-4-5",
        displayName: "xAI Grok 4.5",
        defaultReasoningPolicy: "action-policy",
        allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
      },
      {
        ...base,
        catalogId: "katana:glm-5-2",
        providerProfileId: "katana",
        modelId: "glm-5-2",
        displayName: "Katana GLM 5.2",
        defaultReasoningPolicy: "action-policy",
        allowedReasoningPolicies: ["action-policy"],
      },
      {
        ...base,
        catalogId: "katana:deepseek-v3",
        providerProfileId: "katana",
        modelId: "deepseek-v3",
        displayName: "Katana deepseek-v3",
        defaultReasoningPolicy: "action-policy",
        allowedReasoningPolicies: ["action-policy"],
      },
    ],
  };
}
