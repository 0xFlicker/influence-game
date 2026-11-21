# Music selection and local generation

## Preference order

1. **Existing game music files:** inspect the authorized game/Studio asset manifest and available local assets. Choose a suitable track, verify its provenance and permitted use, and preserve its identity. Do not assume every uploaded track is cleared merely because it is in a game.
2. **Local `minimax_music3_mlx`:** generate a fitting instrumental when game assets do not fit or the user wants original music. Use the real local runtime and installed weights; do not silently substitute an online generation service.
3. **Creative Commons fallback:** use a suitable track whose actual license permits the intended sharing. Retain the source URL, title, creator, license URL/version and required attribution. Do not describe CC music generically as copyright-free. Prefer a permissive option compatible with editing and monetization when relevant.

Do not let choosing music expand into an unrelated music search task. Match emotional arc, energy and transitions while leaving room for speech.

## Known local MiniMax runtime

A verified local checkout was `/Users/user/Development/minimax-music3-mlx`. Treat this as a discovery hint; check that it still exists and read its README and CLI help before running. The module is `minimax_music3_mlx.generate`; the console entrypoint is `minimax-music3`. Use that project's environment, not an unrelated MLX venv.

Observed CLI shape:

```sh
/path/to/project/.venv/bin/python -m minimax_music3_mlx.generate \
  --weights /path/to/converted/weights \
  --lyrics '[instrumental]' \
  --prompt 'Instrumental suspense underscore, restrained pulse, rising tension, no vocals, no spoken words, space for narration.' \
  --duration 60 \
  --steps 30 \
  --seed 42 \
  --output /path/to/package/music/candidate.wav
```

The observed CLI requires `--lyrics`. `[instrumental]` is a candidate prompt convention, not a verified switch guaranteeing no vocals; inspect local examples/support and listen to the result. Do not invent an `--instrumental` flag. `--duration` is an upper bound, not a promised output length. Measure actual duration before composing. `--tiny` uses random test weights and is not a production music mode. Check memory/disk and reuse installed weights; do not start a large download or conversion merely to inspect capabilities.

Save prompt, seed, weight/runtime identity, generated WAV, measured duration and usage provenance. The code license and model-weight/output terms are different; consult the actual local license/NOTICE when needed, without inventing an attribution requirement.

## Mix after picture edit

Maintain a clean narration/SFX master and a separate music track. Audition underneath speech, automate dips around key lines, and avoid relying on a limiter to fix masking. Loudness targets depend on destination and material; measure the final file and listen rather than treating one LUFS value as universal.

Remove accidental baked-in music only when it is actually present. Source separation can help salvage narration but may create artifacts: retain the original and compare. Never discard a good source because one automated reviewer labels a low rumble as music, especially after the user directly corrects that finding.

For loops, check music as well as speech at the end-to-start seam. A long fade or dead tail can weaken the hook. Use a musically appropriate edit/crossfade and a short pause after the hook; avoid cutting off the last consonant.
