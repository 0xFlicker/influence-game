---
module: Render execution
tags: [studio, native-worker, finalization, reconciliation, lease]
problem_type: integration
date: 2026-11-02
---

# Native render output stalled in verification

A real native Studio export encoded and uploaded a 48,381,189-byte movie, then
remained at 95% in `verifying`. The API game-worker bootstrap started render
reconciliation only for remote rendering. The isolated local proof had its own
verification timer, so it did not expose that missing startup wiring.

Start the shared dispatcher in every game-worker runtime. Its existing workload
and environment checks already prevent local execution from dispatching cloud
work or waking the remote controller. The proof harness now uses this same
dispatcher instead of calling verification on a separate timer.

Accepted finalization persists a receipt and transfers ownership to the durable
verifier. An expired worker lease must not fail that already-uploaded output or
prevent verified completion. Expired rendering/uploading attempts still fail;
late completion remains fenced by execution, state and lease identity, so
cancellation and retry retain their authority. A worker cannot submit a new
finalization request after its upload lease expires.

Focused regressions exercise ordinary local reconciliation after worker lease
expiry, cancellation racing storage verification, and an old integrity failure
returning after a newer retry has already reached verification. Both success and
failure updates compare the captured execution/state/lease identity.
The normal localhost worker
recovered the existing output to `succeeded` at 100%; no re-encode or history
mutation was required. The completed per-render child formerly serving port 3003
was terminated cleanly, preserving the polling parent, API and web services.

The final render-job suite passed all 12 cases. Fresh native browser/MCP proof at
`.renders/order-proof-1793654994286/proof.json` completed both game exports through
the ordinary shared reconciler and verified private downloads, with its temporary
database removed. The companion browser order/monitor stories also passed. These
local results do not establish cloud execution or long-duration staging behavior.
