import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectWerewolfTrailerMusic, musicMuxArgsFor } from "../lib/house-highlights-trailer-audio";

test("Werewolf score rejects missing, changed and too-short sources instead of silently replacing music", async () => {
  const dir=await mkdtemp(join(tmpdir(),"werewolf-score-test-"));
  try {
    await expect(selectWerewolfTrailerMusic(9,dir)).rejects.toThrow("unavailable");
    await writeFile(join(dir,"trailer-v1.wav"),"wrong music");
    await expect(selectWerewolfTrailerMusic(9,dir)).rejects.toThrow("source hash");
    await expect(selectWerewolfTrailerMusic(200,dir)).rejects.toThrow("outlasts");
    await expect(selectWerewolfTrailerMusic(0,dir)).rejects.toThrow("positive duration");
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("source score is cut from zero and faded at the picture end", () => {
  const args=musicMuxArgsFor({visualPath:"picture.mp4",outputPath:"output.mp4",music:{path:"trailer-v1.wav",filename:"trailer-v1.wav",variantHouseCuts:0,variantPlayers:0,variantDurationSeconds:177.96,trailerDurationSeconds:9,behavior:"trim_and_fade"}});
  expect(args).toContain("[1:a]atrim=start=0:end=9.0,asetpts=PTS-STARTPTS,afade=t=out:st=6.0:d=3.0[outa]");
  expect(args.slice(-4)).toEqual(["9.0","-movflags","+faststart","output.mp4"]);
});
