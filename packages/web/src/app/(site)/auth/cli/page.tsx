import type { Metadata } from "next";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
import { getPublicRuntimeConfig } from "@/lib/server-runtime-config";
import { resolveServerApiUrl } from "@/lib/server-api";
import { CliSessionClient } from "@/app/auth/cli/cli-session-client";
import { authorizeCliSessionTarget, cliRequestWebOrigin, type CliSessionQuery } from "@/app/auth/cli/target";

export const metadata: Metadata = { title: "Authorize local CLI — The House", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function CliSessionPage({ searchParams }: { searchParams: Promise<CliSessionQuery> }) {
  let request;
  try {
    request = authorizeCliSessionTarget(await searchParams, {
      webOrigin: cliRequestWebOrigin(await headers(), process.env.WEB_BASE_URL),
      publicApiUrl: getPublicRuntimeConfig().API_URL,
      backendAuthUrl: resolveServerApiUrl("/api/auth/me"),
    });
  } catch (error) {
    return <div className="influence-page flex min-h-screen flex-col"><Nav />
      <main className="mx-auto w-full max-w-xl px-6 py-16"><section className="influence-panel space-y-4 rounded-xl p-8">
        <h1 className="influence-phase-title text-3xl font-bold">CLI sign-in unavailable</h1>
        <p role="alert" className="influence-copy">{error instanceof Error ? error.message : "This CLI sign-in request could not be verified. Restart the CLI."}</p>
      </section></main>
    </div>;
  }
  return <div className="influence-page flex min-h-screen flex-col"><Nav /><CliSessionClient request={request} /></div>;
}
