import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { projectWerewolfWatch } from "@influence/engine/werewolf/watch";
import { buildExportCues } from "./cues";
import { attachSpeech } from "./speech";
import { sha256, type ReplayAssets } from "./assets";

test("recordings require an exact speaker and text identity; missing files never become silent speech", async () => {
  const events = await werewolfResultsFixture("village", "speech-export");
  const projected = projectWerewolfWatch(events, "omniscient", 1, 64);
  const cues = await buildExportCues(
    {
      kind: "werewolf",
      windows: [
        {
          ...projected,
          slug: "speech-export",
          status: "completed",
          audience: "omniscient",
          publicationCutoff: "2026-10-01T00:00:00Z",
          media: {},
        },
      ],
      thoughts: [],
    },
    false,
  );
  const cue = cues.find((c) => c.speech)!;
  expect(cue).toBeDefined();
  const attachment = {
    messageId: cue.speech!.messageId,
    speakerId: cue.speech!.speakerId,
    textHash: sha256(cue.speech!.text),
    file: "speech.wav",
  };
  const root = await mkdtemp(join(tmpdir(), "replay-speech-test-")),
    path = join(root, "speech.json");
  let reads = 0;
  const assets: Pick<ReplayAssets, "cache" | "table"> = {
    table: {
      voice: {
        path: "voice",
        sha256: "fixture",
        mediaType: "audio",
        durationMs: 3200,
        sampleRate: 24000,
      },
    },
    async cache() {
      reads++;
      return "voice";
    },
  };
  const save = async (value: unknown) => writeFile(path, JSON.stringify(value));
  try {
    for (const changed of [
      { speakerId: "wrong" },
      { textHash: "changed" },
      { messageId: "unknown" },
    ]) {
      await save([{ ...attachment, ...changed }]);
      await expect(attachSpeech(path, cues, assets)).rejects.toThrow();
    }
    expect(reads).toBe(0);
    await save([attachment]);
    await attachSpeech(path, cues, assets);
    expect(cue.timing.recording).toEqual({
      assetId: "voice",
      durationMs: 3200,
    });
    await save([attachment, attachment]);
    await expect(attachSpeech(path, cues, assets)).rejects.toThrow("duplicate");
    await save([attachment]);
    await expect(
      attachSpeech(path, cues, {
        table: {},
        async cache() {
          throw new Error("Recording file missing");
        },
      }),
    ).rejects.toThrow("Recording file missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
