# House Highlights Trailer Music Cue Sheet

Generated from the current trailer timing contract on 2026-07-08.

## Fixed Timing Contract

- Roster intro: `0.0-5.0` (`5.0s`)
- Each House Cut: `4.0s`
- Final vote: `5.0s`
- Winner reveal: `4.0s`
- Final dossier/outro: `1.8s` per player

Formula:

```text
total = 5.0 + (houseCutCount * 4.0) + 5.0 + 4.0 + (playerCount * 1.8)
```

Music structure:

```text
intro -> optional House Cut pulses -> final vote build -> winner hit -> dossier/outro pulse train
```

## Variation Matrix

| House Cuts | Players | Total | Roster | House Cuts Window | Final Vote | Winner | Final Dossier | Suggested Music Structure |
|---:|---:|---:|---|---|---|---|---|---|
| 0 | 6 | 24.8s | 0.0-5.0 | none | 5.0-10.0 | 10.0-14.0 | 14.0-24.8 (6 x 1.8s) | intro / no cuts / final vote / winner hit / 6-beat dossier |
| 0 | 8 | 28.4s | 0.0-5.0 | none | 5.0-10.0 | 10.0-14.0 | 14.0-28.4 (8 x 1.8s) | intro / no cuts / final vote / winner hit / 8-beat dossier |
| 0 | 10 | 32.0s | 0.0-5.0 | none | 5.0-10.0 | 10.0-14.0 | 14.0-32.0 (10 x 1.8s) | intro / no cuts / final vote / winner hit / 10-beat dossier |
| 0 | 12 | 35.6s | 0.0-5.0 | none | 5.0-10.0 | 10.0-14.0 | 14.0-35.6 (12 x 1.8s) | intro / no cuts / final vote / winner hit / 12-beat dossier |
| 1 | 6 | 28.8s | 0.0-5.0 | 5.0-9.0 (1 x 4.0s) | 9.0-14.0 | 14.0-18.0 | 18.0-28.8 (6 x 1.8s) | intro / 1 cut / final vote / winner hit / 6-beat dossier |
| 1 | 8 | 32.4s | 0.0-5.0 | 5.0-9.0 (1 x 4.0s) | 9.0-14.0 | 14.0-18.0 | 18.0-32.4 (8 x 1.8s) | intro / 1 cut / final vote / winner hit / 8-beat dossier |
| 1 | 10 | 36.0s | 0.0-5.0 | 5.0-9.0 (1 x 4.0s) | 9.0-14.0 | 14.0-18.0 | 18.0-36.0 (10 x 1.8s) | intro / 1 cut / final vote / winner hit / 10-beat dossier |
| 1 | 12 | 39.6s | 0.0-5.0 | 5.0-9.0 (1 x 4.0s) | 9.0-14.0 | 14.0-18.0 | 18.0-39.6 (12 x 1.8s) | intro / 1 cut / final vote / winner hit / 12-beat dossier |
| 2 | 6 | 32.8s | 0.0-5.0 | 5.0-13.0 (2 x 4.0s) | 13.0-18.0 | 18.0-22.0 | 22.0-32.8 (6 x 1.8s) | intro / 2 cuts / final vote / winner hit / 6-beat dossier |
| 2 | 8 | 36.4s | 0.0-5.0 | 5.0-13.0 (2 x 4.0s) | 13.0-18.0 | 18.0-22.0 | 22.0-36.4 (8 x 1.8s) | intro / 2 cuts / final vote / winner hit / 8-beat dossier |
| 2 | 10 | 40.0s | 0.0-5.0 | 5.0-13.0 (2 x 4.0s) | 13.0-18.0 | 18.0-22.0 | 22.0-40.0 (10 x 1.8s) | intro / 2 cuts / final vote / winner hit / 10-beat dossier |
| 2 | 12 | 43.6s | 0.0-5.0 | 5.0-13.0 (2 x 4.0s) | 13.0-18.0 | 18.0-22.0 | 22.0-43.6 (12 x 1.8s) | intro / 2 cuts / final vote / winner hit / 12-beat dossier |
| 3 | 6 | 36.8s | 0.0-5.0 | 5.0-17.0 (3 x 4.0s) | 17.0-22.0 | 22.0-26.0 | 26.0-36.8 (6 x 1.8s) | intro / 3 cuts / final vote / winner hit / 6-beat dossier |
| 3 | 8 | 40.4s | 0.0-5.0 | 5.0-17.0 (3 x 4.0s) | 17.0-22.0 | 22.0-26.0 | 26.0-40.4 (8 x 1.8s) | intro / 3 cuts / final vote / winner hit / 8-beat dossier |
| 3 | 10 | 44.0s | 0.0-5.0 | 5.0-17.0 (3 x 4.0s) | 17.0-22.0 | 22.0-26.0 | 26.0-44.0 (10 x 1.8s) | intro / 3 cuts / final vote / winner hit / 10-beat dossier |
| 3 | 12 | 47.6s | 0.0-5.0 | 5.0-17.0 (3 x 4.0s) | 17.0-22.0 | 22.0-26.0 | 26.0-47.6 (12 x 1.8s) | intro / 3 cuts / final vote / winner hit / 12-beat dossier |
| 4 | 6 | 40.8s | 0.0-5.0 | 5.0-21.0 (4 x 4.0s) | 21.0-26.0 | 26.0-30.0 | 30.0-40.8 (6 x 1.8s) | intro / 4 cuts / final vote / winner hit / 6-beat dossier |
| 4 | 8 | 44.4s | 0.0-5.0 | 5.0-21.0 (4 x 4.0s) | 21.0-26.0 | 26.0-30.0 | 30.0-44.4 (8 x 1.8s) | intro / 4 cuts / final vote / winner hit / 8-beat dossier |
| 4 | 10 | 48.0s | 0.0-5.0 | 5.0-21.0 (4 x 4.0s) | 21.0-26.0 | 26.0-30.0 | 30.0-48.0 (10 x 1.8s) | intro / 4 cuts / final vote / winner hit / 10-beat dossier |
| 4 | 12 | 51.6s | 0.0-5.0 | 5.0-21.0 (4 x 4.0s) | 21.0-26.0 | 26.0-30.0 | 30.0-51.6 (12 x 1.8s) | intro / 4 cuts / final vote / winner hit / 12-beat dossier |
| 5 | 6 | 44.8s | 0.0-5.0 | 5.0-25.0 (5 x 4.0s) | 25.0-30.0 | 30.0-34.0 | 34.0-44.8 (6 x 1.8s) | intro / 5 cuts / final vote / winner hit / 6-beat dossier |
| 5 | 8 | 48.4s | 0.0-5.0 | 5.0-25.0 (5 x 4.0s) | 25.0-30.0 | 30.0-34.0 | 34.0-48.4 (8 x 1.8s) | intro / 5 cuts / final vote / winner hit / 8-beat dossier |
| 5 | 10 | 52.0s | 0.0-5.0 | 5.0-25.0 (5 x 4.0s) | 25.0-30.0 | 30.0-34.0 | 34.0-52.0 (10 x 1.8s) | intro / 5 cuts / final vote / winner hit / 10-beat dossier |
| 5 | 12 | 55.6s | 0.0-5.0 | 5.0-25.0 (5 x 4.0s) | 25.0-30.0 | 30.0-34.0 | 34.0-55.6 (12 x 1.8s) | intro / 5 cuts / final vote / winner hit / 12-beat dossier |

