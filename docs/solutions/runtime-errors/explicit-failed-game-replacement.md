# Explicit failed-game replacement

The recovery machinery did not provide a reliable user-accessible replacement action. Admin Retry game now atomically records one replacement, fences the old owner, hides the original and preserves its history. Concurrent requests and lost launch acknowledgements reuse the recorded replacement. Frozen admitted seats, routing, artwork and competitive roles survive owner edits.

Exact local launch filters adoption by game ID. A failed initial construction expires only its claimed epoch; an active lease left by that failure must not count as launch acceptance. It leaves the replacement's admitted inputs intact for redelivery. Canonical outcomes and captured settlements reject gameplay replay, preserving the separate settlement recovery path.

Werewolf seeded role assignment depends on sorted seat identifiers. Replacement seat identifiers preserve the original lexical ordering, and role equality is verified before committing. Randomizing those identifiers while retaining the same seed changes roles.

Tests exercise duplicate acceptance, legacy replay races, startup and transport failures, exact launch with an unrelated game present, canonical completion and championship settlement. Real providers and deployment remain outside these fixture tests. Production requires the separately implemented exact-game launcher; no recurring scheduling implementation is included.

If the page reloads after launch delivery failed, use the admin Hidden filter to find the original attempt and press Retry game again. That request returns and launches the already-recorded replacement, not another new game.

## Real localhost verification

A real browser/API test on a newly-created, deliberately suspended House-only Werewolf game exposed two integration omissions: the separate Werewolf workspace had no Retry action, and the replacement seat insert omitted `house_character`. PostgreSQL's seat-identity constraint correctly rolled back acceptance. The shared Retry control now appears in that workspace, and replacement seats preserve their frozen House identity and model preference. Regression cases cover zero, four and eight owned agents in an eight-seat game.

After these fixes, the actual browser action accepted and explicitly launched one replacement in the existing local API process. Normal GPT-6 Luna inference completed gameplay and retrospective with 39 gameplay provider receipts. The original retained only its initial canonical event and was hidden. The replacement retained cast, rules, seed and roles, produced one village-win outcome, and appeared in public listings. A second actual Retry click returned the same completed replacement. Fresh mobile verification showed one page, a visible focused Retry control on the old attempt, no Retry on the completed game, and no horizontal overflow.

No responses were stubbed or intercepted for the successful run. Failure injection affected only the new disposable original; no outcome was fabricated. The test used an unrated custom game with House characters, so it did not modify an existing player game or season/championship standings. This proves local direct runtime launch, not the future Fargate deployment. Browser verification must use the configured `localhost:3001` origin; `127.0.0.1:3001` is not included in the running development API's CORS allowlist.

## Influence FAILED presentation

`GameStatus` stores `waiting`, `in_progress`, `completed`, `cancelled`, or `suspended`. The Influence admin `StatusBadge` maps `suspended` to the visible label `failed`, and its suspended rows appear under **Failed Games**. There is no separate persisted `FAILED` value to manufacture.

A second real localhost rehearsal exercised that exact presentation: create/fill/admit a new six-character custom Influence game, claim only that test game, and submit an invalid event through `appendGameEvents`. Its actual failure handler rejected the event, retained zero accepted events, expired the test owner with `event_append_failed`, and set the normal suspended state. The real browser showed **Failed Games** and the `failed` badge, then its Retry button returned 200 and launched a replacement through the existing local runtime. No game-status value was assigned directly and no failure-injection endpoint was added to the app.

That Influence replacement completed real gameplay and retrospective, with 255 gameplay provider receipts (254 GPT-6 Luna and one Grok fallback). Verification found exactly one result, one completed settlement with attempt count 1, no active execution owners, preserved frozen roster/configuration, and the original `event_append_failed` evidence retained. Repeat delivery returned the same completed replacement. The real admin UI displayed the replacement as `done`. Evidence remains in `artifacts/championship/failed-influence/verified.json` and screenshots; the run was unrated and did not affect a season.

A separate nonblocking observability limitation was recorded: four vote manifests exist under an earlier owner epoch, while three jury-vote cognition records are absent. Canonical results, provider receipts and completed settlement are present. The verification did not rewrite ownership evidence or fabricate missing cognition to clear the diagnostic. These metadata/capture gaps remain for follow-up; they are not a separate persisted FAILED game state or a retry launch/settlement failure.
