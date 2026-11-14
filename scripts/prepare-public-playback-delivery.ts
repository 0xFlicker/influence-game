/** Local-only preparation. Input and output files may contain private draft metadata. */
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {parseArgs} from "node:util";
import {preparePublicPlaybackDocument} from "../packages/web/src/lib/public-playback-migration";
import type {PublicMediaDelivery} from "../packages/web/src/lib/public-media-delivery";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
try {
  const {values} = parseArgs({options:{source:{type:"string"},"source-sha256":{type:"string"},config:{type:"string"},"config-sha256":{type:"string"},output:{type:"string"}},strict:true});
  if (!values.source || !values.config || !values.output || !values["source-sha256"] || !values["config-sha256"]) throw new Error("Missing pinned inputs");
  const source = await readFile(values.source), config = await readFile(values.config);
  if (sha(config) !== values["config-sha256"]) throw new Error("Delivery configuration changed");
  const result = preparePublicPlaybackDocument(source,values["source-sha256"],JSON.parse(config.toString()) as PublicMediaDelivery);
  if (sha(await readFile(values.source)) !== values["source-sha256"]) throw new Error("Source changed during preparation");
  await mkdir(values.output,{mode:0o700}); // exclusive directory: never replace a prior preparation
  await writeFile(join(values.output,"delivery.json"),result.bytes,{flag:"wx",mode:0o600});
  await writeFile(join(values.output,"receipt.json"),JSON.stringify({...result.receipt,inputConfigFileSha256:sha(config)},null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({ok:true,localOnly:true,sourceSha256:result.receipt.sourceSha256,destinationSha256:result.receipt.destinationSha256,changedFields:result.receipt.changedFields.length}));
} catch {
  console.error("Public playback preparation failed; inspect the pinned local inputs. No cloud or database operation ran.");
  process.exitCode=1;
}
