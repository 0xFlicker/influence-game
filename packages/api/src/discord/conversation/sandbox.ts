import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { consentSchema, replySchema } from "./policy.js";

interface Sandbox {
  image: string;
  model: string;
  inferenceToken: string;
}

const maxRequests = 12;
export const consentModel = "gpt-6-luna";

export async function runCodex(
  config: Sandbox,
  mode: "reply" | "consent",
  input: string,
  tools: string[],
  mcp: (body: Record<string, unknown>) => Promise<Response>,
) {
  const model = mode === "consent" ? consentModel : config.model;
  const folder = await mkdtemp(join(tmpdir(), "house-turn-"));
  const socket = join(folder, "turn.sock");
  const name = "house-turn-" + randomUUID();
  const limit = AbortSignal.timeout(mode === "consent" ? 25_000 : 70_000);
  let server: ReturnType<typeof Bun.serve> | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let toolCalls = 0;
  let modelCalls = 0;
  let blockedRequests = 0;
  let upstreamStatus: number | null = null;
  try {
    await chmod(folder, 0o755);
    await Promise.all([
      writeFile(join(folder, "reply.json"), JSON.stringify(replySchema)),
      writeFile(join(folder, "consent.json"), JSON.stringify(consentSchema)),
    ]);
    const allowed = new Set(tools);
    server = Bun.serve({
      unix: socket, maxRequestBodySize: 8 * 1024 * 1024,
      async fetch(request) {
        if (request.method !== "POST" || limit.aborted) return new Response(null, { status: 403 });
        const url = new URL(request.url);
        try {
          const body = await request.json() as Record<string, unknown>;
          if (url.pathname === "/mcp" && mode === "reply" && !url.search) {
            if (body.method === "tools/call" && ++toolCalls > maxRequests) return new Response(null, { status: 429 });
            return mcp(body);
          }
          if (url.pathname !== "/v1/responses" || url.search || ++modelCalls > maxRequests) return new Response(null, { status: 403 });
          const filtered = filterInference(body, model, allowed);
          if (!filtered) {
            blockedRequests++;
            return new Response(null, { status: 403 });
          }
          const response = await fetch("http://127.0.0.1:18790/v1/responses", {
            method: "POST",
            headers: { authorization: "Bearer " + config.inferenceToken, "content-type": "application/json" },
            body: JSON.stringify(filtered), redirect: "error", signal: limit,
          });
          upstreamStatus = response.status;
          if (!response.ok || !response.body) return response;
          const [result, metrics] = response.body.tee();
          void recordUsage(metrics).catch(() => console.log(JSON.stringify({ event: "discord_usage_unavailable" })));
          return new Response(result, { status: response.status, headers: { "content-type": "text/event-stream" } });
        } catch {
          return new Response(null, { status: 502 });
        }
      },
    });
    await chmod(socket, 0o666);
    child = Bun.spawn(["docker", "run", "--rm", "-i", "--pull", "never", "--name", name, "--network", "none",
      "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=96",
      "--memory=768m", "--memory-swap=768m", "--cpus=1", "--user=10004:10004",
      "--mount", "type=bind,src=" + folder + ",dst=/bridge,readonly",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m,mode=1777",
      config.image, mode, model],
    { stdin: new Response(input).body!, stdout: "pipe", stderr: "ignore" });
    const [result, status] = await Promise.race([
      Promise.all([readOutput(child.stdout), child.exited]),
      new Promise<never>((_, reject) => limit.addEventListener("abort", () => reject(new Error("Codex timed out")), { once: true })),
    ]);
    if (status !== 0) throw new Error("Codex turn failed");
    return JSON.parse(result.trim()) as unknown;
  } catch (error) {
    console.log(JSON.stringify({
      event: "discord_sandbox_failed", mode, toolCalls, modelCalls, blockedRequests, upstreamStatus,
      exitCode: child?.exitCode ?? null, timedOut: limit.aborted,
    }));
    throw error;
  } finally {
    server?.stop(true);
    if (child && child.exitCode === null) {
      const cleanup = Bun.spawn(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
      const seconds = setTimeout(() => cleanup.kill(), 5000);
      await cleanup.exited;
      clearTimeout(seconds);
      child.kill();
    }
    await rm(folder, { recursive: true, force: true });
  }
}

export function filterInference(body: Record<string, unknown>, model: string, allowed: Set<string>) {
  if (!body || body.model !== model || body.stream !== true
      || (body.tools !== undefined && !Array.isArray(body.tools)) || !localInput(body.input)
      || body.conversation !== undefined || body.prompt !== undefined) return null;
  const tools: Array<Record<string, unknown>> = [];
  const visible = new Set<string>();
  for (const tool of body.tools ?? []) {
    if (!tool || typeof tool.name !== "string") continue;
    if (tool.type === "function" && tool.name.startsWith("mcp__house__")) {
      const name = tool.name.slice("mcp__house__".length);
      if (allowed.has(name)) { visible.add(name); tools.push(tool); }
    }
    if (tool.type === "namespace" && tool.name === "mcp__house" && Array.isArray(tool.tools)) {
      const house = tool.tools.filter((t: { type?: string; name: string } | null) => t?.type === "function" && allowed.has(t.name));
      for (const t of house) visible.add(t.name);
      if (house.length) tools.push({ ...tool, tools: house });
    }
  }
  if (visible.size !== allowed.size) return null;
  return { ...body, tools, tool_choice: "auto", store: false, max_output_tokens: 2048 };
}

function localInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(localInput);
  if (!value || typeof value !== "object") return true;
  const item = value as Record<string, unknown>;
  if (item.type === "input_file" || item.type === "computer_screenshot") return false;
  if (item.type === "input_image") {
    const url = item.image_url;
    return item.file_id == null && typeof url === "string" &&
      ["image/png", "image/jpeg", "image/webp"].some(mime => url.startsWith("data:" + mime + ";base64,"));
  }
  // Responses inputs nest image items under content or function output.
  return Object.values(item).every(localInput);
}

async function readOutput(stream: unknown) {
  if (!(stream instanceof ReadableStream)) throw new Error("Codex output unavailable");
  let output = "";
  const decoder = new TextDecoder();
  for await (const buffer of stream) {
    output += decoder.decode(buffer, { stream: true });
    if (output.length > 16_384) throw new Error("Codex output too large");
  }
  return output + decoder.decode();
}

async function recordUsage(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line.length > 256_000 || line === "data: [DONE]") continue;
      const event = JSON.parse(line.slice(6)) as { type?: string; response?: { usage?: Record<string, unknown> } };
      if (event.type !== "response.completed" && event.type !== "response.incomplete") continue;
      const usage = event.response?.usage;
      if (typeof usage?.input_tokens === "number" && typeof usage.output_tokens === "number") {
        console.log(JSON.stringify({ event: "discord_usage", inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }));
      }
    }
    if (buffer.length > 256_000) buffer = "";
  }
}
