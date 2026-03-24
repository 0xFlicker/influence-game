# Error Handling Guidelines

These rules apply across `packages/api`, `packages/engine`, and `packages/web`.

## Core Rules

1. Catch errors only when you can add context, recover safely, translate them for the caller, or perform cleanup.
2. If you recover, log enough structured context to explain what failed, where, and what fallback was used.
3. If you cannot recover safely, rethrow or return an explicit error response. Do not silently continue.
4. Preserve the original error object when logging. Avoid reducing everything to `"failed"` without source context.
5. Every fallback path should answer two questions in code comments or logs:
   - Why is it safe to continue?
   - How will operators notice the failure happened?

## API

- Do not use `await c.req.json().catch(() => null)` for request parsing.
- Parse request bodies in a `try/catch`, return `400`, and include a stable reason such as `invalid_json_body`.
- Distinguish client errors from server errors.
- When upstream services fail, return an explicit `502`/`503` and log the upstream dependency and operation name.
- Cleanup failures should be logged with the resource identifier they affect.

Recommended pattern:

```ts
let body: unknown;
try {
  body = await c.req.json();
} catch (error) {
  console.warn("[route-name] Invalid JSON body", { error });
  return c.json({ error: "Invalid JSON body", code: "invalid_json_body" }, 400);
}
```

## Engine

- Random or default fallback behavior is acceptable only if the game spec allows the system to keep moving.
- When an LLM/tool call falls back, log the phase, agent, action, and fallback chosen.
- Empty catches in gameplay code are not acceptable unless they are truly best-effort and already observable elsewhere.
- Do not let listener, memory, or diary-room failures disappear without a breadcrumb for operators.
- Prefer local containment: one agent/action can fail without crashing the full game, but the failure must remain visible in logs and state where practical.

Recommended pattern:

```ts
} catch (error) {
  console.warn("[agent] getVotes fallback", {
    agent: this.name,
    round: ctx.round,
    phase: ctx.phase,
    error,
  });
  return { empowerTarget: randomOther().id, exposeTarget: randomOther().id };
}
```

## Web

- Do not silently replace failed fetches with empty arrays or null state when the UI becomes misleading.
- If a screen can keep rendering with partial data, show a degraded-state message and log enough context for debugging.
- Server component catches should render an explicit unavailable/not-found state when possible.
- WebSocket parse or transport failures should increment visible connection/error state or emit a diagnostic log.
- Reserve silent fallback for optional enhancements only, not primary user data.

Recommended pattern:

```ts
.catch((error) => {
  console.warn("[dashboard] Failed to load agents", { error });
  setError("Could not load saved agents.");
  setAgents([]);
})
```

## Review Checklist

- Does the catch block name the failing subsystem?
- Does it preserve the original error?
- Does it avoid changing the UI or game state into a misleading success/empty state?
- Does it emit enough context for staging/prod debugging?
- Is the fallback explicitly allowed by product or game rules?
