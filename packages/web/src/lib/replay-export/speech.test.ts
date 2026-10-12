import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { projectWerewolfWatch } from "@influence/engine/werewolf/watch";
import { buildExportCues } from "./cues";
import { attachSpeech } from "./speech";
import { sha256, type ReplayAssets } from "./assets";

test("recordings require an exact speaker and text identity; missing files never become silent speech", async () => {
  const events = await completedWerewolfResultsFixture("village", "speech-export", 1);
  const projected = projectWerewolfWatch(events, "omniscient", 1, 64);
  const cues = buildExportCues(
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
  );
  const cue = cues.find((c) => c.picture.kind === "werewolf" && c.picture.cue.moment.entry.kind === "speech"
    && c.picture.cue.moment.entry.purpose === "retrospective")!;
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
    await attachSpeech(path, [], assets, cues);
    expect(reads).toBe(0);
    await save([{...attachment,speakerId:"wrong"}]);
    await expect(attachSpeech(path, [], assets, cues)).rejects.toThrow("mismatch");
    await save([attachment]);
    await attachSpeech(path, cues, assets);
    expect(cue.timing.recording).toEqual({
      assetId: "voice",
      durationMs: 3200,
    });
    await save([attachment, attachment]);
    await expect(attachSpeech(path, cues, assets)).rejects.toThrow("duplicate");
    await save([attachment]);
    cue.momentId = "speech-moment";
    assets.table.voice!.sha256 = "a".repeat(64);
    const frozen = [{momentId:cue.momentId,...attachment,sha256:"a".repeat(64),durationMs:3200}];
    const {file:_file,...evidence} = frozen[0]!;void _file;
    const beforeFrozen = reads;
    await attachSpeech(path,cues,assets,cues,[]);
    expect(reads).toBe(beforeFrozen);
    await expect(attachSpeech(path,[{...cue,momentId:undefined}],assets,cues,[evidence])).rejects.toThrow("no matching selected moment");
    expect(reads).toBe(beforeFrozen);
    await attachSpeech(path,cues,assets,cues,[evidence]);
    expect(cue.timing.recording?.durationMs).toBe(3200);
    await expect(attachSpeech(path,cues,assets,cues,[{...evidence,sha256:"b".repeat(64)}])).rejects.toThrow("bytes/duration changed");
    await expect(attachSpeech(path,cues,assets,cues,[{...evidence,durationMs:3600}])).rejects.toThrow("bytes/duration changed");
    await save([]);
    await expect(attachSpeech(path,cues,assets,cues,[evidence])).rejects.toThrow("missing");
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
