"use client";
import { useSyncExternalStore } from "react";
import { analyticsDisabled, setAnalyticsDisabled } from "@/lib/product-analytics";

const subscribe = () => () => {};
export function AnalyticsPreference() {
  const disabled = useSyncExternalStore(subscribe, analyticsDisabled, () => true);
  return <button type="button" className="influence-link" onClick={() => setAnalyticsDisabled(!disabled)}>
    {disabled ? "Enable optional analytics on this browser" : "Disable optional analytics on this browser"}
  </button>;
}
