/** Consume the optional API integration fixture, then use bundled alpha art for
 * legible frame comparisons. The API regression separately verifies exact bytes.
 */
import {readFile, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {buildExportCues} from "../lib/replay-export/cues";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
const directory = resolve(process.argv[2] ?? "../../.renders/wolf-cutout-proof");
const window = JSON.parse(await readFile(join(directory,"source.json"),"utf8")) as WerewolfWatchWindow;
const body = await readFile(new URL("../../public/avatars/personas/full-body-v1/strategic.webp",import.meta.url));
const alphaArt = `data:image/webp;base64,${body.toString("base64")}`;
for (const moment of window.moments) {
  for (const player of moment.snapshot.players) {
    player.avatarUrl = "/avatars/personas/strategic.png";
    player.fullBodyReferenceUrl = "/avatars/personas/full-body-v1/strategic.webp";
  }
  if (moment.wolfForms) for (const id of Object.keys(moment.wolfForms)) moment.wolfForms[id] = alphaArt;
  moment.mediaKey = null;
}
window.media = {};
const cues = buildExportCues({kind:"werewolf", windows:[window], thoughts:[]});
const cue = cues.find(value => value.picture.kind === "werewolf" && value.picture.cue.transformation);
if (!cue) throw new Error("The API fixture has no wolf transformation");
await writeFile(join(directory,"cases.json"),JSON.stringify([
  {name:"wolf-cutout",cue,reference:cue},
  {name:"wolf-cutout-reduced",cue,reference:cue,reducedMotion:true},
],null,2));
