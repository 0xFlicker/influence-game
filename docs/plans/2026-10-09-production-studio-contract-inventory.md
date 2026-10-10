---
title: Production Studio contract and simplification inventory
date: 2026-10-09
status: implemented-awaiting-operator-acceptance
parent: 2026-10-09-001-feat-production-studio-moment-editor.md
---

# Production Studio contract inventory

This ST-01 record inventories the current local checkout for the combined A2.1/A2.2 implementation. It is not operator acceptance, a deployment record or permission to perform paid generation. The primary plan and historical ideation records remain intact.

## Operations and authority

`P` means current Producer/Sysop role, `A` means `view_admin`, and `S` means `start_game`. Episode/release read authority is `view_admin` **or** `manage_roles`; edit authority is `manage_postgame_media` **or** `manage_roles`. The existing auth middleware resolves current database permissions on each request.

| Operation | Existing endpoint/service | Authority and state |
| --- | --- | --- |
| Production library/inventory | `/api/admin/production/library`, `/games/:id`, `/games/:id/scenes` | Bounded discovery uses P or existing admin grants; editorial scene reads use P. Completed or validated visually suspended games; exact Influence metadata also retains the legacy active-game visual workspace. |
| Influence inspection/review/evidence | `/api/admin/games/:id/visual`, `/scenes/:scene/review`, `/evidence/:kind/:artifact` | A; preserve existing grants. |
| Influence independent scene review/regenerate/verify/harmonize/continue/publish | `/api/admin/games/:id/visual/media`, `controlVisualMedia` | S; independent from gameplay, including supported in-progress/suspended/completed scene work. |
| Completed replay/missing scene repair | Production `/visual/media`, `/visual/missing` | P; source-owned candidate and preview hash. |
| Werewolf paused scene repair | Same production routes | P; only canonical paused frontier, including before a scene exists. |
| Influence policy/resume | Legacy `/visual/control`, `visual-policy.ts` | S; explicit policy and explicit resume remain separate. |
| Influence asset recovery | `action=repair_assets`, `prepareVisualAssetRepair` | S; suspended visual pause, existing asset reconciliation/retention. |
| Influence gameplay scene repair/finals rebuild | `action=repair_scene`, `prepareVisualRepair`/`previewFinalsRebuild` | S; suspended pause, exact revision/current arrangement; rebuild additionally requires canonical preview hash. |
| Werewolf policy/resume | Production `/visual/control`, `werewolf-visual-policy.ts` | P and S; canonical pause validation, required publication or saved form, no active repair. |
| Werewolf form-only repair | Production `/visual/forms`, `queueWerewolfFormRepair` | P; exact pause/request IDs; existing worker uses null scene ID and `mode=forms`. |
| Attempt reconciliation | Corresponding `/visual/attempts/:attempt/reconcile` | Influence S; production P; exact scoped attempt and billing evidence. |
| Episode read/edit/naming | `/api/admin/games/:id/episode`, `/api/admin/episodes/backfill` | Existing episode grants; conditional revision edits, bounded review/queue batch. |
| Trailer/poster read/backfill/rerender | `/api/admin/games/:idOrSlug/postgame/media` and its commands | Existing release grants; completed game, reason/confirmation; existing publication policy. |

Source owners: `packages/api/src/routes/production-studio.ts`, `routes/visual.ts`, `routes/visual-replay-production.ts`, `routes/episodes.ts`, `routes/admin.ts`; game-owned recovery in `services/visual-repair.ts`, `visual-policy.ts` and `werewolf-visual-policy.ts`.

Discovery does not authorize editorial evidence. Producer role alone does not grant `start_game` or episode/release editing. An Influence operator's existing media permissions must not be narrowed to P, nor copied to Werewolf or new annotations/source reads.

## Scene and work coordinates

| Game/use | Source coordinate | Persisted media |
| --- | --- | --- |
| Influence room arrangement | Committed logical-turn boundary and dialogue watermark; canonical roster/roles | Stored scene, zero or more immutable versions and publications |
| Influence paused assets/finals | Game-owned visual pause and exact scene revision; rebuild preview hash | Asset operations or current finals scene; independent media jobs do not replace execution recovery |
| Werewolf village/pack/hunt use | Canonical event boundary, day and typed purpose; exact living/pre-outcome cast | Multiple uses may reuse one compatible stored scene |
| Werewolf pending scene | Validated canonical suspended frontier descriptor | Scene may not exist yet |
| Werewolf pending wolf form | Validated pending attack actor at suspended frontier | Repair work item; null scene ID, no fabricated scene or editorial moment |

Werewolf's internally reused Influence room IDs do not become product locations. Doctor-protected attacks and no-target nights require no generated hunt image; their permitted replay explanations remain game-owned. Stored generation plans remain immutable.

Moment catalog/source contracts are the separate ST-02 ownership boundary. Transcript IDs and canonical event/accepted-action identities are provenance; replay cursors, array positions, text, pages and image revisions cannot identify saved tags. Independent thoughts and speech must use one shared finite catalog rather than these inventory scene keys.

