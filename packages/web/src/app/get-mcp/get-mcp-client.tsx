"use client";

import Link from "next/link";
import { useRuntimeConfig } from "@/lib/runtime-config";
import {
  buildMcpSetupClients,
  getMcpResourceUrl,
  type McpSetupClient,
} from "@/lib/mcp-setup";
import {
  ACTIVE_GAME,
  HOUSE_VENUE,
} from "@/lib/product-identity";
import { CopyCommandButton } from "./copy-command-button";

interface GetMcpSetupContentProps {
  mcpUrl: string;
  clients?: McpSetupClient[];
}

export function GetMcpSetupContent({
  mcpUrl,
  clients = buildMcpSetupClients(mcpUrl),
}: GetMcpSetupContentProps) {
  return (
    <main className="relative flex-1 overflow-x-hidden bg-[rgb(var(--void))] px-4 py-8 text-[rgb(var(--text-primary))] sm:px-6 sm:py-10 lg:px-8">
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      <section className="relative z-10 mx-auto w-full max-w-6xl min-w-0">
        <div className="min-w-0">
          <p className="influence-section-title">Games MCP</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl lg:text-5xl">
            Connect {HOUSE_VENUE.name} to your AI.
          </h1>
          <p className="influence-copy mt-5 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8">
            Add the player-facing MCP endpoint once, approve access in the browser,
            and let your AI inspect your {ACTIVE_GAME.name} games,
            agents, and rules.
          </p>

          <div className="mt-7 max-w-3xl space-y-3 text-sm leading-6 sm:text-base sm:leading-7">
            <p className="influence-copy">
              The MCP endpoint is{" "}
              <span className="inline-flex max-w-full flex-wrap items-center gap-2 align-middle">
                <code className="max-w-full overflow-x-auto rounded border border-border-active/45 bg-black/30 px-1.5 py-0.5 font-mono text-sm text-text-primary">
                  {mcpUrl}
                </code>
                <CopyCommandButton
                  command={mcpUrl}
                  title="Copy MCP endpoint"
                  className="rounded border border-border-active/45 bg-surface-raised/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-border-active hover:text-text-primary"
                />
              </span>
            </p>
          </div>

          <div className="mt-8 grid min-w-0 gap-4">
            {clients.map((client) => (
              <article key={client.id} className="influence-panel min-w-0 overflow-hidden rounded-xl p-4 sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-text-primary">{client.name}</h2>
                  </div>
                  <span className="influence-chip w-fit px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                    HTTP MCP
                  </span>
                </div>

                <div className="mt-5 min-w-0 space-y-3">
                  {client.commands.map((command) => (
                    <div
                      key={command}
                      className="grid min-w-0 gap-3 rounded-lg border border-border-active/50 bg-black/35 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <code className="block max-w-full min-w-0 overflow-x-auto whitespace-pre rounded-md font-mono text-xs leading-6 text-text-primary sm:text-sm">
                        {command}
                      </code>
                      <CopyCommandButton command={command} />
                    </div>
                  ))}
                  {client.steps && client.steps.length > 0 ? (
                    <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-text-secondary sm:text-base sm:leading-7">
                      {client.steps.map((step) => (
                        <li key={step} className="min-w-0 pl-1">
                          <span className="text-text-primary">{step}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>

                <p className="influence-copy-muted mt-4 text-xs leading-5">
                  {client.authHint}
                </p>
              </article>
            ))}
          </div>

          <Link href="/dashboard" className="influence-link mt-6 inline-block text-sm">
            Back to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}

export function GetMcpClient() {
  const runtimeConfig = useRuntimeConfig();
  const browserOrigin =
    typeof window === "undefined" ? undefined : window.location.origin;
  const mcpUrl = getMcpResourceUrl(runtimeConfig.API_URL, browserOrigin);

  return (
    <GetMcpSetupContent
      mcpUrl={mcpUrl}
    />
  );
}
