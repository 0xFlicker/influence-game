import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MODEL_REASONING_POLICIES, modelCatalogEntryById } from "@influence/engine/model-catalog";
import type { ProviderModelInventoryEntry } from "@/lib/api";
import { InfluenceAuthContext, type InfluenceAuthState } from "@/hooks/use-auth";
import { ProviderRouteEditor } from "@/app/admin/games/new/create-game-form";
import { ModelPreferencePicker } from "./model-preference-picker";

const auth = { account: { id: "admin", roles: ["admin"] } } as InfluenceAuthState;
function inventory(catalogId: string): ProviderModelInventoryEntry {
  const model = modelCatalogEntryById(catalogId)!;
  return { ...model, catalogId, configured: true, available: true,
    experimental: model.evaluationStatus !== "game-ready",
    allowedReasoningPolicies: MODEL_REASONING_POLICIES.filter(policy => policy === "action-policy" || model.allowedReasoningEfforts.includes(policy)),
    notes: "Experimental model. Capabilities are inferred, pricing may be unknown; exact strict JSON responses remain required.",
  };
}

test("character, House and fallback controls show the same readable price without developer notes", () => {
  const model = inventory("katana:kimi-k3");
  const picker = renderToStaticMarkup(<InfluenceAuthContext.Provider value={auth}>
    <ModelPreferencePicker value={{ catalogId: model.catalogId }} inventory={[model]} onChange={() => {}} />
  </InfluenceAuthContext.Provider>);
  const entries = [{ catalogId: model.catalogId, uiId: "primary", reasoningPolicy: "action-policy" as const }];
  const route = renderToStaticMarkup(<ProviderRouteEditor labelPrefix="House " entries={entries} activeRoute={entries}
    models={[{ ...model, supportsImageInput: model.capabilities.supportsImageInput }]} visualMode={false} onChange={() => {}} />);
  const fallbackEntries = [{ catalogId: "openai:gpt-6-luna", uiId: "primary", reasoningPolicy: "action-policy" as const },
    { ...entries[0]!, uiId: "fallback", maxCallsPerGame: 5 }];
  const fallback = renderToStaticMarkup(<ProviderRouteEditor entries={fallbackEntries} activeRoute={fallbackEntries}
    models={[model]} visualMode={false} onChange={() => {}} />);
  for (const html of [picker, route, fallback]) {
    expect(html).toContain("$0.244 input / $11.016 output per 1M tokens (USD)");
    expect(html).not.toMatch(/Experimental|inferred|strict JSON|pricing may be unknown|999999/);
  }
});

test("catalog pricing is available before discovery and unknown models stay unpriced", () => {
  for (const [catalogId, expected] of [["openai:gpt-6-luna", "$0.05 input / $0.25 output"], ["openai:gpt-6.1-sol", "$2.00 input / $10.00 output"], ["katana:unlisted-example", "Pricing unavailable"]]) {
    const html = renderToStaticMarkup(<InfluenceAuthContext.Provider value={auth}>
      <ModelPreferencePicker value={{ catalogId: catalogId! }} inventory={[]} onChange={() => {}} />
    </InfluenceAuthContext.Provider>);
    expect(html).toContain(expected!);
    expect(html).not.toMatch(/Experimental|inferred|strict JSON/);
  }
});
