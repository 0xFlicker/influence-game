---
title: Preserve canonical retrospectives when recording an English retake
date: 2026-10-25
module: Production Studio
problem_type: integration_issue
tags: [retrospective, werewolf, audio, provider-prompts, immutable-evidence]
---

A valid retrospective may be delivered in a language unsuitable for an episode. Replacing the accepted event would invalidate canonical evidence and the contexts supplied to later speakers. Replacing only the displayed text would also leave voice playback saying the old statement.

Apply primarily-English guidance at the shared provider adapter for future calls, without rejecting otherwise valid non-English output. Repair an existing statement with a separate editorial retake bound to the original event hash. Generate from the original speaker context, preserve every provider attempt, and store the complete document in the private bucket with an inventoried database reference.

Build a successor audio track that reuses every unaffected recording and generates the one changed line with the frozen voice. Publish its retake metadata atomically with activation of the ready track. Failed generation keeps the previous track and statement active. Read published retakes through the same publication cutoff as the presentation; never alter canonical replay reduction or contestant recall.

The PostgreSQL regression tests cover successful publication, unchanged event rows and previous audio versions, original pinned source reads, stale previews, failed synthesis and retry. See [the operator commands](../../game-retrospective-runtime.md#editorial-retakes-on-localhost).
