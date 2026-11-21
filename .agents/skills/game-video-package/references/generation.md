# Scene generation and continuity

## Prompt construction

Use this order: reference identities → shot purpose and visual style → camera and precise blocking → timed action → speaker/audio contract → prohibitions → authoritative game facts. Keep authoritative facts near the end, separated from creative staging, so a long stylistic preamble does not bury them.

- Describe camera-relative positions and which side of a barrier each character occupies. For a door save, a continuous interior viewpoint with both protected characters inside is easier to preserve than reversing across the threshold.
- If the camera faces a character looking at other villagers, those villagers may be foreground shoulders opposite the character, not inexplicably behind them.
- Avoid abstract role labels alone. Bind each character to named reference images, distinguishing face, hair, costume colors and silhouette.
- Separate nighttime action from dawn results. A saved target is alive at dawn; a dark atmosphere is not evidence that a scene occurs at night. Say when a scene occurs explicitly.
- Give only one active speaking source at a time. For offscreen narration, say that visible characters are silent and mouths remain closed; favor hand/eye/prop inserts when the model repeatedly lip-syncs the wrong person. Add narration in editing rather than trusting another complex prompt retry.
- A direct character quote needs the correct speaker, exact words, and deliberate timing. Do not assign narrator summaries to that character.
- Ask for diegetic SFX and no music, score, singing or musical drone. Later verify what was actually generated.

## Katana H3 adapter notes

Read the current `https://kat.imgnai.com/llms.txt` and `/v1/models` when integrating. These notes describe a previously verified shape, not a guarantee of current pricing or availability.

Use `/v1/generation-requests?wait=false`, persist the response, and poll `/v1/generation-requests/{request_id}`. Use the returned output asset URL. Do not guess media URLs or leak credentials into artifacts.

Image references belong in `video_image_data.reference_image_urls`. An obsolete top-level `input_images` example previously produced successful jobs with no references at all. Inspect the accepted request/receipt for retained references before paying for the rest of a batch.

H3 audio-reference inputs use `video_image_data.audio_list` with a documented `url` or `base64_data` object. Verify minimum duration, supported formats and model rules. Do not confuse a timbre reference with an audio track that drives the picture duration. Reference content and first/last-frame conditioning can have incompatible model rules.

Minimal structural example (populate only currently supported fields):

```json
{
  "client_request_id": "stable-unique-shot-attempt-id",
  "requests": [{
    "id": "shot-01",
    "type": "video",
    "model": "imgnh3",
    "mode": "768p",
    "aspect_ratio": "9:16",
    "duration_seconds": 10,
    "prompt": "Complete shot and audio instructions, ending with authoritative facts.",
    "video_image_data": {
      "reference_image_urls": ["data:image/png;base64,..."]
    }
  }]
}
```

Check actual output dimensions/fps with ffprobe; provider aspect labels and estimates are not encoding evidence. For a reference-conditioned job, rendering can take many minutes. Sleep between checks and avoid unnecessary duplicate spending. If credits run out, distinguish a failed submission from an already accepted job before retrying.

Prefer direct asset download when supported. If a media host requires its normal browser flow, use the available browser tools. A download timeout can be a Chrome modal: inspect the UI and download state rather than rerendering or repeatedly triggering downloads. Preserve the successful local source before editing.
