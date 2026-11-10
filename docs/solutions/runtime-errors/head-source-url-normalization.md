---
module: Agent profiles
tags: [head-position, image-identity, storage, local-development]
problem_type: runtime_error
date: 2026-11-07
---

# Text-only saves rejected an unchanged image

An older dev profile stored an absolute localhost image URL and confirmed head
coordinates. The edit request normalized the body URL to the API proxy's origin,
while its coordinates retained the original URL. Comparing raw URL origins made
the same stored object look like a different image and rejected a backstory edit.

Head and portrait source comparisons now use the existing upload URL normalizer
with the request's public base URL. Source hashes, decoded dimensions, portrait
containment, ownership and confirmed geometry remain required. This changes no
image bytes or historical revisions and dispatches no image generation.

The profile API regression crosses localhost and proxy origins, preserves the
source hash and geometry, and rejects a genuinely different source. Real-browser
testing then saved the previously failing GPT Sol backstory edit successfully.
