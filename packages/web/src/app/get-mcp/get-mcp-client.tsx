"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useE2EAuth } from "@/app/providers";
import { useRuntimeConfig } from "@/lib/runtime-config";
import {
  buildMcpSetupClients,
  getMcpResourceUrl,
  type McpSetupClient,
} from "@/lib/mcp-setup";
import { CopyCommandButton } from "./copy-command-button";

interface GetMcpSetupContentProps {
  mcpUrl: string;
  clients?: McpSetupClient[];
  authReady: boolean;
  authenticated: boolean;
  onSignIn?: () => void;
}

export function GetMcpSetupContent({
  mcpUrl,
  clients = buildMcpSetupClients(mcpUrl),
  authReady,
  authenticated,
  onSignIn,
}: GetMcpSetupContentProps) {
  return (
    <main className="relative flex-1 overflow-x-hidden bg-[rgb(var(--void))] px-4 py-8 text-[rgb(var(--text-primary))] sm:px-6 sm:py-10 lg:px-8">
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      <section className="relative z-10 mx-auto w-full max-w-6xl min-w-0">
        <div className="min-w-0">
          <p className="influence-section-title">Games MCP</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl lg:text-5xl">
            Connect your Influence games to Codex or Claude Code
          </h1>
          <p className="influence-copy mt-5 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8">
            Add the player-facing MCP endpoint once, approve access in the browser,
            and let your AI coding client read the Influence games tied to your account.
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
              . Authorization happens in your browser when the client starts OAuth.
            </p>
            {authenticated ? (
              <p className="influence-copy-muted">
                You are signed in. Run the command for your client, approve the
                browser prompt, then restart Codex or Claude Code so the new tools
                are loaded.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="influence-copy-muted">
                  You can read these commands now, but sign in before completing
                  the OAuth-backed setup. After install, restart Codex or Claude
                  Code so the new tools are loaded.
                </p>
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={!authReady || !onSignIn}
                  className="influence-button-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Sign in
                </button>
              </div>
            )}
          </div>

          <div className="mt-8 grid min-w-0 gap-4">
            {clients.map((client) => (
              <article key={client.id} className="influence-panel min-w-0 overflow-hidden rounded-xl p-4 sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-text-primary">{client.name}</h2>
                    <p className="influence-copy mt-1 text-sm">{client.summary}</p>
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
                </div>

                {client.refreshCommands ? (
                  <div className="mt-4 min-w-0 space-y-2">
                    <p className="influence-copy-muted text-xs leading-5">
                      If the token expires, refresh it with:
                    </p>
                    {client.refreshCommands.map((command) => (
                      <div
                        key={command}
                        className="grid min-w-0 gap-3 rounded-lg border border-border-active/40 bg-black/25 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <code className="block max-w-full min-w-0 overflow-x-auto whitespace-pre rounded-md font-mono text-xs leading-6 text-text-primary sm:text-sm">
                          {command}
                        </code>
                        <CopyCommandButton command={command} />
                      </div>
                    ))}
                  </div>
                ) : null}

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
  const e2e = useE2EAuth();
  const { ready, authenticated, login } = usePrivy();
  const authReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;
  const browserOrigin =
    typeof window === "undefined" ? undefined : window.location.origin;
  const mcpUrl = getMcpResourceUrl(runtimeConfig.API_URL, browserOrigin);

  return (
    <GetMcpSetupContent
      mcpUrl={mcpUrl}
      authReady={authReady}
      authenticated={effectiveAuth}
      onSignIn={login}
    />
  );
}
