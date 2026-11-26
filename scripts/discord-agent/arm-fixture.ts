import { consentModel, filterInference } from "./sandbox.ts";
import { chmod, rm, writeFile } from "node:fs/promises";
import { consentSchema, replySchema } from "./policy.ts";
await writeFile("/bridge/reply.json", JSON.stringify(replySchema));
await writeFile("/bridge/consent.json", JSON.stringify(consentSchema));
let calls = 0;
const schema = { type: "object", properties: {}, additionalProperties: false };
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
Bun.serve({ unix: "/bridge/turn.sock", async fetch(req) {
  const incoming = await req.json() as { method?: string; tools: { name: string }[]; input: Array<Record<string, unknown>> };
  if (incoming.method === "tools/list") return Response.json({ tools: [{ name: "inspect_image", description: "Inspect the test image", inputSchema: schema, annotations: { readOnlyHint: true } }] });
  if (incoming.method === "tools/call") return Response.json({ content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAEEAAABBCAIAAAABlV4SAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAnElEQVR4nO3TAQ3AMAzEwOfPYzhdFYW3yVIBJL50PPv6mz5BO+SAfUL0H6a3J4fp4clhenVymJ6cHKb3JofpsclhemlymJ6ZHKY3Jofpgclhel1ymJ6WHKZ3JYfpUclhelFymJ6THKa3JIfpIclhesUcbgK/Yg458Jo3fYJ2yAH7hOg/TG9PDtPDk8P06uQwPTk5TO9NDtNj82+HA9Z1FTq/+h2SAAAAAElFTkSuQmCC" }] });
  const consent = JSON.stringify(incoming.input).includes("synthetic consent");
  const model = consent ? consentModel : "gpt-6.1-terra";
  const filtered = filterInference(incoming, model, new Set(consent ? [] : ["inspect_image"]));
  if (!filtered) return new Response("Unexpected tool catalog", { status: 403 });
  const hasHouseIdentity = JSON.stringify(filtered.input).includes("https://thehouse.game/profile/thehouse");
  if (hasHouseIdentity === consent) return new Response("Unexpected House identity instructions", { status: 400 });
  console.log("PROVIDER TOOLS", JSON.stringify(filtered.tools.map(t => ({ name: t.name, tools: t.tools }))));
  const message = (content: object) => sse({ id: "msg1", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", annotations: [], text: JSON.stringify(content) }] }, model);
  if (consent) return message({ allowed: true });
  if (++calls === 1) return sse({ id: "item1", type: "function_call", namespace: "mcp__house", name: "inspect_image",
    call_id: "call1", arguments: "{}", status: "completed" }, model);
  if (!JSON.stringify(filtered.input).includes('"type":"input_image"')) {
    console.log("MODEL INPUT ITEM TYPES", JSON.stringify(incoming.input.map(item => item.type)));
    return new Response("missing MCP image input", { status: 400 });
  }
  console.log("MCP IMAGE IN MODEL INPUT");
  return message({ text: "The fixture is in order.", imageRefs: [], spoiler: { action: "none", game: "" } });
}});
await chmod("/bridge/turn.sock", 0o666);
console.log("READY");
