#!/usr/bin/env python3
"""Validate final-clock subtitle phrases and write frame-aligned JSON/SRT."""
import argparse
import json
import math
from pathlib import Path


def prepare(cues, fps, duration):
    if not math.isfinite(fps) or fps <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError('fps and duration must be finite and positive')
    if not isinstance(cues, list) or not cues:
        raise ValueError('Expected a nonempty cue array')
    parsed = []
    previous = -1.0
    for index, cue in enumerate(cues):
        start, end = float(cue['start']), float(cue['end'])
        text = cue['text']
        if not isinstance(text, str) or not text.strip() or '\n\n' in text or '-->' in text:
            raise ValueError(f'Invalid subtitle text at cue {index + 1}')
        if not all(math.isfinite(t) for t in (start, end)) or not 0 <= start < end <= duration:
            raise ValueError(f'Invalid interval at cue {index + 1}')
        if start <= previous:
            raise ValueError('Cue starts must be strictly increasing')
        parsed.append({'start': start, 'end': end, 'text': text.strip()})
        previous = start
    frame_count = math.ceil(duration * fps - 1e-9)
    output = []
    previous_end = 0
    for index, cue in enumerate(parsed):
        first = math.ceil(cue['start'] * fps - 1e-9)
        end = min(frame_count, math.ceil(cue['end'] * fps - 1e-9))
        if index + 1 < len(parsed):
            end = min(end, math.ceil(parsed[index + 1]['start'] * fps - 1e-9))
        if end <= first or first < previous_end:
            raise ValueError(f'Cue {index + 1} has no distinct display frame')
        output.append({'start': first / fps, 'end': min(end / fps, duration),
                       'startFrame': first, 'endFrameExclusive': end, 'text': cue['text']})
        previous_end = end
    # Audit event boundaries rather than allocating one element per movie frame.
    for left, right in zip(output, output[1:]):
        if left['endFrameExclusive'] > right['startFrame']:
            raise ValueError('Overlapping output cues')
    return output


def stamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--fps', type=float, required=True)
    parser.add_argument('--duration', type=float, required=True)
    parser.add_argument('--out', type=Path, required=True, help='Output prefix, without extension')
    args = parser.parse_args()
    try:
        cues = prepare(json.loads(args.input.read_text()), args.fps, args.duration)
    except (ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.with_suffix('.json').write_text(json.dumps(cues, indent=2) + '\n')
    args.out.with_suffix('.srt').write_text('\n\n'.join(
        f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}"
        for i, c in enumerate(cues, 1)) + '\n')
    print(f'Wrote {len(cues)} nonoverlapping cues at {args.fps:g} fps')


if __name__ == '__main__':
    main()
