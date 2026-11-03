import { CreateBucketCommand, HeadBucketCommand, GetBucketCorsCommand, PutBucketCorsCommand, S3Client,type CORSRule } from "@aws-sdk/client-s3";
import {parseArgs} from "node:util";
import { getPrivateTraceStorageConfig } from "../services/private-trace-storage.js";

if (process.env.HOUSE_OBJECT_STORAGE_PROVIDER === "aws") throw new Error("AWS buckets and CORS are managed by falsefloor/infra; this bootstrap is for Linode/local storage");
const { endpoint, accessKeyId, secretAccessKey, bucket } = getPrivateTraceStorageConfig();
const {values}=parseArgs({args:process.argv.slice(2),options:{"render-cors-origin":{type:"string",multiple:true}},strict:true});
const origins=values["render-cors-origin"]??[];
for(const origin of origins) {
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||url.protocol!=="https:"&&!(["localhost","127.0.0.1"].includes(url.hostname)&&url.protocol==="http:"))throw new Error("Render CORS requires exact HTTPS origins or localhost HTTP origins");
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("$metadata" in error)) {
    return undefined;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode;
}

const client = new S3Client({
  region: "us-iad",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (httpStatus(error) !== 404) {
    throw error;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

await client.send(new HeadBucketCommand({ Bucket: bucket }));
if(origins.length) {
  const id="house-studio-recording-uploads";
  let existing:CORSRule[];
  try {existing=(await client.send(new GetBucketCorsCommand({Bucket:bucket}))).CORSRules??[];}
  catch(error) {if(httpStatus(error)!==404)throw error;existing=[];}
  const owned=existing.find(rule=>rule.ID===id);
  await client.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:[...existing.filter(rule=>rule.ID!==id),{
    ID:id,AllowedOrigins:[...new Set([...(owned?.AllowedOrigins??[]),...origins])],AllowedMethods:["PUT"],
    AllowedHeaders:["content-type","content-length","if-none-match","x-amz-checksum-sha256"],MaxAgeSeconds:300,
  }]}}));
  console.log("Studio recording upload CORS is ready for the explicit origins.");
}
console.log(`Private content bucket is ready: ${bucket}`);
