// Inside the sandbox. The Unix socket exposes only the current turn's MCP bridge.
import { createInterface } from "node:readline";
import sharp from "sharp";

const maxEncodedPreview = 256 * 1024;

async function modelPreview(result: { content?: Array<{ type?: string; mimeType?: string; data?: string }> }) {
  const image = result.content?.[0];
  if (image?.type !== "image" || image.mimeType !== "image/png" || typeof image.data !== "string"
      || image.data.length <= maxEncodedPreview) return result;

  // Keep the image in model context compact. The gateway reads delivery files separately.
  const source = sharp(Buffer.from(image.data, "base64"), { limitInputPixels: 768 * 768 });
  for (const size of [512, 384]) {
    const data = (await source.clone().resize(size, size, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
    if (data.length <= maxEncodedPreview) return { ...result, content: [{ type: "image", mimeType: "image/jpeg", data }] };
  }
  throw new Error("Image preview exceeds the model input budget");
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
async function handleRequest(line: string) {
  let id: unknown;
  try {
    if (line.length > 16_384) throw new Error("Request too large");
    const rpc = JSON.parse(line);
    id = rpc.id;
    if (id === undefined) return;
    let result: unknown;
    if (rpc.method === "initialize") {
      result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "house", version: "1.0.0" } };
    } else if (rpc.method === "ping") {
      result = {};
    } else if (rpc.method === "tools/list" || rpc.method === "tools/call") {
      const response = await fetch("http://house/mcp", {
        unix: "/bridge/turn.sock", method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: rpc.method, name: rpc.params?.name, args: rpc.params?.arguments }),
        signal: AbortSignal.timeout(25_000),
      });
      result = response.ok ? await response.json() : { isError: true, content: [{ type: "text", text: "House read unavailable in this conversation." }] };
      if (response.ok && rpc.params?.name === "inspect_image") result = await modelPreview(result as Parameters<typeof modelPreview>[0]);
    } else {
      throw new Error("Unsupported method");
    }
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
  } catch {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: "House read unavailable" } }));
  }
}

// Limit concurrent House reads while letting the model inspect a batch of scenes.
const pending = new Set<Promise<void>>();
const concurrentRequests = 2;
for await (const line of lines) {
  const task = handleRequest(line).finally(() => pending.delete(task));
  pending.add(task);
  if (pending.size >= concurrentRequests) await Promise.race(pending);
}
await Promise.all(pending);
