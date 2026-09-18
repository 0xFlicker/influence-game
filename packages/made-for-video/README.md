# Made for Video

Private producer tooling for turning a completed House game into a cinematic **video study**: choose a defensible scene, preserve its transcript, design coverage from the players' strategic intent, render controlled shots, and assemble a review cut.

This package is an experimental producer lane. It does **not** replace the House Highlights publication pipeline. Public House Highlights must still use selected-scene receipts, Visual Briefs, durable media bundles, and the established render worker. This package may use private producer artifacts, including thinking and strategy, so its captures and render outputs are intentionally ignored by Git.

## Principles

1. **Select stories from evidence; renderers never invent them.** A House summary can surface candidates, but confirm exits, powers, votes, and relationships against canonical events before presenting them as fact.
2. **Use private thinking for performance, not truth.** It can motivate a hesitant look, a guarded plea, or measured calculation. It must not cause the video to assert an unsupported betrayal, ballot, alliance, or unseen action.
3. **Start with a scene contract.** Capture the exact source dialogue, the confirmed facts, the emotional inference, camera coverage, audio intent, and what is forbidden before calling a model.
4. **Generate in layers.** First create and approve still keyframes, then generate short individual shots, then compose. Do not spend on a long render before the characters, geography, eye lines, and visual language work in a still.
5. **Treat external render jobs as recoverable.** Poll individual responses, download completed outputs immediately, and retry only stalled or failed angles. Never discard a completed reverse shot because its paired shot is slow.

## Workflow

### 1. Find an interesting game and moment

Browse recent public House game summaries for explicit editorial signals: a scheme, counter-plan, betrayal, exposed alliance, pressure move, reversal, power choice, or final plea. Prefer a moment with:

- a clear turn in incentives;
- concrete stakes that can be confirmed in events;
- dialogue from at least two players;
- a readable emotional contrast; and
- coverage potential: a reaction, reply, reveal, or decision.

Do not choose solely because a summary sounds dramatic. A render must have enough source dialogue and confirmed game context to stay specific.

Save the recent public-summary response from the House MCP, then rank it locally without making a second live request:

```bash
bun run --filter @influence/made-for-video game-candidates -- \
  /private/tmp/recent-house-game-summaries.json \
  packages/made-for-video/captures/recent-game-candidates.md
```

### 2. Export the full producer transcript

Authenticate first with the existing game MCP login flow, then export into an ignored directory. The export contains dialogue, Mingle, huddles, diary/plea material when present, thinking, strategy artifacts, and system narration.

```bash
bun run --filter @influence/made-for-video export:producer -- \
  sharp-tan-reef packages/made-for-video/captures/sharp-tan-reef
```

By default the exporter uses the short-lived token saved by `bun run mcp:game:login`; set `INFLUENCE_MCP_TOKEN` or `INFLUENCE_MCP_TOKEN_FILE` only when necessary. It writes private files with owner-only permissions.

Then create a review list from the capture:

```bash
bun run --filter @influence/made-for-video scene-candidates -- \
  packages/made-for-video/captures/sharp-tan-reef/capture.json \
  packages/made-for-video/captures/sharp-tan-reef/scene-candidates.md
```

The candidate scorer is a heuristic. It ranks private dialogue moments containing strategic tension; it does not establish truth or decide the final scene.

### 3. Write a scene contract and design coverage

For every chosen beat, record:

| Field | Example from `sharp-tan-reef` |
| --- | --- |
| Confirmed premise | Vesper is a proposed influence-test pressure point, not an automatically declared exit. |
| Exact spoken source | Preserve the selected transcript excerpt; do not add strategic claims to dialogue. |
| Arden’s playable subtext | Avoid being the easy pointer target; redirect pressure while preserving relationships. Play this as restrained urgency, not collapse. |
| Mara’s playable subtext | Test a useful network/chooser node while retaining a legal, evidence-first caveat. Play this as measured calculation. |
| Arden coverage | Camera over Mara’s shoulder; Mara’s back/hair in foreground; Arden looks at Mara, not into camera. |
| Mara coverage | Reverse over Arden’s shoulder; Arden’s back/hair in foreground; Mara looks at Arden. |
| Audio | Request clear natural English dialogue and diegetic rain, fabric, chair, and room ambience. Explicitly prohibit score and background music. |
| Forbidden | Empty-table solo coverage, direct-to-camera delivery, portrait-card opening, captions/text, unsupported physical action, melodrama. |

