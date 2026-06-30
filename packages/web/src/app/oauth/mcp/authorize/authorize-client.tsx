"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useE2EAuth } from "@/app/providers";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ApiError,
  authorizeMcpOAuth,
  type McpOAuthAuthorizePreview,
  type McpOAuthDecision,
  type McpOAuthScope,
  type McpOAuthScopePreview,
} from "@/lib/api";
import {
  parseMcpOAuthSearchParams,
  type McpOAuthAuthorizeRequest,
} from "@/lib/mcp-oauth";

type FlowState =
  | { kind: "checking" }
  | { kind: "signin" }
  | { kind: "invalid"; message: string; details?: string; redirectTo?: string }
  | { kind: "ready"; preview: McpOAuthAuthorizePreview }
  | { kind: "denied"; message: string; redirectTo?: string }
  | { kind: "error"; message: string; redirectTo?: string }
  | { kind: "redirecting"; label: string };

export function McpOAuthAuthorizeClient() {
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const parsed = useMemo(
    () => parseMcpOAuthSearchParams(new URLSearchParams(searchKey)),
    [searchKey],
  );

  const e2e = useE2EAuth();
  const { ready, authenticated, login } = usePrivy();
  const { loading: permissionsLoading, user, authError } = usePermissions();
  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  const [flow, setFlow] = useState<FlowState>({ kind: "checking" });
  const [submitting, setSubmitting] = useState<McpOAuthDecision | null>(null);

  useEffect(() => {
    if (!parsed.ok) {
      setFlow({
        kind: "invalid",
        message: parsed.message,
        details: parsed.missing.length > 0
          ? `Missing: ${parsed.missing.join(", ")}`
          : undefined,
      });
      return;
    }

    if (!effectiveReady) {
      setFlow({ kind: "checking" });
      return;
    }

    if (!effectiveAuth) {
      setFlow({ kind: "signin" });
      return;
    }

    if (permissionsLoading || (!user && !authError)) {
      setFlow({ kind: "checking" });
      return;
    }

    if (authError) {
      setFlow({ kind: "signin" });
      return;
    }

    let cancelled = false;
    setFlow({ kind: "checking" });
    authorizeMcpOAuth(parsed.request, "inspect")
      .then((result) => {
        if (cancelled) return;
        if ("redirectTo" in result) {
          setFlow({
            kind: "error",
            message: "The authorization request returned a redirect before approval.",
            redirectTo: result.redirectTo,
          });
          return;
        }
        setFlow({ kind: "ready", preview: result });
      })
      .catch((err) => {
        if (cancelled) return;
        const parsedError = parseApiError(err);
        if (err instanceof ApiError && err.status === 403) {
          setFlow({
            kind: "denied",
            message: parsedError.message,
            redirectTo: parsedError.redirectTo,
          });
          return;
        }
        setFlow({
          kind: err instanceof ApiError && err.status === 400 ? "invalid" : "error",
          message: parsedError.message,
          redirectTo: parsedError.redirectTo,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [parsed, effectiveReady, effectiveAuth, permissionsLoading, user, authError]);

  const submitDecision = useCallback(async (
    request: McpOAuthAuthorizeRequest,
    decision: Exclude<McpOAuthDecision, "inspect">,
    selectedScopes?: McpOAuthScope[],
  ) => {
    setSubmitting(decision);
    setFlow({
      kind: "redirecting",
      label: decision === "approve" ? "Approving..." : "Returning...",
    });

    try {
      const result = await authorizeMcpOAuth(request, decision, selectedScopes);
      if (!("redirectTo" in result)) {
        setFlow({
          kind: "error",
          message: "The authorization server did not return a redirect.",
        });
        return;
      }
      window.location.assign(result.redirectTo);
    } catch (err) {
      const parsedError = parseApiError(err);
      setFlow({
        kind: "error",
        message: parsedError.message,
        redirectTo: parsedError.redirectTo,
      });
    } finally {
      setSubmitting(null);
    }
  }, []);

  return (
    <main className="min-h-screen bg-[rgb(var(--void))] px-4 py-10 text-[rgb(var(--text-primary))]">
      <section className="mx-auto flex min-h-[72vh] max-w-2xl items-center justify-center">
        <div className="influence-panel w-full rounded-lg p-6 shadow-2xl sm:p-8">
          <div className="mb-6 border-b border-[rgb(var(--border-active)/0.5)] pb-5">
            <p className="influence-section-title">OAuth Authorization</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal text-[rgb(var(--text-primary))]">
              Game MCP Access
            </h1>
          </div>

          {flow.kind === "checking" && <StatusMessage message="Checking authorization..." />}

          {flow.kind === "signin" && (
            <div className="space-y-5">
              <p className="influence-copy">
                Sign in to continue the Game MCP authorization flow.
              </p>
              <button
                type="button"
                onClick={login}
                className="influence-button-primary rounded-lg px-5 py-2 text-sm font-medium"
              >
                Sign in
              </button>
            </div>
          )}

          {flow.kind === "invalid" && (
            <ProblemState
              title="Invalid OAuth Request"
              message={flow.message}
              details={flow.details}
              redirectTo={flow.redirectTo}
            />
          )}

          {flow.kind === "denied" && (
            <ProblemState
              title={parsed.ok && isProducerAuthorizationRequest(parsed.request)
                ? "MCP Role Required"
                : "Authorization Denied"}
              message={flow.message}
              redirectTo={flow.redirectTo}
            />
          )}

          {flow.kind === "error" && (
            <ProblemState
              title="Authorization Error"
              message={flow.message}
              redirectTo={flow.redirectTo}
            />
          )}

          {flow.kind === "redirecting" && <StatusMessage message={flow.label} />}

          {flow.kind === "ready" && parsed.ok && (
            <ConsentDetails
              preview={flow.preview}
              displayName={user?.displayName}
              walletAddress={user?.walletAddress}
              submitting={submitting}
              onDecision={(decision, selectedScopes) =>
                submitDecision(parsed.request, decision, selectedScopes)}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function isProducerAuthorizationRequest(request: McpOAuthAuthorizeRequest): boolean {
  if (!request.scope.split(/\s+/).includes("producer")) return false;
  if (!request.resource) return true;
  try {
    return new URL(request.resource).pathname === "/mcp";
  } catch {
    return false;
  }
}

function ConsentDetails({
  preview,
  displayName,
  walletAddress,
  submitting,
  onDecision,
}: {
  preview: McpOAuthAuthorizePreview;
  displayName?: string | null;
  walletAddress?: string | null;
  submitting: McpOAuthDecision | null;
  onDecision: (
    decision: Exclude<McpOAuthDecision, "inspect">,
    selectedScopes?: McpOAuthScope[],
  ) => void;
}) {
  const [selectedScopes, setSelectedScopes] = useState<McpOAuthScope[]>(
    preview.selectedScopes.length > 0
      ? preview.selectedScopes
      : preview.defaultSelectedScopes,
  );
  const selectedSet = useMemo(() => new Set(selectedScopes), [selectedScopes]);
  const selectedScopeText = selectedScopes.join(" ");
  const grantableGroups = useMemo(() => ({
    agents: preview.grantableScopes.filter((scope) => scope.group === "agents"),
    games: preview.grantableScopes.filter((scope) => scope.group === "games"),
    developer: preview.grantableScopes.filter((scope) => scope.group === "developer"),
  }), [preview.grantableScopes]);

  const toggleScope = useCallback((scope: McpOAuthScope, checked: boolean) => {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(scope);
        const definition = preview.grantableScopes.find((entry) => entry.scope === scope);
        for (const requiredScope of definition?.requiredScopes ?? []) {
          next.add(requiredScope);
        }
      } else {
        next.delete(scope);
        for (const entry of preview.grantableScopes) {
          if (entry.requiredScopes.includes(scope)) {
            next.delete(entry.scope);
          }
        }
      }
      return preview.grantableScopes
        .map((entry) => entry.scope)
        .filter((entry) => next.has(entry));
    });
  }, [preview.grantableScopes]);

  const canApprove = selectedScopes.length > 0 && submitting === null;

  return (
    <div className="space-y-6">
      <dl className="grid gap-3 rounded-lg border border-[rgb(var(--border-active)/0.5)] bg-[rgb(var(--surface-raised)/0.42)] p-4 text-sm sm:grid-cols-2">
        <Detail label="Signed in as" value={displayName ?? walletAddress ?? "Current user"} />
        <Detail label="Wallet" value={walletAddress ?? "No wallet"} />
        <Detail label="Client" value={preview.clientId} />
        <Detail label="Selected scopes" value={selectedScopeText || "None selected"} />
        <Detail label="Resource" value={preview.resource} wide />
        <Detail label="Redirect" value={preview.redirectUri} wide />
      </dl>

      <div className="space-y-4">
        {grantableGroups.agents.length > 0 && (
          <ScopeGroup
            title="Agents"
            scopes={grantableGroups.agents}
            selectedSet={selectedSet}
            disabled={submitting !== null}
            onToggle={toggleScope}
          />
        )}
        {grantableGroups.games.length > 0 && (
          <ScopeGroup
            title="Games"
            scopes={grantableGroups.games}
            selectedSet={selectedSet}
            disabled={submitting !== null}
            onToggle={toggleScope}
          />
        )}
        {grantableGroups.developer.length > 0 && (
          <ScopeGroup
            title="Developer access"
            scopes={grantableGroups.developer}
            selectedSet={selectedSet}
            disabled={submitting !== null}
            onToggle={toggleScope}
          />
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => onDecision("cancel")}
          disabled={submitting !== null}
          className="influence-button-quiet rounded-lg px-4 py-2 text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onDecision("deny")}
          disabled={submitting !== null}
          className="influence-button-secondary rounded-lg px-4 py-2 text-sm font-medium"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => onDecision("approve", selectedScopes)}
          disabled={!canApprove}
          className="influence-button-primary rounded-lg px-5 py-2 text-sm font-medium"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function ScopeGroup({
  title,
  scopes,
  selectedSet,
  disabled,
  onToggle,
}: {
  title: string;
  scopes: McpOAuthScopePreview[];
  selectedSet: Set<McpOAuthScope>;
  disabled: boolean;
  onToggle: (scope: McpOAuthScope, checked: boolean) => void;
}) {
  return (
    <section className="rounded-lg border border-[rgb(var(--border-active)/0.45)] bg-[rgb(var(--surface-raised)/0.28)] p-4">
      <h2 className="text-sm font-semibold text-[rgb(var(--text-primary))]">
        {title}
      </h2>
      <div className="mt-3 space-y-3">
        {scopes.map((scope) => (
          <label
            key={scope.scope}
            className="grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded-md p-2 transition hover:bg-[rgb(var(--surface-raised)/0.4)]"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(scope.scope)}
              disabled={disabled}
              onChange={(event) => onToggle(scope.scope, event.target.checked)}
              className="mt-1 h-4 w-4 accent-[rgb(var(--accent-rgb))]"
            />
            <span>
              <span className="block text-sm font-medium text-[rgb(var(--text-primary))]">
                {scope.label}
              </span>
              <span className="mt-1 block text-sm leading-5 text-[rgb(var(--text-secondary))]">
                {scope.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function Detail({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="influence-copy-muted text-xs uppercase tracking-[0.12em]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-[rgb(var(--text-primary)/0.94)]">
        {value}
      </dd>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center">
      <p className="influence-copy-muted text-sm">{message}</p>
    </div>
  );
}

function ProblemState({
  title,
  message,
  details,
  redirectTo,
}: {
  title: string;
  message: string;
  details?: string;
  redirectTo?: string;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[rgb(var(--danger-rgb)/0.34)] bg-[rgb(var(--danger-rgb)/0.08)] p-4">
        <h2 className="text-base font-semibold text-[rgb(var(--text-primary))]">
          {title}
        </h2>
        <p className="mt-2 influence-copy text-sm">{message}</p>
        {details ? <p className="mt-2 influence-copy-muted text-xs">{details}</p> : null}
      </div>

      {redirectTo ? (
        <button
          type="button"
          onClick={() => window.location.assign(redirectTo)}
          className="influence-button-secondary rounded-lg px-4 py-2 text-sm font-medium"
        >
          Return
        </button>
      ) : null}
    </div>
  );
}

function parseApiError(err: unknown): { message: string; redirectTo?: string } {
  if (!(err instanceof ApiError)) {
    return { message: err instanceof Error ? err.message : "Unexpected authorization error." };
  }

  try {
    const body = JSON.parse(err.message) as {
      error?: unknown;
      error_description?: unknown;
      redirectTo?: unknown;
    };
    return {
      message:
        typeof body.error_description === "string"
          ? body.error_description
          : typeof body.error === "string"
            ? body.error
            : "Authorization request failed.",
      redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : undefined,
    };
  } catch {
    return { message: err.message };
  }
}
