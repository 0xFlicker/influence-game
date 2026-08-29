# Test Ownership and CI Audit

**Audited:** 2026-08-19

**Runtime:** Bun 1.3.14

**Authority:** `scripts/check-test-classification.ts`, package scripts, and GitHub workflow job conclusions

## Current inventory

`bun run test:classification` currently classifies 264 unique test files:

| Lane | Files | Discovery / selection | Required? | Credentials or external effects |
|------|------:|-----------------------|-----------|---------------------------------|
| Provider-free | 141 | Bun discovers ordinary tests under engine, web, protocol, and root scripts | Yes | None |
| API / PostgreSQL | 111 | Bun discovers every ordinary non-E2E API test | Yes | Local PostgreSQL only |
| Browser Coverage | 7 | Four `*.e2e.test.ts` API stories plus three deterministic Playwright specs | No; visible workflow | Local PostgreSQL and local child processes only |
| Real Clerk | 1 | The real-Clerk project in the dual-owned layered-auth spec | Never automatic | Disposable Clerk instance |
| Live provider | 3 | `*.live-provider.test.ts` | Never automatic | Explicit OpenAI-compatible provider |
| External smoke | 1 | `*.external-smoke.test.ts` | Never automatic | Explicit S3-compatible service configuration |
| Staging | 1 | Explicit `e2e/smoke.spec.ts` selection | Release gate only | Qualified staging candidate and Tailscale |

Lane counts overlap because the deterministic and real-Clerk layered-auth projects share one Playwright spec. Only the deterministic project runs in Browser Coverage. Real Clerk remains an explicitly selected manual project.

Counts are an audit snapshot, not an allowlist. Bun owns discovery inside each ordinary lane. The classifier owns only the exceptional path/suffix boundary and fails if a new test is outside it.

## Ownership contract

- Ordinary tests under `packages/engine`, `packages/web`, `packages/prompt-lab-protocol`, and `scripts` default to provider-free.
- Every ordinary test under `packages/api` defaults to the API/PostgreSQL lane, including tests in `src/services` and `src/scripts`.
- Deterministic API browser stories live under `packages/api/src/e2e` and use `*.e2e.test.ts`.
- Live provider tests use `*.live-provider.test.ts`.
- External-write smoke tests use `*.external-smoke.test.ts`.
- Root Playwright specs require an explicit classification because deterministic local, real-provider, and staging projects share that directory.

The required Bun config excludes API E2E, live-provider, and external-smoke files. Browser and manual configs remove only the exclusions their named command owns. Invoking a live-provider or external-smoke command without its required configuration fails closed; missing credentials never produce a green result.

## Required conclusions

The `CI` workflow exposes stable sibling conclusions:

| Conclusion | Command / responsibility |
|------------|--------------------------|
| `check` | release-policy checks, test classification, typecheck, lint |
| `Provider-free tests` | `bun run test:provider-free` |
| `API / PostgreSQL tests` | `bun run test:postgres` |

The provider-free and API/PostgreSQL jobs use no repository secrets and are safe for fork pull requests. The `Build PR` pre-deploy check reruns the same deterministic commands before an authorized ephemeral image build. No deployment, image, or staging topology is changed by this test split.

## Browser Coverage

`.github/workflows/browser-coverage.yml` is a visible, non-required workflow with four zero-retry conclusions:

- `Browser Coverage / Public identity`
- `Browser Coverage / Layered auth`
- `Browser Coverage / Format viewer`
- `Browser Coverage / API browser stories`

Each harness creates a unique PostgreSQL database. The server helper drains API/web stdout and stderr into bounded logs, owns process termination even when startup fails, and writes evidence below `test-results` when configured. GitHub uploads browser artifacts only after failure.

The format viewer harness seeds `dark-coral-horn`, `mild-cream-rune`, `young-ruby-isle`, and `edge-smoke-dusk` from canonical engine events. It does not depend on a developer-populated database. The deterministic game-flow browser test stops after creating and filling the lobby; the paid play-to-completion story lives in `game-flow.live-provider.test.ts`.

## PostgreSQL isolation

`bun run test:postgres` is one Bun process with `--max-concurrency 1`. Every shared-database test must call `setupTestDB()` before mutation. Its reserved PostgreSQL connection holds a process-lifetime advisory lock, so separately launched Bun processes wait instead of truncating underneath one another. The lock does not serialize `test.concurrent` or `describe.concurrent`; those APIs remain prohibited for shared-DB tests.

The reset list covers every current Influence schema table. Browser harnesses do not use the shared truncation list: they create and drop per-run databases.

## Commands

```bash
# Required deterministic lanes
bun run test
bun run test:postgres
bun run check

# Visible deterministic browser coverage
bun run test:e2e:identity
bun run test:e2e:layered-auth
bun run test:e2e:format-viewer
bun run test:browser:api

# Explicit opt-in only
doppler run -- bun run test:live-provider
bun run test:external-smoke
bun run test:e2e:layered-auth:clerk
```

## Branch-protection operator migration

After this workflow lands on `main`, observe successful `Provider-free tests` and `API / PostgreSQL tests` conclusions on the exact main SHA. Add both names to the protected-branch required-check set while retaining the existing `check` requirement. Do not require the four `Browser Coverage / ...` conclusions; they are intentionally visible and non-blocking. Change branch protection only after the new names have appeared, so there is no enforcement gap.
