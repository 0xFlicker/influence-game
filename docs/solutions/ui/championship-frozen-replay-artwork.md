---
module: championship-replay
problem_type: integration
tags: [championship, werewolf, replay, frozen-artwork]
---

# Championship replay must read competition artwork

The prepared championship portraits and bodies were present, but Werewolf replay
looked only at ordinary agent-content revisions. Six of eight local finalists
had no such revision, so both completed matches returned character 404s. The
staging scheduler fixture reproduced the same issue. Ordinary published-agent
revisions working in a production sample did not prove championship readiness.

`championship-character-art.ts` binds a game to its immutable attempt (or original
match), then matches the exact seat prefix and agent to a frozen championship
entry. It verifies build identity, artwork ownership/event membership, and both
payload hashes. It never reads mutable live profiles, requests generation, changes
canonical events, or creates ordinary content revisions.

The shared Werewolf reference resolver uses those payloads before ordinary
content revisions. Public replay, visual production, Studio source and export
character endpoints therefore resolve the same body/portrait. Transparent
artwork remains a derivative of the verified frozen body hash. Source snapshots
retain the available-asset whitelist; excluded assets stay excluded. Private
payload references never enter spectator projections or the source hash.

Existing completed games need no replay, data backfill or image generation.
Existing exported MP4s and already-prepared bundles do not change. Old Studio
snapshots can still pin absent images or reject a changed source descriptor;
refresh the source/selection and prepare a fresh bundle to include the repaired
artwork. Do not rewrite old pins or regenerate gameplay.

Verification: actual local Days 1 and 2 each returned 16 successful image
responses, matching the pinned Studio/export reader byte-for-byte. Browser
verification showed the previously missing Mara Voss full-body opening. The
render comparison used actual saved Day 2 source cases for Mara Voss and Bob
Smith at 1280×720 and 640×360, four samples per shot and reverse-order sampling.
All 16 viewer/export frames matched exactly; two H.264 clips passed eight decoded
frame checks with the existing mean pixel difference tolerance of 4.

Task-local evidence: `../championship-asset-diagnosis/fixed-replay-proof.json`,
`render-proof/comparison.json`, rendered PNGs and MP4s. Reproduce by preparing
saved source cases, then running:

```
cd packages/web
bun run src/scripts/verify-presentation-parity.ts <output-directory> <saved-cases.json>
```

No staging or production deployment is included. The staging fixture needs this
code deployed before its original missing artwork endpoints can be reverified.

Final focused PostgreSQL regression: 50 passed, 0 failed, 2,396 assertions across
seven files (160.34 seconds), including execution, correction/replacement,
ordinary artwork and production source compatibility. Executed in a freshly
created disposable database, removed after the run. Repository typecheck and
lint passed. No shared development data was used by the tests.

## Empty source-page progress

The full PostgreSQL regression exposed a paging loop in a sparse Werewolf source:
an empty requested cursor window returned the same next cursor. Source paging now
advances through the requested coordinate range even when it contains no visible
moments. The existing complete-catalog reconstruction test also asserts monotonic
cursor progress. No omitted thought or hidden event is added to a page. The nine
source tests pass, including frozen media, audience boundaries and paused previews.
