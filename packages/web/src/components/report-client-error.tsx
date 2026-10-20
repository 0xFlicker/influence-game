"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { analyticsActive, captureProductException, subscribeAnalyticsActivity } from "@/lib/product-analytics";

/** Report only a currently displayed error after privacy/auth initialization. */
export function ReportClientError({ error }: { error: Error }) {
  const active = useSyncExternalStore(subscribeAnalyticsActivity, analyticsActive, () => false);
  const reported = useRef<Error | null>(null);
  useEffect(() => {
    if (!active || reported.current === error) return;
    captureProductException(error);
    reported.current = error;
  }, [active, error]);
  return null;
}
