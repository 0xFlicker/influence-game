import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, basename, sep } from "node:path";
import { loadWerewolfTrailerSnapshot } from "../packages/api/src/services/werewolf-trailer-snapshot";
import { createDB, closeDB } from "../packages/api/src/db";
import { hashHouseHighlightsTrailerManifest, parseHouseHighlightsTrailerManifest } from "../packages/engine/src/index";
import { renderHouseHighlightsTrailerMediaBundle, writeHouseHighlightsTrailerPlaybackMetadata } from "../packages/web/src/lib/house-highlights-trailer-media-bundle";
import { withWorkerReachableAssetUrls } from "../packages/web/src/scripts/render-house-highlights-media-worker";

/** Explicit local review only: no provider calls, job creation, uploads or publication. */
const { values } = parseArgs({ options: {
  game: { type: "string" }, output: { type: "string" }, "music-dir": { type: "string" },
  "portrait-dir": { type: "string" },
  "snapshot-only": { type: "boolean", default: false }, "from-snapshot": { type: "string" },
  "api-origin": { type: "string", default: "http://127.0.0.1:3000" },
} });
if (!values.game || !values.output) throw new Error("Usage: bun scripts/preview-werewolf-trailer.ts --game SLUG --output DIR --music-dir DIR [--snapshot-only | --from-snapshot FILE]");
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const manifest = values["from-snapshot"]
  ? parseHouseHighlightsTrailerManifest(await readFile(resolve(values["from-snapshot"]), "utf8"))
  : await loadWerewolfTrailerSnapshot(createDB(), values.game).finally(() => closeDB());
if (manifest.kind !== "werewolf" || manifest.game.slug !== values.game) throw new Error("Review snapshot game mismatch");
await writeFile(resolve(directory,"manifest.json"), JSON.stringify(manifest,null,2));
await writeFile(resolve(directory,"source-receipt.json"), JSON.stringify({ hash: hashHouseHighlightsTrailerManifest(manifest), policy: manifest.story.policyVersion,
  music: manifest.story.musicAssetId, musicSha256: manifest.story.musicSha256, sourceHash: manifest.story.sourceHash,
  publicationVersion: manifest.story.publicationVersion, durationSeconds: manifest.cueSheet.totalDurationSeconds, publication: "none; local review only" },null,2));
console.log(JSON.stringify({ game: manifest.game.slug, quotes: manifest.story.quotes.length, durationSeconds: manifest.cueSheet.totalDurationSeconds }));
if (!values["snapshot-only"]) {
  if (!values["music-dir"]) throw new Error("--music-dir is required to render");
  const renderManifest = withWorkerReachableAssetUrls(manifest, values["api-origin"]!);
  // Explicit local artifact source for review when the application server is stopped.
  // No restoring/copying profile files and no fallback to a different identity.
  let portraitServer: ReturnType<typeof Bun.serve> | undefined;
  if (values["portrait-dir"]) {
    const root = resolve(values["portrait-dir"]);
    const images = new Map<string, Blob>();
    for (const player of renderManifest.cast) {
      const url = new URL(player.avatarUrl, values["api-origin"]);
      if (url.pathname !== "/api/uploads/local") continue;
      const key = url.searchParams.get("key");
      if (!key) throw new Error("Missing local portrait key");
      const path = resolve(root, key);
      if (!path.startsWith(root + sep)) throw new Error("Invalid portrait path");
      const file = Bun.file(path);
      if (!await file.exists()) throw new Error(`Missing portrait for ${player.name}: ${path}`);
      images.set(`/portrait/${player.id}`, file);
    }
    portraitServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const image = images.get(new URL(request.url).pathname);
      return image ? new Response(image, { headers: { "Access-Control-Allow-Origin": "*" } }) : new Response("Not found", { status: 404 });
    } });
    for (const player of renderManifest.cast) if (images.has(`/portrait/${player.id}`)) player.avatarUrl = `http://127.0.0.1:${portraitServer.port}/portrait/${player.id}`;
  }
  const bundle = await renderHouseHighlightsTrailerMediaBundle({ manifest: renderManifest, outputDir: directory, musicDir: resolve(values["music-dir"]) })
    .finally(() => portraitServer?.stop(true));
  await writeHouseHighlightsTrailerPlaybackMetadata({ bundle, outputPath: resolve(directory,"metadata.json"), renderVersion: "local-w5-v1",
    urls: { videoUrl: basename(bundle.artifacts.video.path), posterUrl: basename(bundle.artifacts.poster.path), captionsUrl: basename(bundle.artifacts.captions.path) } });
  const escape = (s: string) => s.replace(/[&<>"']/g,c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
  await writeFile(resolve(directory,"index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Werewolf — trailer review</title><style>body{margin:0;background:#12120f;color:#eee5d3;font:16px/1.5 system-ui}main{max-width:1200px;margin:auto;padding:32px 20px}video,img{width:100%;height:auto}h1{font:48px Georgia,serif}a{color:#d4b67b}li{margin:18px 0}details{margin:30px 0}small{color:#c8b894}</style><main><small>THE HOUSE / LOCAL TRAILER REVIEW</small><h1>${escape(manifest.game.slug)}</h1><p>${bundle.durationMs/1000}s · Suno original from 0:00 · short ending fade</p><video controls playsinline preload="metadata" poster="${escape(basename(bundle.artifacts.poster.path))}"><source src="${escape(basename(bundle.artifacts.video.path))}" type="video/mp4"><track kind="captions" srclang="en" label="English" src="${escape(basename(bundle.artifacts.captions.path))}"></video><p><a href="${escape(basename(bundle.artifacts.video.path))}" download>Download MP4</a> · <a href="manifest.json">Story snapshot</a> · <a href="source-receipt.json">Source receipt</a></p><h2>Selected public moments</h2><ol>${manifest.story.quotes.map(q=>`<li><strong>${escape(manifest.cast.find(p=>p.id===q.speakerId)!.name)}</strong>: “${escape(q.text)}” <small>(${escape(q.sourceRef)})</small></li>`).join("") || "<li>No eligible Cuts; cast and premise only.</li>"}</ol><details><summary>Poster</summary><img alt="Werewolf trailer poster" src="${escape(basename(bundle.artifacts.poster.path))}"></details><p>Local sample for editorial, picture and music review. No media published.</p></main></html>`);
  console.log(`Review: ${resolve(directory,"index.html")}`);
}
