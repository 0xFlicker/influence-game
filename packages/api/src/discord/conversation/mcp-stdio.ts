// Inside the sandbox. The Unix socket exposes only the current turn's MCP bridge.
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let id: unknown;
  try {
    if (line.length > 16_384) throw new Error("Request too large");
    const rpc = JSON.parse(line);
    id = rpc.id;
    if (id === undefined) continue;
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
    } else {
      throw new Error("Unsupported method");
    }
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));
  } catch {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: "House read unavailable" } }));
  }
}
