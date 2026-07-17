"use client";

import Link from "next/link";
import { Nav } from "@/components/nav";

export default function PublicPlayerProfileError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      <Nav />
      <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 items-center px-4 py-8 sm:px-6 sm:py-10">
        <section className="influence-panel mx-auto w-full max-w-xl rounded-xl p-6 text-center sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-phase">
            Profile unavailable
          </p>
          <h1 className="mt-2 text-2xl font-bold text-text-primary">
            We couldn&apos;t load this profile.
          </h1>
          <p className="influence-copy-muted mt-3 text-sm leading-6">
            Influence hit a temporary problem. Try the request again or return
            to the public game list.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={reset}
              className="influence-button-primary inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold"
            >
              Try again
            </button>
            <Link
              href="/games"
              className="influence-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold"
            >
              Browse games
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
