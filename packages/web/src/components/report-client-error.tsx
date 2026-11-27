"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { getAnalyticsConsent } from "@/lib/analytics-consent";
import type { ErrorSource } from "@/lib/analytics-errors";
import { analyticsActive, captureProductException, subscribeAnalyticsActivity } from "@/lib/product-analytics";

/** Report only a currently displayed error after privacy/auth initialization. */
export function ReportClientError({ error, source }: { error: Error; source?: ErrorSource }) {
  const active = useSyncExternalStore(subscribeAnalyticsActivity, analyticsActive, () => false);
  const observed = useRef<{ error: Error; revision: number; eligible: boolean; reported: boolean } | null>(null);
  useEffect(() => {
    const consent = getAnalyticsConsent();
    if (observed.current?.error !== error) {
      observed.current = {
        error, revision: consent.choiceRevision, eligible: !consent.ready || consent.analytics, reported: false,
      };
    }
    const boundary = observed.current;
    if (!active || !boundary.eligible || boundary.reported || boundary.revision !== consent.choiceRevision) return;
    captureProductException(error, source);
    boundary.reported = true;
  }, [active, error, source]);
  return null;
}