The key lesson from the first attempts was that using a portrait as a video `input_image` made the portrait become the opening shot. The reliable workaround was:

```text
both avatar references + static background plate
  -> image model creates each over-the-shoulder in-world keyframe
  -> keyframe becomes video model first frame for that one angle
  -> compose the matching reverse angles
```

In the keyframe prompt, assign the foreground/back clearly: “Mara’s dark wavy hair, shoulder, and jacket are softly out of focus in the near left foreground; Arden is the focused speaking subject across the table.” Reverse that assignment for Mara’s angle. This anchors eye lines and prevents two empty-table solo shots.

Copy [`templates/scene-contract.md`](templates/scene-contract.md) into an ignored capture directory for every approved scene.

### 4. Render with Katana

`src/katana-video.ts` is the reusable Katana proof-of-work CLI and contains the approved `sharp-tan-reef` example workflow. Its credentials are read only from Doppler-provided `API_KAT_IMGNAI_KEY` and `API_KAT_IMGNAI_SECRET`; it never prints them.

Set private paths before invoking it:

```bash
export MADE_FOR_VIDEO_OUTPUT_DIRECTORY=/private/tmp/sharp-tan-reef/katana
export MADE_FOR_VIDEO_AVATAR_DIRECTORY=/private/tmp/sharp-tan-reef/avatars

doppler run --project social-strategy-agent --config dev -- \
  bun run --filter @influence/made-for-video katana -- submit-ots-keyframes
```

Review stills before submitting 10-second video angles. The CLI keeps the current tested commands for background plates, image-composed keyframes, and video angles. Its over-the-shoulder recovery commands are:

```bash
# Download whatever finished; does not wait for a paired response.
doppler run --project social-strategy-agent --config dev -- \
  bun run --filter @influence/made-for-video katana -- poll-ots-video-angles <batch-request-id>

# Retry just one stalled response.
doppler run --project social-strategy-agent --config dev -- \
  bun run --filter @influence/made-for-video katana -- retry-ots-video-angle arden-ots-anchor

# Poll/download just that retry.
doppler run --project social-strategy-agent --config dev -- \
  bun run --filter @influence/made-for-video katana -- poll-ots-video-angle <request-id> arden-ots-anchor

# Recover a late completed output without overwriting a successful retry.
doppler run --project social-strategy-agent --config dev -- \
  bun run --filter @influence/made-for-video katana -- \
  recover-ots-video-angle <original-request-id> arden-ots-anchor arden-original-late.mp4
```

Use the provider’s actual output audio. Request dialogue plus diegetic ambience and explicitly request **no background music**. That is a prompt constraint, not a post-processing guarantee; do not claim exact dialogue fidelity until a human watches and hears the output.

### 5. Compose outputs

Keep raw angles. Compose from fully downloaded clips, maintaining video and audio together at every trim boundary. The `sharp-tan-reef` review cut used Arden then Mara; a later version removed 1.5 seconds from Mara’s start, trimming its video and generated audio together.

```bash
ffmpeg -y \
  -i arden-ots-anchor.mp4 \
  -ss 1.5 -i mara-ots-anchor.mp4 \
  -filter_complex '[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[video][audio]' \
  -map '[video]' -map '[audio]' \
  -c:v libx264 -c:a aac -movflags +faststart \
  arden-mara-ots-composition-mara-trimmed.mp4
```

Verify every deliverable:

```bash
ffprobe -v error \
  -show_entries format=duration:stream=codec_type,codec_name \
  -of json final-cut.mp4
```

The review cut must have a nonzero duration, H.264 video, and AAC audio. Watch it: a structurally valid MP4 does not prove identity continuity, spoken-word fidelity, eye lines, or absence of music.

## What this package does not do

- publish or upload media;
- make a public factual claim from private thinking;
- replace the durable House Highlights media bundle or render worker;
- silently re-render a slow provider request; or
- treat generated dialogue as verbatim transcript without human confirmation.

## Validation

```bash
bun run --filter @influence/made-for-video typecheck
bun run --filter @influence/made-for-video lint
```
