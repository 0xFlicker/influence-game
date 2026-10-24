import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { modelCatalogEntryById } from "@influence/engine";
import { AllowedModelsPicker } from "@/components/allowed-models-picker";

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

afterEach(async () => {
  // Flush React work while this test still owns its DOM globals.
  await act(async () => { cleanup(); });
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
  test("selects allowed models with checkboxes and submits only unchecked exclusions", async () => {
    installDom();
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(providerInventory());
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: "game", slug: "allowed-models" }, 201);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByRole("combobox", { name: "Fallback 1 model" })).not.toBeNull());
    const summary = mounted.getByText("Allowed models");
    expect(summary.closest("details")?.open).toBe(false);
    fireEvent.click(summary);
    const luna = mounted.getByRole("checkbox", { name: "Allow OpenAI gpt-6-luna" }) as HTMLInputElement;
    expect(luna.checked).toBe(true);
    expect(luna.disabled).toBe(true);
    const grok = mounted.getByRole("checkbox", { name: "Allow xAI Grok 4.5" }) as HTMLInputElement;
    expect(grok.checked).toBe(true);
    fireEvent.click(grok);
    expect(grok.checked).toBe(false);
    expect(mounted.getByText("1 excluded")).not.toBeNull();
    fireEvent.click(mounted.getByRole("button", { name: "Allow all" }));
    expect(grok.checked).toBe(true);
    fireEvent.click(grok);
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    await waitFor(() => expect(pushed).toEqual(["/games/allowed-models"]));
    expect(bodies[0]).toMatchObject({ modelRouting: { excludedCatalogIds: ["katana:grok-4-5"] } });
  });

  test("searching allowed models retains saved exclusions absent from current discovery", () => {
    installDom();
    const onChange = mock();
    const mounted = render(<AllowedModelsPicker
      models={Array.from({ length: 9 }, (_, i) => ({ catalogId: `katana:test-${i}`, displayName: `Test ${i}` }))}
      excludedIds={["katana:saved-model"]} onChange={onChange} />);
    fireEvent.click(mounted.getByText("Allowed models"));
    fireEvent.input(mounted.getByRole("searchbox", { name: "Search models" }), { target: { value: "saved-model" } });
    const checkbox = mounted.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([]);
    fireEvent.input(mounted.getByRole("searchbox", { name: "Search models" }), { target: { value: "no-match" } });
    expect(mounted.getByText(/No models match/)).not.toBeNull();
  });

  test("keeps an offline local catalog out of the form while retaining hosted choices and recommended fallbacks", async () => {
    installDom();
    const inventory = { ...providerInventory(), status: "partial", providers: [
      { providerProfileId: "openai", displayName: "OpenAI", status: "complete" },
      { providerProfileId: "katana", displayName: "Katana (IMGNAI)", status: "complete" },
      { providerProfileId: "lm-studio", displayName: "LM Studio", status: "unavailable" },
    ] };
    globalThis.fetch = (async (request: RequestInfo | URL) => {
      expect(String(request)).toEndWith("/api/provider-models");
      return jsonResponse(inventory);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByRole("combobox", { name: "Fallback 1 model" })).not.toBeNull());
    expect(mounted.queryByText(/Could not refresh model catalogs/)).toBeNull();
    expect(mounted.queryByText(/Curated models and exact IDs/)).toBeNull();
    expect(mounted.queryByText(/Live model inventory is unavailable/)).toBeNull();
    const fallback = mounted.getByRole("combobox", { name: "Fallback 1 model" }) as HTMLSelectElement;
    expect(fallback.value).toBe("katana:grok-4-6");
    expect(fallback.disabled).toBe(false);
    const primary = mounted.getByRole("combobox", { name: "Primary model" }) as HTMLSelectElement;
    fireEvent.change(primary, { target: { value: "katana:grok-4-5" } });
    expect(primary.value).toBe("katana:grok-4-5");
  });

  test("does not automatically add a fallback from a failed provider listing", async () => {
    installDom();
    const inventory = { ...providerInventory(), status: "partial", providers: [
      { providerProfileId: "openai", displayName: "OpenAI", status: "complete" },
      { providerProfileId: "katana", displayName: "Katana (IMGNAI)", status: "unavailable" },
    ], models: providerInventory().models.map(model => ({ ...model, available: model.providerProfileId === "katana" ? null : true })) };
    globalThis.fetch = (async (request: RequestInfo | URL) => {
      expect(String(request)).toEndWith("/api/provider-models");
      return jsonResponse(inventory);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect((mounted.getByRole("combobox", { name: "Primary model" }) as HTMLSelectElement).options.length).toBe(inventory.models.length));
    expect(mounted.queryByRole("combobox", { name: "Fallback 1 model" })).toBeNull();
    expect(mounted.getAllByRole("option", { name: "xAI Grok 4.6" }).length).toBeGreaterThan(0);
  });

  test("saves an experimental House route and its own capped fallback without changing contestants", async () => {
    installDom();
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(providerInventory());
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: "game", slug: "independent-house" }, 201);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByRole("combobox", { name: "Fallback 1 model" })).not.toBeNull());
    fireEvent.input(mounted.getByRole("textbox", { name: "House Primary exact model ID" }), { target: { value: "meta-muse:experimental-text-model" } });
    expect(mounted.getByText("Pricing unavailable")).not.toBeNull();
    expect(mounted.queryByText(/Capabilities and pricing may be unknown/)).toBeNull();
    fireEvent.click(mounted.getByRole("button", { name: /House Add fallback/ }));
    fireEvent.input(mounted.getByRole("textbox", { name: "House Fallback 1 exact model ID" }), { target: { value: "katana:deepseek-v4-flash" } });
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    await waitFor(() => expect(pushed).toEqual(["/games/independent-house"]));
    expect(bodies[0]).toMatchObject({ modelRouting: {
      defaultManifest: [{ catalogId: "openai:gpt-6-luna", reasoningPolicy: "medium" }, { catalogId: "katana:grok-4-6", reasoningPolicy: "action-policy", maxCallsPerGame: 24 }],
      houseManifest: [{ catalogId: "meta-muse:experimental-text-model", reasoningPolicy: "action-policy" }, { catalogId: "katana:deepseek-v4-flash", reasoningPolicy: "action-policy", maxCallsPerGame: 12 }],
    } });
  });

  test("submits Visual Mode with GPT-6 Luna using catalog image capabilities", async () => {
    installDom();
    const model = modelCatalogEntryById("openai:gpt-6-luna")!;
    const bodies: Array<Record<string, unknown>> = [];
    const inventory = { status: "complete", models: [{
      catalogId: model.id, modelId: model.modelId, providerProfileId: model.providerProfileId,
      displayName: model.displayName, capabilities: model.capabilities, notes: model.notes,
      configured: true, available: true, defaultReasoningPolicy: model.defaultReasoningPolicy,
      allowedReasoningPolicies: ["action-policy", ...model.allowedReasoningEfforts],
    }] };
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(inventory);
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: "luna-game", slug: "luna-visual" }, 201);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getAllByRole("option", { name: "OpenAI gpt-6-luna" })[0]).not.toBeNull());
    fireEvent.change(mounted.getByRole("combobox", { name: "Primary model" }), { target: { value: model.id } });
    fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    expect(mounted.queryByText(/These provider slots do not support image input/)).toBeNull();
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    await waitFor(() => expect(pushed).toEqual(["/games/luna-visual"]));
    expect(bodies[0]).toMatchObject({ visualMode: true, modelRouting: { defaultManifest: [{ catalogId: model.id, reasoningPolicy: "medium" }], houseManifest: [{ catalogId: model.id, reasoningPolicy: "medium" }] } });
  });

  test.each([false, true])("defaults to Luna and Grok 4.6 only (visual: %s)", async visual => {
    installDom();
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(providerInventory());
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: "game", slug: "default-route" }, 201);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByRole("combobox", { name: "Fallback 1 model" })).not.toBeNull());
    if (visual) fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    await waitFor(() => expect(pushed).toEqual(["/games/default-route"]));
    expect((bodies[0]?.modelRouting as { defaultManifest: unknown }).defaultManifest).toEqual([
      { catalogId: "openai:gpt-6-luna", reasoningPolicy: "medium" },
      { catalogId: "katana:grok-4-6", reasoningPolicy: "action-policy", maxCallsPerGame: 24 },
    ]);
  });

  test("names skipped visual provider slots before submission", async () => {
    installDom();
    globalThis.fetch = (async () => jsonResponse(providerInventory())) as unknown as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await configureTextFallbacks(mounted);
    fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    expect(mounted.getByRole("status").textContent).toContain("Katana GLM 5.2");
    expect(mounted.getByRole("status").textContent).toContain("xAI Grok 4.5");
    expect(mounted.getByRole("status").textContent).not.toContain("OpenAI gpt-5.6-luna");
  });

  test("visual games preserve the common fallback chain and reject an incompatible primary", async () => {
    installDom();
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (request, init) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(providerInventory());
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: "game", slug: "visual-route" }, 201);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await configureTextFallbacks(mounted);
    fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    expect(mounted.container.querySelectorAll('[data-visual-skipped="true"]').length).toBe(2);
    fireEvent.click(mounted.getByRole("button", { name: "Move primary down" }));
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    expect(mounted.getByText(/primary contestant model cannot receive image context/)).not.toBeNull();
    expect(bodies).toHaveLength(0);
    fireEvent.click(mounted.getByRole("button", { name: "Move fallback 1 up" }));
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    await waitFor(() => expect(pushed).toEqual(["/games/visual-route"]));
    expect((bodies[0]!.modelRouting as { defaultManifest: unknown[] }).defaultManifest).toHaveLength(3);
    expect(bodies[0]).not.toHaveProperty("providerManifest");
  });

  test("reports missing image-capable providers without submitting an empty route", async () => {
    installDom();
    const inventory = providerInventory();
    inventory.models = inventory.models.filter(model => !model.capabilities.supportsImageInput);
    let creates = 0;
    globalThis.fetch = (async (request) => {
      if (String(request).endsWith("/api/provider-models")) return jsonResponse(inventory);
      creates += 1;
      return jsonResponse({}, 500);
    }) as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await configureTextFallbacks(mounted);
    fireEvent.change(mounted.getByRole("combobox", { name: "Primary model" }), { target: { value: "katana:deepseek-v3" } });
    fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    fireEvent.click(mounted.getByRole("button", { name: /Create .* Game/ }));
    expect(mounted.getByText(/primary contestant model cannot receive image context/)).not.toBeNull();
    expect(creates).toBe(0);
  });

  test("changing a skipped slot to an image-capable model activates it", async () => {
    installDom();
    const inventory = providerInventory();
    inventory.models.push({ ...inventory.models[1]!, catalogId: "openai:gpt-5.6-luna", modelId: "gpt-5.6-luna", displayName: "OpenAI gpt-5.6-luna" });
    globalThis.fetch = (async () => jsonResponse(inventory)) as unknown as typeof fetch;
    const mounted = render(<CreateGameForm />);
    await configureTextFallbacks(mounted);
    fireEvent.click(mounted.getByRole("checkbox", { name: /Visual Mode/ }));
    fireEvent.change(mounted.getByRole("combobox", { name: "Fallback 1 model" }), { target: { value: "openai:gpt-5.6-luna" } });
    expect(mounted.container.querySelectorAll('[data-visual-skipped="true"]').length).toBe(1);
    expect((mounted.getByRole("spinbutton", { name: "Fallback 1 max calls per game" }) as HTMLInputElement).disabled).toBe(false);
  });

  test("shows Primary and fallbacks with approved models and Adaptive reasoning", async () => {
    installDom();
    globalThis.fetch = (async () => jsonResponse(providerInventory())) as unknown as typeof fetch;

    const mounted = render(<CreateGameForm />);
    await waitFor(() => expect(mounted.getByText("Provider route")).not.toBeNull());

    expect(mounted.getAllByText("Primary")[0]).not.toBeNull();
    expect(mounted.getAllByText("Fallback 1").length).toBeGreaterThan(0);
    expect(mounted.queryByText("Fallback 2")).toBeNull();
    expect(mounted.queryByText(/Mixed/)).toBeNull();
    expect(mounted.getAllByText("Adaptive").length).toBe(3);

    const routeSelectors = Array.from(mounted.container.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="model"]',
    ));
    expect(routeSelectors.map((select) => select.value)).toEqual([
      "openai:gpt-6-luna",
      "katana:grok-4-6",
      "openai:gpt-6-luna",
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
    expect((createBody.modelRouting as { defaultManifest: unknown }).defaultManifest).toEqual([
      { catalogId: "katana:grok-4-6", reasoningPolicy: "action-policy" },
      { catalogId: "openai:gpt-6-luna", reasoningPolicy: "medium", maxCallsPerGame: 12 },
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
    await waitFor(() => expect(within(mounted.getByRole("group", { name: "Round formats" })).getAllByRole("checkbox")).toHaveLength(7));
    expect(within(mounted.getByRole("group", { name: "Round formats" })).getAllByRole("checkbox").every((checkbox) => (
      checkbox.getAttribute("aria-checked") === "true"
    ))).toBe(true);

    fireEvent.click(mounted.getByRole("button", { name: "Only Highest Count" }));
    expect(mounted.getByRole("checkbox", { name: /Visual Mode/ }).hasAttribute("checked")).toBe(false);
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
    await waitFor(() => expect(within(mounted.getByRole("group", { name: "Round formats" })).getAllByRole("checkbox")).toHaveLength(7));
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
    expect((createBodies[0]?.modelRouting as { defaultManifest: unknown }).defaultManifest).toEqual([
      { catalogId: "openai:gpt-6-luna", reasoningPolicy: "medium" },
    ]);
  });

  test("keeps temporarily unlisted models selectable and constrains fallback caps", async () => {
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
    expect(glmOption?.disabled).toBe(false);

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
      supportsImageInput: false,
    },
    notes: null,
  };
  return {
    status: "complete",
    models: [
      {
        ...base,
        capabilities: { ...base.capabilities, supportsImageInput: true },
        catalogId: "katana:grok-4-6", providerProfileId: "katana", modelId: "grok-4-6",
        displayName: "xAI Grok 4.6", defaultReasoningPolicy: "action-policy",
        allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
      },
      {
        ...base,
        capabilities: { ...base.capabilities, supportsImageInput: true },
        catalogId: "openai:gpt-6-luna",
        providerProfileId: "openai",
        modelId: "gpt-6-luna",
        displayName: "OpenAI gpt-6-luna",
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

async function configureTextFallbacks(mounted: ReturnType<typeof render>) {
  await waitFor(() => expect(mounted.getAllByRole("option", { name: "Katana GLM 5.2" }).length).toBeGreaterThan(0));
  if (!mounted.queryByRole("combobox", { name: "Fallback 1 model" })) fireEvent.click(mounted.getByRole("button", { name: "+ Add fallback" }));
  fireEvent.change(mounted.getByRole("combobox", { name: "Fallback 1 model" }), { target: { value: "katana:glm-5-2" } });
  fireEvent.click(mounted.getByRole("button", { name: "+ Add fallback" }));
  fireEvent.change(mounted.getByRole("combobox", { name: "Fallback 2 model" }), { target: { value: "katana:grok-4-5" } });
}


test("Werewolf uses shared model/casting controls and submits configurable roles and automatic visuals",async()=>{
  installDom();
  const calls:Array<{url:string;body:Record<string,unknown>}>=[];
  globalThis.fetch=(async(request,init)=>{
    if(String(request).endsWith("/api/provider-models"))return jsonResponse(providerInventory());
    calls.push({url:String(request),body:JSON.parse(String(init?.body))});
    return jsonResponse({id:"wolf",slug:"custom-village"},201);
  }) as typeof fetch;
  const mounted=render(<CreateGameForm initialKind="werewolf"/>);
  await waitFor(()=>expect(mounted.getByRole("combobox",{name:"Primary model"})).not.toBeNull());
  fireEvent.click(mounted.getByRole("button",{name:"7"}));
  fireEvent.click(mounted.getByRole("button",{name:"2 wolves"}));
  fireEvent.click(mounted.getByRole("checkbox",{name:/Seer/i}));
  expect((mounted.getByRole("checkbox",{name:/Doctor/i}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(mounted.getByRole("button",{name:/Unlisted/i}));
  fireEvent.click(mounted.getByRole("checkbox",{name:/Visual Mode/}));
  expect(mounted.queryByText("Round formats")).toBeNull();
  fireEvent.click(mounted.getByRole("button",{name:"Create Werewolf Game"}));
  await waitFor(()=>expect(pushed).toEqual(["/games/custom-village"]));
  expect(calls[0]!.url).toContain("/api/werewolf/lobbies");
  expect(calls[0]!.body).toMatchObject({visibility:"unlisted",setup:{playerCount:7,wolves:2,seer:false,doctor:true},visualMode:true,fillStrategy:"balanced",modelRouting:{ defaultManifest:[{catalogId:"openai:gpt-6-luna",reasoningPolicy:"medium"},{catalogId:"katana:grok-4-6",reasoningPolicy:"action-policy",maxCallsPerGame:24}]}});
  expect((calls[0]!.body.personaPool as string[]).length).toBeGreaterThan(1);
  expect(calls[0]!.body).not.toHaveProperty("formatManifest");
});
