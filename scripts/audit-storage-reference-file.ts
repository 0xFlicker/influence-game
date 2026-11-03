/** File-only CLI. Reports may contain private JSON paths; output is exclusive and mode 0600. */
import {readFile,writeFile,realpath} from "node:fs/promises";
import {resolve,sep} from "node:path";
import {parseArgs} from "node:util";
import {auditStorageReferences,referenceSha} from "./storage-reference-audit";

try {
  const {values}=parseArgs({options:{input:{type:"string"},"input-sha256":{type:"string"},delivery:{type:"string"},"delivery-sha256":{type:"string"},"payload-directory":{type:"string"},output:{type:"string"}},strict:true});
  if(!values.input || !values.delivery || !values.output || !values["payload-directory"])throw new Error("Required pinned local inputs missing");
  const input=await readFile(values.input),config=await readFile(values.delivery);
  if(referenceSha(input)!==values["input-sha256"] || referenceSha(config)!==values["delivery-sha256"])throw new Error("Pinned input changed");
  const payloadRoot=await realpath(values["payload-directory"]);
  const result=await auditStorageReferences(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(input)),JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(config)),async key=>{
    try {
      const path=await realpath(resolve(payloadRoot,key));
      if(!path.startsWith(payloadRoot+sep))throw new Error("Payload path escaped the reviewed local root");
      return await readFile(path);
    } catch(error) {
      if(error && typeof error==="object" && "code" in error && error.code==="ENOENT")return undefined;
      throw error;
    }
  });
  if(referenceSha(await readFile(values.input))!==values["input-sha256"] || referenceSha(await readFile(values.delivery))!==values["delivery-sha256"])throw new Error("Input changed during audit");
  await writeFile(values.output,JSON.stringify({...result,inputFileSha256:referenceSha(input),deliveryFileSha256:referenceSha(config)},null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({ok:true,localOnly:true,categories:result.categories,verifiedPayloads:result.verifiedPayloads,payloadBodiesComplete:result.payloadBodiesComplete,retirementReady:false}));
} catch {
  console.error("Local historical-reference audit failed; no database or cloud operation ran.");process.exitCode=1;
}