## Simplification dispositions and deletion sites

| Existing path | Disposition | Reason / cutover requirement |
| --- | --- | --- |
| Media request decoding in both route files | **Share** `services/visual-media-control.ts` | One strict decoder; preserve route-specific authorization and domain guards. |
| `SceneRepairPanel`, `ImageReviewEditor`, `VisualFailurePolicyControl` | **Share** | Existing receipt ownership, candidate rejection/regeneration, exact uncertainty acknowledgement, review/publication and version tools. |
| `controlVisualMedia`, media worker, journal, versions/publications | **Retain House-owned** | One mutation owner and queue already exist. |
| Influence asset/finals repair and Werewolf pause/form/resume validation | **Retain game-owned** | Recovery rules differ; shared UI must call their services. |
| `ReplayVisualProductionPanel` scene-list wrapper | **Deleted** | Bounded studio scene inspector owns inventory/comparison. `GameProductionRecovery` retains game/form recovery and non-scene receipts. Final browser proof is recorded in the parent plan. |
| `games/[id]/visual/visual-operations.tsx` and route | **Retain component; delete route** | Studio game tools retain Influence policy, asset repair, finals rebuild, evidence/export and resume. Independent scene controls appear only for legacy operators without editorial access. |
| Werewolf workspace production subsection | **Deleted; studio link** | Other game operations sections remain. Studio inspector/recovery tools call the same canonical services. |
| `EpisodeEditor`, `AdminPostgameMediaPanel`, batch naming | **Retain operations; studio homes** | Per-game dialogs share `AdminSession` drafts/requests and GET-based uncertainty checks. Bounded library owns batch selection, exact reviewed IDs and naming reconciliation. Admin rows link to the studio. |
| Old `/production/games` array, `listProductionGames` and `ProductionPanel` | **Deleted** | One paged library replaces the old array and expanding editor rows; no compatibility decoder or response switch. |
| Temporary `/admin/production/prototype` fixture editor and DTO-only Studio runner | **Deleted** | Canonical API browser/encoded proofs own the editing and audio regressions. The approved prototype direction and historical local artifacts remain recorded; one active Studio remains. |
| Cross-game job console, broad transport audit, exporter concurrency/readiness optimization, harmonize schema alignment | **Defer** | Separate A2.3/performance/contract work; no concrete prerequisite found in this inventory. |

`AdminSession` remains the persistent mutation/draft owner. Its query scope includes account/auth generation; unknown POST retries retain exact URL/body. Paid receipt checks wait for the saved job/version/publication, and revocation cancels plus fences late results. Episode/trailer leaf mutation ownership is an integration task, not solved by copying their modal into a new inspector.

## Bounded discovery increment

`GET /api/admin/production/library` supplies metadata-only keyset pages: default 25, maximum 100, game-kind/completed-or-suspended/search/needs-attention filters. The response contains IDs, slug/title, kind/status, creation time, hidden/player-count/naming metadata, attention and coarse per-operation capability availability. It contains no config, cast references, scene plans, source history, provider receipts, private pause reasons or binary assets.

The endpoint accepts current P or the existing admin discovery grants (`view_admin`/`manage_roles`). Private production descendants stay P-only; exact game metadata uses the same discovery grants. Exact Influence metadata also preserves the legacy active-game visual workspace, without granting editorial source. Influence legacy endpoints retain their existing grants. Discovery permission does not preserve private source, detail or media caches after Producer revocation.

Non-producer discovery reports a generic visual pause, without Werewolf scene/form classification. A form-only pause advertises form repair to its authorized producer instead of a nonexistent scene repair. Cursor timestamps retain PostgreSQL microseconds rather than passing through JavaScript's millisecond normalization.

Suspended candidates are validated only within the bounded page: Influence marker and committed execution head in its game-owned policy service; Werewolf's existing canonical validator. Invalid pauses are omitted with `skippedInvalidPauses`; the cursor advances across examined candidates even if an entire page is invalid. Consumers must follow `nextCursor` even when `items` is empty. Database/programming failures propagate; they are not disguised as an empty library. No total-count claim is made.

The whole-history/whole-media inventory is not reused for library polling. Source loading uses one shared snapshot-bound adapter with bounded lanes, reused by browser and CLI. The scene inspector pages exact scene history and selected versions separately. Pinned preview resolves exact media references and never substitutes the latest candidate. Game recovery has a bounded, non-scene receipt read and canonical pause validation.

## Regression fixture inventory

