---
title: Global Production render monitor
type: feat
status: completed
date: 2026-11-02
---

# Global Production render monitor

Place the monitor at `/admin/production/renders`, next to the Production library.
Add a library-header link and a link from each game's Render jobs panel. Current
Producer/Sysop authority protects navigation, queries and all actions.

## Layout and interaction

1. **Header:** Production breadcrumb, Render jobs title, scope description,
   latest refresh time and Refresh button.
2. **Summary:** Active, Failed and Completed counts for the current game/type/search
   scope. Counts cover the database, independently of the selected status/page.
3. **Filters:** Status, output type, and a submitted search for game title, slug or
   job ID. An exact game scope can be opened from a row and cleared. Filters and
   pagination live in the URL, so reload and shared links retain the view.
4. **Jobs:** Active jobs first, then recent history, with bounded server pagination.
   Columns show game, output type/requester, status/progress, ordered time and
   actions. Game links open Studio. Queued jobs have no invented ETA or percentage.
5. **Details:** Expand a row for full job/execution IDs, renderer digest and failure
   information. Copy job ID supports agent/operator handoff. Actions reuse existing
   cancel, execution-fenced retry and freshly authorized private download behavior.

Desktop uses a compact table; narrow screens use stacked rows with the same labels
and controls. Empty, loading, unavailable and permission-denied states are explicit.
Refresh every 15 seconds while visible, including when no jobs are active, so new
MCP orders appear. Keep visible data during refresh, but clear private cached data
when current producer authority disappears.

The API filters and counts metadata in PostgreSQL. It never loads frozen source
documents or media to draw the monitor. No new scheduler, renderer target, automatic
retry policy, ETA model or cloud-capacity dashboard is introduced.

## Local acceptance

Use the real Next dev UI and authenticated API with an isolated PostgreSQL
database. Browser checks cover global navigation, both workloads across games,
active-first ordering, filters, details, cancel/retry, permissions and
desktop/narrow screenshots. Seeded status rows are presentation fixtures, clearly
distinguished from actual rendering evidence.

PostgreSQL integration tests separately cover bounded keyset pagination, equal
timestamps at microsecond precision, cursor/filter binding, counts across the
complete result set and metadata-only availability during an object-store outage.
Cancellation also uses relational identity, so it remains available during that
outage. Retry still verifies the frozen inputs before starting compute.

For complete execution, order a short cut, run the existing Docker worker against
local PostgreSQL/MinIO, observe its state in the monitor and download the verified
MP4. Local proof covers browser/API/MCP, preparation, encoding and object storage.
AWS placement, protected Batch capacity and tailnet behavior remain staging checks.

## Delivery evidence

Implemented the route, navigation, responsive layout, metadata endpoint and shared
render controls. Browser tests passed the main monitor flow, current-role
revocation/non-producer denial, and Studio order recovery. Role denial hides
cached rows and summary counts immediately on the next authorized refresh.

The combined `scripts/verify-render-order-local.ts --browser` proof passed for
Influence and Werewolf in `.renders/order-proof-1793638838872/proof.json`. Both
HTTP MCP orders rendered in Docker, returned to private MinIO, appeared completed
in the real Next dev monitor and downloaded through its button with matching
SHA-256 and byte length. The isolated database and owned services were removed;
no AWS job or deployment was performed.

Screenshots retained under `.renders/global-render-monitor-ux/` show the desktop,
expanded failure and 390px mobile layouts using local presentation fixtures.
`.renders/order-proof-1793638838872/global-render-monitor-verified.png` shows the
two actual completed local renders. The metadata monitor includes shared Batch
jobs; legacy-controller trailers stay in their existing game-owned tools until
the planned workload migration.

Final checks: 3,272 provider-free tests passed (five existing skips), 2,324
PostgreSQL tests plus eight fixed-port proof tests passed, and the final 38-test
API regression and three-test browser runs passed. Typecheck, lint, classification
and MCP schema freshness passed. See [the evidence and repeatable command](../solutions/infrastructure/2026-11-02-studio-browser-mcp-orders.md#global-render-monitor-and-combined-localhost-proof).
