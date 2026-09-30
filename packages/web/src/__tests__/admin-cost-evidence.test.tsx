import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminGameCostDetail } from "../lib/api";
import { CostEvidence } from "../app/admin/cost-evidence";
const empty: AdminGameCostDetail = {
 gameId: "g", callCount:0, failedCallCount:0, unpricedCallCount:0, promptTokens:0, cachedTokens:0, completionTokens:0, reasoningTokens:0, totalTokens:0, actualCostMicrousd:0, estimatedCostMicrousd:0, costCurrency:"USD", costSourceCounts:{}, captureSourceCounts:{}, providerNativeTotals:{}, state:"no_calls", ownerEpochBreakdowns:[], breakdowns:{}, expensiveCalls:[], retryFailureSpend:{failedCallCount:0,retryCallCount:0,actualCostMicrousd:0,estimatedCostMicrousd:0}, backfill:{traceBackfilledEntries:0,terminalBackfilledEntries:0,hasTerminalAggregate:false}, pricing:{rateCardVersions:[],pricingSourceIds:[],pricedAt:[]}, reconciliation:[]
};
function html(change: Partial<AdminGameCostDetail>) { return renderToStaticMarkup(<CostEvidence detail={{...empty,...change}}/>); }
test("no calls, absent pricing and a recorded free call stay distinct", () => {
 expect(html({})).toContain("No provider calls recorded");
 expect(html({})).not.toContain("100%");
 expect(html({callCount:1, unpricedCallCount:1, costSourceCounts:{unavailable:1}})).toContain("Not reported");
 const free = html({callCount:1,costSourceCounts:{provider_actual:1}});
 expect(free).toContain("$0.0000"); expect(free).not.toContain("Not reported"); expect(free).toContain("Not estimated");
});
test("estimated and mixed totals do not double-count retries or imply a full ledger", () => {
 const estimated = html({callCount:1, estimatedCostMicrousd:500,costSourceCounts:{static_estimate:1}});
 expect(estimated).toContain("Not reported"); expect(estimated).toContain("$0.0005");
 const mixed = html({callCount:3,actualCostMicrousd:1200,estimatedCostMicrousd:300,unpricedCallCount:1,costSourceCounts:{provider_actual:1,catalog_estimate:1,unavailable:1},retryFailureSpend:{failedCallCount:1,retryCallCount:1,actualCostMicrousd:1200,estimatedCostMicrousd:300}});
 expect(mixed).toContain("$0.0012"); expect(mixed).toContain("$0.0003"); expect(mixed).not.toContain("$0.0015");
 expect(mixed).toContain("Already included in spending"); expect(mixed).toContain("Spending is incomplete"); expect(mixed).toContain("not a complete call ledger");
});