| Proof boundary | Existing/local fixture owner |
| --- | --- |
| Current roles, denied users, unfinished games, stale preview and exact commands | `__tests__/visual-replay-production.test.ts` |
| Three-status independent repair, immutable versions/publication, failed jobs, exact uncertain acknowledgement | `__tests__/visual-media-repair.test.ts` |
| Influence required pause, asset/finals recovery, read-only admin and explicit resume | `__tests__/visual-operations.test.ts` |
| Before-scene Werewolf pause, scene-less form, policy changes, canonical resume, protected/no-target/game-ending nights | `__tests__/werewolf-visual-policy.test.ts` |
| Navigation/request loss/reconciliation ownership | Web `__tests__/production-recovery.test.tsx`, scene repair and admin continuity/episode/release fixtures |
| Existing full scene workflows | `e2e/replay-visual-production.e2e.test.ts`, `e2e/werewolf-visual-recovery.e2e.test.ts` |
| New bounded metadata, literal search, empty-invalid-page progress, permission split and revocation | `__tests__/production-library.test.ts` |

These fixtures are provider-free/local PostgreSQL or deterministic local browser evidence. They do not prove paid image quality, deployed permissions or live repair. The operator approved the interactive prototype direction before layout implementation. Delivered acceptance and encoded proof are recorded separately in the parent plan.

Local validation of the initial discovery increment: 10 production-library PostgreSQL tests passed with 71 assertions. The three existing media/visual/replay-production test files passed 58 tests. Tests used a fresh disposable database after the shared `influence_test` schema failed before test execution because `werewolf_lobby_seats` was absent; no migration-system change or shared-database repair was made. API typecheck passed. Subsequent browser, encoded-media and operator evidence is recorded separately in the parent plan.

## Final contract decisions

The operator approved Producer/Sysop authorization for **all API-backed local exports**, including full exports. Offline frozen-bundle rendering remains token-free. This replaces the historical anonymous full-export read; it does not change public replay.

One ordinary app-session helper now serves local export and both API simulators. It validates cached sessions at the exact API, opens the existing House sign-in page when needed, and checks each operation's current roles/permissions. The Producer-only MCP grant remains separate because it cannot represent the Studio's Sysop authorization. Explicit unattended sessions use `INFLUENCE_API_SESSION_TOKEN`; no credential enters a frozen descriptor or bundle. See [shared CLI login ownership](../solutions/architecture-patterns/2026-10-09-shared-local-cli-session-login.md).

One engine contract owns stable identity/catalog/selection. One browser-safe presentation binder/compiler and composition audio schedule serve source preview, selected preview and export. Sparse annotations have compare-and-swap revisions and retain an empty map after removal. Selection freezes exact ordered IDs, annotations/revisions, source/media boundary, settings, copy and recording evidence. Revalidation checks those frozen IDs rather than current tag membership.

The installed Player's audio pool cannot safely survive mute/zero-volume recovery. The supported `numberOfSharedAudioTags={0}` setting was proved locally against version 4.0.486 and preserves Remotion audio ownership. There is no dependency patch, alternate clock or new media queue. Shared lookup indexes replace repeated prefix scans without another gameplay reducer.

Prepared media contains only selected payloads and referenced recordings. Canonical state is reduced from complete permitted history first. Mystery drops private input before catalog/media serialization and rejects handcrafted private references. Publication, preview refresh and explicit gameplay resume remain separate operations. Final checks, browser/encoded artifacts and operator acceptance are recorded in the parent plan, not inferred from this disposition record.

Final core simplification and consistency review found no remaining contract or ownership issue. All four required checks passed after the shared login follow-up: provider-free 2,474 tests, isolated PostgreSQL 1,982 tests, all-package types/lint, and API browser 53 tests (three optional-mode skips). The callback cancellation finding was fixed and regressed at its owner. Direct Studio/encoded parity and both-game selected exports passed separately before this authentication follow-up.

Concrete delivered feedback reopened the interface gate: cramped fields, displaced selects, excess spacing, fixed sizing and disconnected seeking/inspection. The operator approved the revised hierarchy on 2026-10-09 and it is integrated into the real Studio. The temporary prototype route, fixture and duplicate select have been removed after real-operation browser proof. The real interface has desktop/narrow/short-window and encoded-media evidence; renewed required checks and ST-14 delivered acceptance are recorded in the parent plan.

The approved integration's final required baselines passed: provider-free 2,475 tests (five existing skips), isolated PostgreSQL 1,982 tests, all-package types/lint and API browser 56 tests (three optional-mode skips). Focused fullscreen/source-pin proof and both-game encoded proof passed separately. Owned test databases/children were cleaned; only generated Next route-path additions were restored. Delivered acceptance remains pending, separate from the approved prototype direction.

Final interface consistency review preserves one complete audience-authorized source pin while thinking visibility selects its displayed moments. Source reads, annotation writes and freezing use that fixed source contract; `selection.thinking` remains the operator's presentation choice. Mystery never loads thinking. Unmount evicts the game's source/prepared-query family before disposing media and recordings, so reopening cannot restore revoked URLs or stale saved annotations. Draft pinning, save locks and exact uncertain-export retry retain their existing session owner.

Environment choice belongs to preparation: downloaded selections freeze inputs/settings without origins or credentials, API/web flags choose the source/login environment, and prepared bundles render offline. Trusted internal Docker backend-origin comparison is distinct from strict external requested-target validation. No deployed verification or backend ownership expansion was introduced.
