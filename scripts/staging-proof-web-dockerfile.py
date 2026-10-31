#!/usr/bin/env python3
"""Derive proof web packaging from the release Dockerfile without map upload."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.read_text()
    assertion = 'RUN test -z "$(find .next/static -name \'*.map\' -print -quit)"'
    if source.count(assertion) != 1:
        raise SystemExit("expected exactly one release browser-map assertion")
    cleanup = "RUN find .next/static -type f -name '*.map' -delete\n"
    args.output.write_text(source.replace(assertion, cleanup + assertion))


if __name__ == "__main__":
    main()
