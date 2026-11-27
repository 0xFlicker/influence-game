import { loadAnalyticsConsent } from "./lib/analytics-consent";
import { analyticsExcludedPath, captureProductException } from "./lib/product-analytics";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event: Event) => {
    if (event instanceof ErrorEvent) {
      captureProductException(event.error ?? event.message, "window_error", {
        filename: event.filename, lineno: event.lineno, colno: event.colno,
      });
    } else if (event.target instanceof HTMLScriptElement &&
      event.target.src.startsWith(location.origin + "/_next/static/")) {
      captureProductException("Loading chunk failed", "window_error");
    }
  }, true);
  window.addEventListener("unhandledrejection", event => {
    captureProductException(event.reason, "unhandled_rejection");
  });
  if (!analyticsExcludedPath(location.pathname)) void loadAnalyticsConsent();
}
