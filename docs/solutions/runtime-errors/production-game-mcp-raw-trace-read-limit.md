---
title: Production Game MCP Raw Trace Reads Need Ranged Response Caps
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

# Production Game MCP Raw Trace Reads Need Ranged Response Caps

## Problem

Production Game MCP exposes explicit private trace tools behind the `producer` developer gate. The initial raw trace read guard was sized like a small API payload, so `read_trace_content` could authorize and locate trace manifests but still fail before returning any useful raw trace content.

The fix is to treat raw trace content as a ranged object-storage read and bounded tool response, not as an incoming `/mcp` request body and not as an all-or-nothing object-size gate.

## Symptoms

- Earlier `read_trace_content` behavior failed normal private trace artifacts whenever the requested byte cap was smaller than the full object.
- The visible question became "what is your body response limit?" because every real trace looked too large to load.
- The `/mcp` HTTP route still had a 1 MiB POST body guard, but tool calls only send small JSON-RPC arguments. That guard was not the limit breaking raw trace reads.

## What Didn't Work

- Assuming empty trace results always meant the byte guard was wrong. Some test runs had no private trace manifests, and missing `LINODE_PRIVATE_CONTENT_*` env vars can leave the API with no private trace corpus until restart. Check manifests and storage configuration first. (session history)
- Rejecting when a small `maxBytes` was smaller than the full object. A local check proved a trace object around 78 KiB failed under a 512 byte cap, then succeeded with a larger `maxBytes`; storage and manifest lookup were working. The correct behavior is to return the first requested bytes with truncation metadata. (session history)
- Treating the `/mcp` request body limit as the answer. The route-level guard protects incoming client POST bodies and should stay small because MCP tool arguments are tiny.
- Keeping raw trace defaults in the low KiB range. That made the safety guard technically present but operationally useless for developer inspection.
- Exposing `maxBytesPerObject` as a public search argument. The supported public argument is now `maxBytes`, shared with direct content reads; older `maxBytesPerObject` inputs should remain ignored. (session history)

## Solution

Keep the HTTP route request guard separate from trace response/content bounds:

```ts
// packages/api/src/routes/mcp.ts
const DEFAULT_MAX_POST_BYTES = 1024 * 1024;
```

That limit applies to incoming JSON-RPC request bodies. Do not use it to reason about how large a tool response can be.

For raw private trace reads, size the `ProductionGameMcpReadModel` cap for real developer artifacts:

```ts
// packages/api/src/game-mcp/read-model.ts
const DEFAULT_TRACE_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_CONTENT_BYTES = 64 * 1024 * 1024;

// ...
maxBytes: clamp(params.maxBytes ?? DEFAULT_TRACE_CONTENT_BYTES, 1, MAX_TRACE_CONTENT_BYTES),
```

The lower-level private trace storage adapter should use ranged `GET` when a cap is present:

```ts
// packages/api/src/services/private-trace-storage.ts
new GetObjectCommand({
  Bucket: input.bucket,
  Key: input.key,
  Range: `bytes=0-${maxBytes - 1}`,
});
```

`PrivateTraceReadModel.readContent` should return truncated content successfully when a cap is smaller than the full object, with metadata such as `returnedByteLength`, `totalByteLength`, and `truncated`.

For trace search, keep the production MCP schema focused on filters, result count, and the same `maxBytes` cap:

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
    maxBytes: optionalNumber(args, "maxBytes"),
  }));
}
```

The production server should not advertise `maxBytesPerObject` on `search_reasoning_traces`, and it should ignore that argument if an older or hallucinated client still sends it. The public byte cap is `maxBytes`.

Then document the contract where developers look for MCP setup:

```md
read_trace_content defaults to an 8 MiB raw trace read limit and clamps
tool-supplied maxBytes at 64 MiB. search_reasoning_traces accepts the
same maxBytes cap for per-object ranged scans. These are response-content
bounds, separate from the /mcp request body limit.
```

## Why This Works

The request and response paths have different risk profiles.

The `/mcp` POST body limit prevents a client from sending oversized JSON-RPC request payloads. For this server, those payloads should be compact method names and tool arguments.

`read_trace_content` is different: the client asks for one explicitly selected private evidence manifest, and the server returns raw JSON/JSONL producer evidence. Those artifacts are naturally larger than JSON-RPC arguments. Keeping a content bound is still correct, but the bound should be enforced with ranged storage reads and truncation metadata rather than by rejecting normal trace objects.

The fix also preserves the current authorization boundary: the `producer` scope plus the current `producer` role grants developer access to the wired producer MCP tools. The fix changes response sizing only; it does not add per-game, per-user, or private-trace authorization.

## Prevention

- Add a regression test that calls `ProductionGameMcpReadModel.readTraceContent` without `maxBytes` and asserts the default sent to `PrivateTraceReadModel.readContent` is developer-sized.
- Add a server test that proves `search_reasoning_traces` advertises and forwards `maxBytes`, while ignoring `maxBytesPerObject`.
- Keep `/mcp` request-body tests near the route layer so future changes do not confuse request limits with tool response limits.
- Document trace response limits in `docs/game-mcp-production-oauth.md` next to the tool list, not only in constants.
- When a guard protects a developer-inspection artifact, verify it against at least one real artifact size before treating the guard as production-ready.
- Keep search scan caps server-owned unless there is a concrete operator workflow that needs to tune them.

## Related Issues

- `docs/game-mcp-production-oauth.md` documents the deployed MCP tool contract and the response-content limit distinction.
- `docs/reasoning-transcript-observability.md` describes private trace MCP tools as developer inspection surfaces.
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md` covers the broader private-evidence/public-transcript/canonical-event split. This note is the narrower runtime failure mode for raw trace loading.
