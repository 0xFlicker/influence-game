import { measureAudio } from "../services/audio-provider.js";

// Exercise the production probe in the final image without providers or a database.
const fixture = Bun.spawnSync([
  "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25",
  "-ar", "44100", "-b:a", "192k", "-f", "mp3", "pipe:1",
], { stdout: "pipe", stderr: "pipe", timeout: 15_000 });
if (fixture.exitCode !== 0) {
  throw new Error(`Audio runtime fixture failed: ${new TextDecoder().decode(fixture.stderr)}`);
}
const durationMs = await measureAudio(fixture.stdout);
// MP3 encoder padding makes the measured duration slightly longer than 250 ms.
if (durationMs < 250 || durationMs > 500) {
  throw new Error(`Audio runtime returned unexpected duration: ${durationMs} ms`);
}
console.log(`Audio runtime verified: MP3 measured at ${durationMs.toFixed(1)} ms`);
