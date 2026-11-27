/* eslint-disable @next/next/no-html-link-for-pages -- Home links must work even if the app router failed. */
"use client";

import { errorDigest } from "@influence/engine/operational-errors";
import { ReportClientError } from "@/components/report-client-error";
import { FALSE_FLOOR, HOUSE_DISCORD_URL, HOUSE_VENUE } from "@/lib/product-identity";
import { globalErrorStyles } from "./global-error-styles";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  function retry() {
    // A server-render error needs a fresh request. A client error can reset in place.
    if (errorDigest(error)) window.location.reload();
    else reset();
  }

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | The House</title>
        <style>{globalErrorStyles}</style>
      </head>
      <body className="house-error-page">
        <ReportClientError error={error} source="root_boundary" />
        <div className="house-error-shell">
          <header className="house-error-brand">
            <a href="/" aria-label="The House home">{HOUSE_VENUE.name}</a>
          </header>
          <main className="house-error-stage" aria-labelledby="house-error-heading">
            <div className="house-error-portrait">
              {/* The fallback uses a static file instead of the Next.js image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/error/house-host-curious.webp" width={1200} height={1200} alt="" />
            </div>
            <div className="house-error-content">
              <div role="alert">
                <h1 id="house-error-heading">The House hit a snag.</h1>
                <p className="house-error-lead">Something went wrong while loading this page.</p>
              </div>
              <blockquote className="house-error-message">
                <span className="house-error-speaker">The Host</span>
                <p>
                  <strong aria-hidden="true">#^$%$!</strong>
                  <span className="house-error-sr-only">Censored exclamation.</span>
                  {" "}That definitely wasn’t in the script.
                </p>
              </blockquote>
              <div className="house-error-actions">
                <button type="button" onClick={retry}>Try again</button>
                <a href="/">Back to home</a>
              </div>
              <footer className="house-error-help">
                <span>Still stuck?</span>
                <a href={`mailto:${FALSE_FLOOR.supportEmail}`}>Email support</a>
                <a href={HOUSE_DISCORD_URL}>Join Discord <span aria-hidden="true">↗</span></a>
              </footer>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
