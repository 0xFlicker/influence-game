import { consentModel, filterInference } from "./sandbox.ts";
import { chmod, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { consentSchema, discordReplyAttachmentLimit, replySchema } from "./policy.ts";
await writeFile("/bridge/reply.json", JSON.stringify(replySchema));
await writeFile("/bridge/consent.json", JSON.stringify(consentSchema));
let calls = 0;
const schema = { type: "object", properties: {}, additionalProperties: false };
const replayUrl = "https://thehouse.game/games/copper-fox/replay?audience=mystery&cursor=8";
const imageRefs = Array.from({ length: discordReplyAttachmentLimit }, (_, index) => `fixture-image-${index + 1}`);
const previewLimit = 256 * 1024;

function pngChunk(kind: string, bytes: Uint8Array) {
  const chunk = Buffer.alloc(bytes.length + 12);
  chunk.writeUInt32BE(bytes.length, 0);
  chunk.write(kind, 4);
  chunk.set(bytes, 8);
  chunk.writeUInt32BE(Bun.hash.crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function inspectionPng() {
  const side = 768;
  const rowLength = side * 3 + 1;
  const pixels = Buffer.alloc(rowLength * side);
  let seed = 196347;
  // Deterministic high entropy forces real preview conversion. Each row uses PNG filter 0.
  for (let start = 0; start < pixels.length; start += rowLength) {
    for (let index = start + 1; index < start + rowLength; index++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[index] = seed & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]).toString("base64");
  if (png.length <= previewLimit) throw new Error("Expected a large source PNG");
  return png;
}

const png = inspectionPng();

function imageInputs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(imageInputs);
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  if (data.type === "input_image" && typeof data.image_url === "string") return [data.image_url];
  return Object.values(data).flatMap(imageInputs);
}

function isBoundedJpeg(url: string) {
  const prefix = "data:image/jpeg;base64,";
  if (!url.startsWith(prefix)) return false;
  const base64 = url.slice(prefix.length);
  if (!base64 || base64.length > previewLimit) return false;
  const bytes = Buffer.from(base64, "base64");
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function sse(item: object, model: string) {
  const response = { id: "resp_test", status: "completed", model, output: [item],
    usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const packets = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
  return new Response(packets.map(packet => "event: " + packet.type + "\ndata: " + JSON.stringify(packet) + "\n\n").join(""),
    { headers: { "content-type": "text/event-stream" } });
}
await rm("/bridge/turn.sock", { force: true });
Bun.serve({ unix: "/bridge/turn.sock", maxRequestBodySize: 8 * 1024 * 1024, async fetch(req) {
  const announcement = await Bun.file("/bridge/announcement-probe").exists();
  const incoming = await req.json() as {
    method?: string; name?: string; args?: { url?: string; imageRef?: string };
    tools: { name: string }[]; input: Array<Record<string, unknown>>;
    text?: { format?: { schema?: { properties?: { imageRefs?: { maxItems?: number } } } } };
  };
  if (announcement && incoming.method === "tools/list") return Response.json({ tools: [] });
  if (announcement && incoming.method === "tools/call") return new Response(null, { status: 403 });
  if (incoming.method === "tools/list") return Response.json({ tools: [
    { name: "inspect_image", description: "Inspect the test image", inputSchema: { ...schema, properties: { imageRef: { type: "string" } }, required: ["imageRef"] }, annotations: { readOnlyHint: true } },
    { name: "resolve_house_link", description: "Resolve the test replay", inputSchema: { ...schema, properties: { url: { type: "string" } }, required: ["url"] }, annotations: { readOnlyHint: true } },
  ] });
  if (incoming.method === "tools/call" && incoming.name === "resolve_house_link") {
    if (incoming.args?.url !== "https://thehouse.game/s/Lk3WEcewWi") return new Response(null, { status: 403 });
    return Response.json({ content: [{ type: "text", text: JSON.stringify({
      status: "found", kind: "replay", reference: "fixture-game", url: replayUrl, audience: "mystery", position: { cursor: 8 },
    }) }] });
  }
  if (incoming.method === "tools/call" && incoming.name === "inspect_image") {
    if (!incoming.args?.imageRef || !imageRefs.includes(incoming.args.imageRef)) return new Response(null, { status: 403 });
    return Response.json({ content: [{ type: "image", mimeType: "image/png", data: png }] });
  }
  const consent = JSON.stringify(incoming.input).includes("synthetic consent");
  const model = consent ? consentModel : "gpt-6.1-terra";
  const filtered = filterInference(incoming, model, new Set(consent || announcement ? [] : ["inspect_image", "resolve_house_link"]));
  if (!filtered) return new Response("Unexpected tool catalog", { status: 403 });
  const hasHouseIdentity = JSON.stringify(filtered.input).includes("https://thehouse.game/profile/thehouse");
  if (hasHouseIdentity === consent) return new Response("Unexpected House identity instructions", { status: 400 });
  if (!consent) {
    if (incoming.text?.format?.schema?.properties?.imageRefs?.maxItems !== discordReplyAttachmentLimit) {
      return new Response("Missing image attachment count limit in model schema", { status: 400 });
    }
    console.log("MCP IMAGE ATTACHMENT LIMIT IN MODEL SCHEMA");
  }
  console.log("PROVIDER TOOLS", JSON.stringify(filtered.tools.map(t => ({ name: t.name, tools: t.tools }))));
  const message = (content: object) => sse({ id: "msg1", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", annotations: [], text: JSON.stringify(content) }] }, model);
  if (consent) return message({ intent: "matching_offer" });
  if (announcement) {
    const prompt = JSON.stringify(filtered.input);
    if (!prompt.includes("gameAnnouncement") || !prompt.includes("Copper Fox")
        || !prompt.includes("/games/copper-fox/replay?audience=mystery") || filtered.tools.length) {
      return new Response("Expected a tool-free announcement with the trusted facts and replay link", { status: 400 });
    }
    console.log("ANNOUNCEMENT PROVIDER TOOLS []");
    return message({ messages: ["Copper Fox won."], imageRefs: [], spoiler: { action: "none", game: "" }, subject: { kind: "none", id: "" } });
  }
  if (++calls === 1) return sse({ id: "item1", type: "function_call", namespace: "mcp__house", name: "resolve_house_link",
    call_id: "call1", arguments: '{"url":"https://thehouse.game/s/Lk3WEcewWi"}', status: "completed" }, model);
  if (calls === 2) {
    if (!JSON.stringify(filtered.input).includes(replayUrl)) return new Response("missing canonical replay URL", { status: 400 });
    console.log("MCP REPLAY URL IN MODEL INPUT");
  }
  const images = imageInputs(filtered.input);
  if (images.length !== calls - 2 || !images.every(isBoundedJpeg)) {
    console.log("MCP IMAGE INPUT COUNT", images.length);
    return new Response("Expected bounded JPEG inspection previews", { status: 400 });
  }
  const imageRef = imageRefs[calls - 2];
  if (imageRef) return sse({ id: `item${calls}`, type: "function_call", namespace: "mcp__house", name: "inspect_image",
    call_id: `call${calls}`, arguments: JSON.stringify({ imageRef }), status: "completed" }, model);
  console.log("MCP IMAGE IN MODEL INPUT");
  console.log("MCP BOUNDED JPEG PREVIEWS IN MODEL INPUT", images.length);
  return message({ messages: [`[Open the replay](${replayUrl})`, "The second part keeps its complete wording."],
    imageRefs, spoiler: { action: "none", game: "" }, subject: { kind: "game", id: "fixture-game" } });
}});
await chmod("/bridge/turn.sock", 0o666);
console.log("READY");
