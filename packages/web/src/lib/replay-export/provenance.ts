import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { runProcess } from "./assets";

export async function fileIdentity(path:string) {
  const hash=createHash("sha256"); let byteLength=0;
  for await(const chunk of createReadStream(path)) {hash.update(chunk);byteLength+=chunk.length;}
  return {sha256:hash.digest("hex"),byteLength};
}
export async function rendererProvenance(repoRoot:string) {
  if(process.env.INFLUENCE_RENDER_CONFIG_PACKAGED==="1") {
    const revision=process.env.GIT_SHA;
    if(!revision||!/^([a-f0-9]{7,40})$/.test(revision)) throw new Error("Packaged renderer requires its build revision");
    return {revision,dirty:process.env.SOURCE_DIRTY==="1"};
  }
  return {revision:(await runProcess("git",["-C",repoRoot,"rev-parse","HEAD"])).trim(),
    dirty:Boolean((await runProcess("git",["-C",repoRoot,"status","--porcelain"])).trim())};
}
