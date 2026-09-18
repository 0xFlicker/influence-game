#!/usr/bin/env bun
/**
 * Export a completed game through the producer MCP narrative surface.
 *
 * Requires a producer-scoped MCP token. By default it reads the short-lived
 * token saved by `bun run mcp:game:login`; set INFLUENCE_MCP_TOKEN instead to
 * use an explicit token. Never commit the resulting raw capture: it contains
 * private player thinking and strategy artifacts.
 *
 * Usage:
 *   INFLUENCE_MCP_URL=http://127.0.0.1:3000/mcp \
 *   bun run --filter @influence/made-for-video export:producer -- sharp-tan-reef /private/tmp/sharp-tan-reef
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStoredMcpAccessToken } from "./producer-mcp-token.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface NarrativeGroup {
  action?: string | null;
  actor?: string | { name?: string | null } | null;
  corr?: string;
  correlation?: { kind?: string; basis?: string };
  members?: Array<{
    authority?: string;
    fields?: { text?: string; thinking?: string; strategyValue?: string };
    kind?: string;
  }>;
  phase?: string | null;
  round?: number | null;
  scope?: string;
  seq?: number;
  strategy?: string;
  text?: string;
  thinking?: string;
}

interface NarrativePage {
  ok: boolean;
  error?: string;
  game?: { id: string; slug: string; status: string };
  groups?: NarrativeGroup[];
  nextCursor?: string | null;
  limitations?: Array<{ code: string; message: string }>;
  [key: string]: unknown;
}

interface JsonRpcResponse {
  error?: { code: number; message: string; data?: Json };
  result?: { structuredContent?: NarrativePage; content?: Array<{ text?: string }> };
}

const slug = process.argv[2];
const outputDirectory = process.argv[3];

if (!slug || !outputDirectory || slug === "--help" || slug === "-h") {
  console.error("Usage: bun run --filter @influence/made-for-video export:producer -- <game-slug> <output-directory>");
  process.exit(1);
}

const mcpUrl = process.env.INFLUENCE_MCP_URL?.trim() || "http://127.0.0.1:3000/mcp";
const token = process.env.INFLUENCE_MCP_TOKEN?.trim() || loadStoredMcpAccessToken();
const outputPath = resolve(outputDirectory);

async function callNarrative(cursor?: string): Promise<NarrativePage> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: {
        name: "read_producer_match_narrative",
        arguments: {
          gameIdOrSlug: slug,
          preset: "full_cognition",
          detail: "full",
          limit: 50,
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: HTTP ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as JsonRpcResponse;
  if (payload.error) throw new Error(`MCP JSON-RPC error: ${payload.error.message}`);
  const narrative = payload.result?.structuredContent;
  if (!narrative) {
    throw new Error(`MCP returned no structured narrative: ${payload.result?.content?.[0]?.text ?? "unknown response"}`);
  }
  if (!narrative.ok) throw new Error(`Narrative read failed: ${narrative.error ?? "unknown error"}`);
  return narrative;
}

function actorName(group: NarrativeGroup): string | null {
  if (typeof group.actor === "string") return group.actor;
  return group.actor?.name ?? null;
}

function renderGroup(group: NarrativeGroup, index: number): string {
  const heading = [
    `### ${String(index + 1).padStart(3, "0")}`,
    group.round === undefined || group.round === null ? null : `Round ${group.round}`,
    group.phase ?? null,
    actorName(group),
    group.action ?? null,
  ].filter(Boolean).join(" · ");
  const blocks = [heading];
  if (group.text) blocks.push(`**Dialogue / event**\n\n${group.text}`);
  if (group.thinking) blocks.push(`**Thinking**\n\n${group.thinking}`);
  if (group.strategy) blocks.push(`**Strategy artifact**\n\n${group.strategy}`);
  for (const member of group.members ?? []) {
    const fields = member.fields ?? {};
    if (fields.text) blocks.push(`**${member.kind ?? "Transcript"}**\n\n${fields.text}`);
    if (fields.thinking) blocks.push(`**Thinking**\n\n${fields.thinking}`);
    if (fields.strategyValue) blocks.push(`**Strategy artifact**\n\n${fields.strategyValue}`);
  }
  const correlation = group.corr ?? group.correlation?.kind;
  if (correlation) blocks.push(`_Correlation: ${correlation}_`);
  return `${blocks.join("\n\n")}\n`;
}

const pages: NarrativePage[] = [];
let cursor: string | undefined;
do {
  const page = await callNarrative(cursor);
  pages.push(page);
  cursor = page.nextCursor ?? undefined;
} while (cursor);

const groups = pages.flatMap((page) => page.groups ?? []);
const first = pages[0]!;
mkdirSync(outputPath, { recursive: true, mode: 0o700 });
writeFileSync(
  `${outputPath}/capture.json`,
  `${JSON.stringify({ game: first.game, pages }, null, 2)}\n`,
  { mode: 0o600 },
);
writeFileSync(
  `${outputPath}/transcript.md`,
  [
    `# ${first.game?.slug ?? slug}: producer transcript`,
    "",
    "> Private producer export. Contains game-authored dialogue, thoughts, strategy artifacts, huddles, and system narration. Treat narrative prose as non-canonical presentation; use the event log for authoritative game facts.",
    "",
    `- Pages: ${pages.length}`,
    `- Narrative groups: ${groups.length}`,
    `- Capture limitations: ${first.limitations?.length ? first.limitations.map((item) => item.code).join(", ") : "none"}`,
    "",
    ...groups.map(renderGroup),
  ].join("\n"),
  { mode: 0o600 },
);

console.log(`Exported ${groups.length} narrative groups across ${pages.length} pages to ${outputPath}`);
