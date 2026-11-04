# Intermediate qualification history

These are retained findings from before the eager-loading and Safety Bounce
observer fixes. Statements that a cause is unresolved or implementation remains
gated describe that intermediate stage. See the [current plan](../../2026-11-02-render-speed-100x.md)
for subsequent diagnosis, actual implementation and validation. Failed raw trials
remain under their original `.renders/` paths.

## Capture/encoder controls — 2026-11-03

[Raw-capture and encoder controls](capture-isolation.md)
matched across repeated PNG/JPEG sequences, identical-input encodes, and four
movies with their actual input JPEGs retained. These stable runs do not explain
the earlier intermittent variability. Next instrument readiness stages and frame
ownership rather than weakening comparison gates or repeating uninstrumented trials.

## Historical isolation before readiness fixes — 2026-11-03

The following three sections retain intermediate findings. Their implementation
gates were subsequently resolved by the eager-loading and observer experiments
above; their failed artifacts remain part of the evidence.

[Isolated controls](readiness-isolation.md) completed
two more full screenshot-free preparations with exact manifests. The preparation
timeout remains intermittent and unexplained. A repeated one-tab movie differs
while both four-tab trials match the first reference: rendering variability is
not exclusive to parallel pages. Isolate raw browser capture from encoding next;
keep implementation gated on correctness and reliability evidence.

## Historical empty-layout investigation — 2026-11-03

[The traced controls](empty-layout-trace.md)
locate the differing empty-text key in a no-speech Safety Bounce cue. Exaggerating
all cached empty-speech values leaves its tested output unchanged. Repeated PNG
preparation matches the original, but repeated movies from the same PNG bundle
vary; a repeated screenshot-free movie matches the reference. Existing scene
render variability and a newly observed screenshot-free readiness timeout remain
unresolved. Keep the optimization experimental; do not mistake this metadata
mismatch for demonstrated picture damage or claim general output equivalence.

## Initial qualification before readiness fixes — 2026-11-03

[Both-game video qualification](video-preparation-proof.md)
passed exact decoded video/timing/audio comparisons for complete openings and
sampled gameplay in both games (eight movies, 6,258 decoded frames). Werewolf's
complete preparation matches; a further Influence run changed one empty-text
layout key, reproducing the earlier JPEG key-set difference. Screenshot-free
preparation remains experimental pending diagnosis of that variability. Earlier
exact matches below remain valid observations, not a universal equivalence claim.
