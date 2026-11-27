"use client";

import { ReportClientError } from "@/components/report-client-error";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ReportClientError error={error} source="root_boundary" />
        <main role="alert">
          <h1>We couldn’t load The House.</h1>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
