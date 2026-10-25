# Gemini Pro masculine android revision

Generated with built-in image generation on 2026-10-25; exact prompt is in `prompt.txt`. References: prior Gemini male full-body cutout and Claude Sonnet portrait for manufactured facial construction only. No direct paid provider CLI, game, or speech requests were made for this revision.

`input/gemini-android.png` preserves the generated original. Offline `house-character-cutouts:local` Docker/BiRefNet produced `cutout-output/gemini-android.png` with networking disabled. Existing `stage-character-art.ts` derived the active assets in `published-assets/`: full-body source, transparent cutout, background-backed portrait, and circular portrait. Head crop and full-body framing remain unchanged.

`publication-before.json` preserves the prior local appearance manifest. `publication.json` records four appended Gemini overrides for the two debug and two clean localhost games. Original assets and old manifest entries remain intact; Agent Profiles, recorded events and existing rendered exports were not rewritten. Future games continue to use profile defaults unless separately updated.

`verification.json` checks served cutout and portrait hashes in both clean games, validates the new Gemini alpha, and proves the other seven characters remain byte-identical. The initial audit in `verification-initial.json` also required fully opaque pixels in every unchanged old asset; Kimi's existing cutout did not meet that unrelated condition. The final check scopes new alpha requirements to Gemini while retaining exact hash checks for every other asset.

Browser evidence: `/Users/user/Documents/Codex/2026-10-24/task/evidence/localhost-return/gemini-android-browser.jpg` shows the new transparent Gemini opening frame in the Werewolf localhost viewer. No unrelated playback, export or music repairs were performed.
