---
title: Production Game MCP Raw Trace Reads Need Developer-Sized Response Limits
date: 2026-06-19
category: runtime-errors
module: api Production Game MCP private trace tools
problem_type: runtime_error
component: tooling
symptoms:
  - "read_trace_content returned byte-limit failures for real private trace objects"
  - "Every trace appeared unloadable even though the MCP request body itself was small"
  - "The /mcp request body guard looked related but was not the failing limit"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [production-game-mcp, private-traces, mcp, maxbytes, response-limits, oauth]
related_components: [durable-runs, private-content-storage, trace-mcp]
---

# Production Game MCP Raw Trace Reads Need Developer-Sized Response Limits

## Problem

Production Game MCP exposes explicit private trace tools behind the global `scope=mcp` developer gate. The initial raw trace read guard was sized like a small API payload, so `read_trace_content` could authorize and locate trace manifests but still fail before returning any useful raw trace content.

The fix is to treat raw trace content as a bounded tool response, not as an incoming `/mcp` request body.

## Symptoms

- `read_trace_content` failed on normal private trace artifacts with an error shaped like `Private trace object exceeds ... byte read limit`.
- The visible question became "what is your body response limit?" because every real trace looked too large to load.
- The `/mcp` HTTP route still had a 1 MiB POST body guard, but tool calls only send small JSON-RPC arguments. That guard was not the limit breaking raw trace reads.

## What Didn't Work

- Assuming empty trace results always meant the byte guard was wrong. Some test runs had no private trace manifests, and missing `LINODE_PRIVATE_CONTENT_*` env vars can leave the API with no private trace corpus until restart. Check manifests and storage configuration first. (session history)
- Treating a small `maxBytes` as a preview-size control. A local check proved a trace object around 78 KiB failed under a 512 byte cap, then succeeded with a larger `maxBytes`; storage and manifest lookup were working. (session history)
- Treating the `/mcp` request body limit as the answer. The route-level guard protects incoming client POST bodies and should stay small because MCP tool arguments are tiny.
- Keeping raw trace defaults in the low KiB range. That made the safety guard technically present but operationally useless for developer inspection.
- Exposing search scan byte caps as public tool arguments. The search tool should expose result count and filters; object scan bounds are server-owned safety controls, not a client-facing tuning surface. Adding skip diagnostics made failures visible, but it did not fix the UX because callers could still set a misleading cap too low. (session history)

## Solution

Keep the HTTP route request guard separate from trace response/content bounds:

```ts
// packages/api/src/routes/mcp.ts
const DEFAULT_MAX_POST_BYTES = 1024 * 1024;
```

That limit applies to incoming JSON-RPC request bodies. Do not use it to reason about how large a tool response can be.

For raw private trace reads, size the `ProductionGameMcpReadModel` guard for real developer artifacts:

```ts
// packages/api/src/game-mcp/read-model.ts
const DEFAULT_TRACE_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_CONTENT_BYTES = 64 * 1024 * 1024;

// ...
maxBytes: clamp(params.maxBytes ?? DEFAULT_TRACE_CONTENT_BYTES, 1, MAX_TRACE_CONTENT_BYTES),
```

The lower-level private trace read model should still reject objects before downloading when storage metadata proves the object is larger than the read limit:

```ts
// packages/api/src/services/private-trace-read-model.ts
if (params.maxBytes !== undefined && head.contentLength !== undefined && head.contentLength > params.maxBytes) {
  return {
    ok: false,
    status: "storage_error",
    error: `Private trace object exceeds ${params.maxBytes} byte read limit`,
  };
}
```

For trace search, keep the production MCP schema focused on filters and result count:

```ts
// packages/api/src/game-mcp/server.ts
if (name === "search_reasoning_traces") {
  return content(await this.readModel.searchReasoningTraces({
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    query: requiredString(args, "query"),
    actor: optionalString(args, "actor"),
    action: optionalString(args, "action"),
    phase: optionalString(args, "phase"),
    limit: optionalNumber(args, "limit"),
  }));
}
```

The production server should not advertise `maxBytesPerObject` on `search_reasoning_traces`, and it should ignore that argument if an older or hallucinated client still sends it. The public control is `limit`; scan/read byte ceilings stay internal unless there is a concrete operator workflow that needs to tune them.

Then document the contract where developers look for MCP setup:

```md
read_trace_content defaults to an 8 MiB raw trace read limit and clamps
tool-supplied maxBytes at 64 MiB. These are response-content bounds,
separate from the /mcp request body limit.
```

## Why This Works

The request and response paths have different risk profiles.

The `/mcp` POST body limit prevents a client from sending oversized JSON-RPC request payloads. For this server, those payloads should be compact method names and tool arguments.

`read_trace_content` is different: the client asks for one explicitly selected private evidence manifest, and the server returns raw JSON/JSONL producer evidence. Those artifacts are naturally larger than JSON-RPC arguments. Keeping a content bound is still correct, but the default has to be large enough to load realistic traces, and the hard cap has to express a deliberate developer-inspection ceiling.

The split also preserves the current authorization boundary: `scope=mcp` plus a valid resource-bound OAuth token grants global developer access to the wired MCP tools. The fix changes response sizing only; it does not add per-game, per-user, or private-trace authorization.

## Prevention

- Add a regression test that calls `ProductionGameMcpReadModel.readTraceContent` without `maxBytes` and asserts the default sent to `PrivateTraceReadModel.readContent` is developer-sized.
- Add a server test that proves `search_reasoning_traces` does not advertise or forward `maxBytesPerObject`.
- Keep `/mcp` request-body tests near the route layer so future changes do not confuse request limits with tool response limits.
- Document trace response limits in `docs/game-mcp-production-oauth.md` next to the tool list, not only in constants.
- When a guard protects a developer-inspection artifact, verify it against at least one real artifact size before treating the guard as production-ready.
- Keep search scan caps server-owned unless there is a concrete operator workflow that needs to tune them.

## Related Issues

- `docs/game-mcp-production-oauth.md` documents the deployed MCP tool contract and the response-content limit distinction.
- `docs/reasoning-transcript-observability.md` describes private trace MCP tools as developer inspection surfaces.
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md` covers the broader private-evidence/public-transcript/canonical-event split. This note is the narrower runtime failure mode for raw trace loading.
