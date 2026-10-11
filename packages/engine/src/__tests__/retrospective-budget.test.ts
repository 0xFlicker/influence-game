import { expect, test } from "bun:test";
import { forecastRetrospectiveBudget } from "../retrospective-budget";

test("retrospective forecasts retain shared fallback caps and account for every original seat and growing priors", () => {
  const route = [{ catalogId: "primary" }, { catalogId: "fallback", maxCallsPerGame: 4 }];
  const influence = forecastRetrospectiveBudget("influence", 6, route), wolf = forecastRetrospectiveBudget("werewolf", 6, route);
  expect(influence.requiredSpeechCalls).toBe(6);
  expect(influence.entries).toEqual([{ catalogId: "primary", maxRetrospectiveDispatches: 12, sharedGameDispatchCap: null },
    { catalogId: "fallback", maxRetrospectiveDispatches: 4, sharedGameDispatchCap: 4 }]);
  expect(wolf.entries[0]!.maxRetrospectiveDispatches).toBe(18);
  expect(wolf.maxAccumulatedPriorSpeechTextBytes).toBeGreaterThan(forecastRetrospectiveBudget("werewolf", 3, route).maxAccumulatedPriorSpeechTextBytes * 2);
  expect(route[1]!.maxCallsPerGame).toBe(4);
  expect(() => forecastRetrospectiveBudget("influence", 13, route)).toThrow();
});
