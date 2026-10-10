import {expect, test} from "bun:test";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch} from "@influence/engine/werewolf/watch";
import {buildExportCues} from "./cues";
import {importBrowserSpeech, prepareBrowserSpeech} from "./speech-browser";

async function speechSource() {
  const events = await werewolfResultsFixture("village", "browser-speech");
  const projected = projectWerewolfWatch(events, "omniscient", 1, 64);
  const cue = buildExportCues({kind: "werewolf", windows: [{...projected, slug: "browser-speech", status: "completed", audience: "omniscient", publicationCutoff: "2026-10-09T00:00:00Z", media: {}}], thoughts: []}).find(cue => cue.speech)!;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cue.speech!.text));
  const textHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return {source: [{id: "speech-moment", segments: [cue]}], entry: {messageId: cue.speech!.messageId, speakerId: cue.speech!.speakerId, textHash, file: "speech.wav"}};
}

test("browser recording import validates complete identities while omitted audio stays unopened", async () => {
  const {source, entry} = await speechSource();
  let reads = 0;
  const audio = new File(["unread fixture"], "speech.wav");
  audio.arrayBuffer = async () => {reads++; throw new Error("Selected recording file is unreadable");};
  const manifest = (entry: unknown) => new File([JSON.stringify([entry])], "speech.json", {type: "application/json"});
  const signal = new AbortController().signal;
  const imported = await importBrowserSpeech([manifest(entry), audio], source, signal);
  const omitted = await prepareBrowserSpeech(imported, source, [], signal);
  expect(omitted.assets).toEqual({}); expect(omitted.recordings).toEqual([]); expect(reads).toBe(0);
  for (const changed of [{speakerId: "wrong"}, {messageId: "handcrafted-private-reference"}, {textHash: "a".repeat(64)}]) {
    await expect(importBrowserSpeech([manifest({...entry, ...changed}), audio], source, signal)).rejects.toThrow();
  }
  expect(reads).toBe(0);
  await expect(prepareBrowserSpeech(imported, source, ["speech-moment"], signal)).rejects.toThrow("Selected recording file is unreadable");
  expect(reads).toBe(1);
});

test("selected missing local audio and unsafe file references fail explicitly", async () => {
  const {source, entry} = await speechSource(), signal = new AbortController().signal;
  const manifest = (file: string) => new File([JSON.stringify([{...entry, file}])], "speech.json");
  const missing = await importBrowserSpeech([manifest("speech.wav")], source, signal);
  await expect(prepareBrowserSpeech(missing, source, [], signal)).resolves.toMatchObject({assets: {}, recordings: []});
  await expect(prepareBrowserSpeech(missing, source, ["speech-moment"], signal)).rejects.toThrow("Choose the local audio file");
  await expect(importBrowserSpeech([manifest("../speech.wav")], source, signal)).rejects.toThrow("plain audio filenames");
});
