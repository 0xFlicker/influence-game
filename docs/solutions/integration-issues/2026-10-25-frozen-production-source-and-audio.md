---
module: Production Studio
problem_type: integration_issue
tags: [werewolf, audio, immutable-evidence, exports, source-hash]
---

# Preserve frozen production authority across successors

An active audio track is a discovery pointer, not authority for a previously
published recording. Reading every version through the active track invalidated
frozen exports when retakes, voice recovery or House refresh published successors.
Resolve requested versions through their original game-scoped track, recipe and
published frontier. Keep unpublished successor copies inaccessible. Validate the
recording against the frozen moment's text and speaker, and have CLI exports request
the descriptor's exact version IDs instead of today's manifest.

Werewolf descriptors originally hashed a recomputed catalog without recording the
projection contract. Phase scenes, proposal defaults, pass-thinking exclusion,
head geometry and cutout binding changed that computation. New snapshots explicitly
hash their projection version. For an unversioned descriptor, reconstruct the
historical contracts and require exact equality with the entire saved hash. Return
the matched catalog contract to Studio and export without rewriting evidence or
reselecting the cut. Historical pass-thinking reconstruction is restricted to exact
old hashes; new/live playback keeps skipping passes.

A literal origin/main fixture captures canonical events, catalog and source hash
using that revision's source builder and assembler. Regressions also freeze audio,
publish retakes/refresh/recovery successors and read original versions, while
rejecting foreign games, wrong audiences, recipe mismatches and unpublished copies.
Source hashes do not recover removed external mapping inputs or an unretained
historical rendering compiler; preserve original bundles and fail closed when
required evidence is absent.
