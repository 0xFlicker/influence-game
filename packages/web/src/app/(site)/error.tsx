"use client";

import Link from "next/link";
import { ReportClientError } from "@/components/report-client-error";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <ReportClientError error={error} />
      <h1 className="text-2xl font-bold text-text-primary">We couldn&apos;t load this page.</h1>
      <p className="influence-copy-muted mt-3">Try again or return to the game list.</p>
      <div className="mt-6 flex justify-center gap-4">
        <button className="influence-button-primary rounded-lg px-5 py-2" onClick={reset}>Try again</button>
        <Link className="influence-button-secondary rounded-lg px-5 py-2" href="/games">Browse games</Link>
      </div>
    </main>
  );
}
