#!/usr/bin/env bash
set -euo pipefail

# The frozen Bun install already includes Remotion's Linux media binaries.
# Resolve them through the web workspace so Bun's isolated layout is respected.
media_bin_dir=$(bun --cwd packages/web -e '
  import { dirname } from "node:path";
  import { RenderInternals } from "@remotion/renderer";
  const ffprobe = RenderInternals.getExecutablePath({
    type: "ffprobe", binariesDirectory: null, indent: false, logLevel: "error",
  });
  console.log(dirname(ffprobe));
')

"$media_bin_dir/ffmpeg" -version >/dev/null
"$media_bin_dir/ffprobe" -version >/dev/null
printf '%s\n' "$media_bin_dir" >> "$GITHUB_PATH"
