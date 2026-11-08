# Season 1 paid landing pages

The three campaigns share House artwork and a small marketing shell, with separate copy and interactions:

| Route | Audience | Primary action |
| --- | --- | --- |
| `/season-1` | Reality-show and social-strategy viewers | Open the season-scoped creator |
| `/season-1/create` | Character creators | Carry a character idea into the creator |
| `/season-1/ai` | People building with their own AI | Open the selected existing MCP setup guide |

The drama page explains Influence's alliances, round-specific votes, elimination fallout and two-player jury finale. The AI page provides character-workshop, strategy-sparring and season-preparation prompts. It distinguishes the connected assistant from the contestant's in-game model.

## Entry and signup

`season-one-entry.ts` pins the advertised public slug `season-1-3588af22`, verified against the deployed public season list on 2026-11-08. Campaign entry resolves its ID using the current environment's public season list and checks status/admission dates. A missing or closed Season 1 produces an explicit message and season-page link; another accepting season is never substituted. Environments without that season intentionally cannot exercise successful campaign entry without a test fixture.

The existing creator still owns the first anonymous message, signup prompt, draft recovery, artwork requirements, creation and enrollment. These pages neither submit messages automatically nor change signup timing. `Create & enter` retains its current behavior. Admission is checked again by the existing entry API when the agent is ready.

Character text travels through same-tab session storage under an opaque random request ID. The URL contains no character text. After normal editor draft recovery, an empty composer receives the idea; an existing conversation offers an explicit action to use it. The temporary copy is removed after handoff, and the normal editor owns subsequent persistence. Storage failures are visible. Opening a copied handoff URL in another browser does not transfer the idea.

MCP client names and IDs come from the existing setup catalogue. Links open the corresponding `/get-mcp#setup-…` disclosure. Prompts can be copied, with selectable text when clipboard permission is unavailable. Connecting an account and enrolling through MCP remain explicit user actions in the existing flow.

## Scope

The landing-page implementation adds no page-specific pixels or analytics configuration. Muse's `feat/ad-tracking` is integrated separately in this branch with the reviewed consent, signup recovery, delivery retry and spend-reporting corrections. Existing site-wide providers and footer are reused. See [product analytics](../product-analytics.md#account-preference-and-operational-reporting) for the shared tracking contract.

No game renderer, Studio preview, frozen bundle or encoded video content changed. These are ordinary scrollable marketing pages outside the player picture.

Headings have no eyebrows, split colors or italicized words. Supporting copy adds information. The pages use existing public assets, uniform serif headings and responsive layouts.

## Initial landing-page validation

Focused tests cover exact-season selection and unavailable seasons, deferred idea handoff, existing-draft preservation, blocked storage, AI client selection and clipboard fallback. Existing anonymous-creation tests cover the unchanged signup boundary.

Browser QA uses the repository's deterministic test-auth mode and a read-only local season/anonymous-allowance fixture. It verifies real landing-page navigation into the existing creator with the idea in its composer and exact Season 1 query parameters, without submitting a provider request or creating an account. Desktop and mobile screenshots are retained in the task's visualization folder. This is local UI evidence, not production signup/enrollment proof.

Verified locally:

- `bun run test`: 3,381 passed, 5 skipped (provider-free baseline; local socket access required).
- `bun run check`: passed across all workspaces.
- Focused campaign/creator/MCP checks: 42 passed; the real public-creator regression proves the campaign does not submit automatically or move signup ahead of the first response.
- `PRIVY_APP_ID=<public app ID> bun run --cwd packages/web build`: passed. The public app ID is an existing CI build requirement, not a new campaign setting.
- Browser: all three pages at desktop and 390px mobile widths, AI navigation at 320px, no horizontal overflow; preset selection, input validation, exact-season handoff, prompt copying, and selected MCP disclosure verified.

No production signup, provider generation or enrollment was performed during verification.

`bun run test:postgres` ran against a newly created isolated local database because another task held the shared test lock: 2,534 passed and one existing `staging-render-proof.test.ts` cleanup hook timed out at 30 seconds. A separate run of that fixture in its own uniquely named proof database passed all 9 tests, including cleanup. The full baseline therefore remains recorded as failed, not silently upgraded to green. No API/rendering code was changed. The campaign test database and preview servers were removed/stopped after verification.

## Tracking integration

The current creator/signup boundary is preserved. Internal outcome counts remain
available when optional tracking is off; account-level preference and version
checks control attribution and PostHog/Meta delivery, including MCP activity.
Withdrawal suppresses queued events, and re-enabling cannot backfill them.
Campaign costs use campaign totals; creative cost fields remain null without
creative-level spend. No tracking credentials or deployment configuration changed.

Final focused regressions: 63 PostgreSQL tracking/auth tests and 49 browser/auth
tests passed. The full provider-free baseline passed 3,388 tests with 5 skipped;
workspace type-checking/lint and the combined production web build passed.
These checks use mocked delivery transports, not live PostHog/Meta conversion
submission. The changes are combined on `codex/season-one-landing-pages` only.

The combined PostgreSQL baseline was rerun using the four CI shards with four
independent disposable databases: **2,546 passed; one existing staging-render
cleanup hook timed out at 30 seconds**. Shards 1–3 passed; shard 4 remains failed
because of that hook. A separate render-fixture run passed its 9 assertions but
also timed out in cleanup, so the aggregate baseline is not reported as green.
The initial combined run exposed a tracking lock-upgrade deadlock during parallel
agent creation; changing the tracking lock to `FOR NO KEY UPDATE` fixed it.
All 21 tracking/season-read regressions and the final sharded season tests passed.
No render-fixture or player-presentation code was changed to bypass the timeout.

## Google, TikTok, and X reporting follow-up — 2026-11-08

The landing-page branch now includes server conversion adapters for Google Ads
Data Manager, TikTok Events API, and X Conversion API. They report signup,
agent readiness, and season entry with the existing account-wide tracking
permission, withdrawal rules, stable conversion identities, and independent
five-attempt upload budgets. Google acceptance is followed by persisted,
separately scheduled processing diagnostics. No historical events are backfilled
to the new destinations. Partial configuration waits without consuming attempts
or freezing an incomplete destination.

The browser retains X `twclid` under the same attribution controls. Explicit
analytics choice is distinguished from regional default permission for Google's
consent signal. The signup sequence is unchanged. Privacy copy and the
[platform setup guide](../product-analytics.md#advertising-platform-feedback)
now cover all destinations. No live credentials, external conversion submission,
spend, deployment, or main-branch merge is part of this change.

Final local checks: 31 focused PostgreSQL tracking/migration tests, 49 browser,
attribution, privacy and authentication tests, and repository typecheck/lint
passed. The final provider-free baseline passed 3,391 tests with 5 skipped.
The new provider tests use mocked transports; production configuration,
provider acknowledgement, campaign attribution, and optimization eligibility
still require platform-side verification.

The four isolated PostgreSQL baseline shards finished with 2,559 passing tests
and two failures. One was a new consent-test fixture that omitted the event it
asserted against; the fixture is corrected and passes in the final 31-test
tracking run (which also covers the five additional adapter/migration cases
added after the baseline started). The remaining failure is the pre-existing
`staging-render-proof.test.ts` cleanup timeout: all nine render assertions
passed before its 30-second cleanup hook timed out. The aggregate PostgreSQL
baseline is therefore not claimed green. Main remains unchanged.
