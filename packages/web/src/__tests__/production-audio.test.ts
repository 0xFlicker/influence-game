import {expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {QueryClient} from "@tanstack/react-query";
import {prepareProductionAudio} from "../lib/production-studio";
import type {CachedAsset} from "../lib/replay-export/assets";
import type {PublishedAudioClip} from "@influence/engine/audio-track";

test("Studio reads generated audio through its session and caches verified disposable URLs", async () => {
  const bytes = new TextEncoder().encode("stored audio fixture");
  const clip: PublishedAudioClip = {momentId:"moment",speakerId:"actor",textHash:"text",versionId:crypto.randomUUID(),
    sha256:createHash("sha256").update(bytes).digest("hex"),durationMs:1234,url:"/api/admin/production/games/hidden/audio/version?audience=omniscient&thinking=on"};
  const cache = {assets:new Map<string,CachedAsset>(),urls:new Map<string,string>()};
  const signal = new AbortController().signal; let reads = 0;
  const read = async (url:string, receivedSignal:AbortSignal) => {
    expect(url).toBe(clip.url);expect(receivedSignal).toBe(signal);reads++;return new Blob([bytes],{type:"audio/mpeg"});
  };
  try {
    const asset = await prepareProductionAudio(clip,signal,cache,read);
    expect(asset.path).toStartWith("blob:");expect(asset.sha256).toBe(clip.sha256);
    expect(asset.durationMs).toBe(clip.durationMs);expect(cache.urls.get(clip.url)).toBe(asset.path);
    expect(await prepareProductionAudio(clip,signal,cache,read)).toBe(asset);expect(reads).toBe(1);
    const fresh = {assets:new Map<string,CachedAsset>(),urls:new Map<string,string>()};
    await expect(prepareProductionAudio({...clip,sha256:"bad"},signal,fresh,read)).rejects.toThrow("integrity");
    expect(fresh.urls.size).toBe(0);expect(fresh.assets.size).toBe(0);
    const aborted = new AbortController();aborted.abort();
    await expect(prepareProductionAudio(clip,aborted.signal,fresh,read)).rejects.toThrow();
    expect(reads).toBe(2);
  } finally {cache.urls.forEach(url => URL.revokeObjectURL(url));}
});

test("cancelling generated audio before source disposal prevents a late read from recreating its URLs", async () => {
  const bytes = new TextEncoder().encode("late stored audio");
  const clip: PublishedAudioClip = {momentId:"moment",speakerId:"actor",textHash:"text",versionId:crypto.randomUUID(),
    sha256:createHash("sha256").update(bytes).digest("hex"),durationMs:1234,url:"/api/admin/production/games/hidden/audio/version?audience=omniscient&thinking=on"};
  const cache = {assets:new Map<string,CachedAsset>(),urls:new Map<string,string>()};
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const queryKey = ["admin","session","/api/admin/production/games/hidden/source?audience=omniscient&thinking=on:generated-audio","old-source"];
  let deliver!: (blob:Blob) => void, entered!: () => void;
  const reading = new Promise<void>(resolve => {entered = resolve;});
  const response = new Promise<Blob>(resolve => {deliver = resolve;});
  let preparation!: Promise<CachedAsset>;
  const query = client.fetchQuery({queryKey,queryFn:({signal}) => {
    preparation = prepareProductionAudio(clip,signal,cache,async () => {entered();return response;});
    return preparation;
  }}).catch(() => null);
  try {
    await reading;
    // Match workspace ordering: abort reads before removing cached results and disposing URLs.
    await client.cancelQueries({queryKey});client.removeQueries({queryKey});
    cache.urls.forEach(url => URL.revokeObjectURL(url));cache.urls.clear();cache.assets.clear();
    deliver(new Blob([bytes],{type:"audio/mpeg"}));
    await expect(preparation).rejects.toThrow();await query;
    expect(cache.urls.size).toBe(0);expect(cache.assets.size).toBe(0);
    expect(client.getQueryData(queryKey)).toBeUndefined();
  } finally {client.clear();cache.urls.forEach(url => URL.revokeObjectURL(url));}
});