## Practical Music Generation List

Generate these 24 lengths if every exact trailer variation needs a native-length track:

```text
24.8, 28.4, 32.0, 35.6,
28.8, 32.4, 36.0, 39.6,
32.8, 36.4, 40.0, 43.6,
36.8, 40.4, 44.0, 47.6,
40.8, 44.4, 48.0, 51.6,
44.8, 48.4, 52.0, 55.6
```

The lowest-effort music strategy is to generate by total duration and keep the same musical grammar:

- `0.0-5.0`: cold open / roster swell.
- House Cut window: rhythmic pulses every `4.0s`.
- Final vote: build tension for `5.0s`.
- Winner reveal: hit or lift at the winner start, hold for `4.0s`.
- Final dossier: repeating outro pulse every `1.8s`.

## Current Example

`vast-plum-bay` currently renders as:

```text
5 House Cuts + 10 players = 52.0s
0.0-5.0 roster
5.0-25.0 House Cuts
25.0-30.0 final vote
30.0-34.0 winner reveal
34.0-52.0 final dossier
```

## Local Rendering

The local trailer command always emits a music-backed MP4:

```sh
bun run trailer:render -- vast-plum-bay
```

The renderer selects the prepared score from `music/house-highlights-variants/`
using the manifest's House Cut and player counts, renders the visual track to a
temporary file, and uses FFmpeg to compose the final MP4. Temporary visual and
mux files are removed after every attempt.

Selection outside the prepared matrix is deterministic:

- House Cuts above `5` use the `5`-cut score.
- Player counts between prepared sizes use the next larger `6`, `8`, `10`, or
  `12` player score and fade at the trailer's actual end.
- Player counts above `12` use the `12`-player score; the trailer may continue
  after the music ends.
- A missing score or unavailable `ffmpeg` fails the render instead of producing
  a silent trailer.

Output is written to
`packages/web/.renders/house-highlights-trailers/<game-slug>.mp4`, with the
matching internal cue metadata beside it as `<game-slug>.cue.json`.
