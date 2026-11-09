/* eslint-disable @next/next/no-img-element -- Satori embeds bounded artwork in generated PNGs. */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveServerApiUrl } from "./server-api";
import type { PublicAgentProfile, PublicPlayerProfile } from "./api";
import type { PublicAward } from "./championship";
import { createCardImageRenderQueue } from "@/app/games/[slug]/highlights/card-image/card-image-render-queue";

const headers = { "Cache-Control": "private, no-store" };
const maxArtworkBytes = 4 * 1024 * 1024;
export const profileCardQueue = createCardImageRenderQueue<Response>();

/** Only a validated public agent identity reaches the fixed, trusted API route. */
export function publicAgentId(href: string | undefined): string | null {
  const match = /^\/agents\/([A-Za-z0-9_-]{1,128})$/.exec(href ?? "");
  return match?.[1] ?? null;
}

async function artwork(id: string, kind: "body" | "portrait"): Promise<string | null> {
  const url = resolveServerApiUrl(`/api/public/agents/${encodeURIComponent(id)}/art?kind=${kind}`);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) throw new Error("Public agent artwork is unavailable");
  if (Number(response.headers.get("content-length") ?? 0) > maxArtworkBytes) throw new Error("Public agent artwork exceeds card size");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > maxArtworkBytes) throw new Error("Public agent artwork exceeds card size");
  return `data:image/png;base64,${Buffer.from(data).toString("base64")}`;
}

async function houseBackdrop() {
  const publicRoot = process.cwd().endsWith("packages/web") ? "public" : "packages/web/public";
  const image = await readFile(resolve(process.cwd(), publicRoot, "visual/influence/rooms-v1/mingle-2.jpg"));
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}

function frame(background: string, height: number, children: React.ReactNode) {
  return <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: "#17110c", color: "#f8eedc", fontFamily: "sans-serif", overflow: "hidden" }}>
    <img src={background} alt="" width={1200} height={height} style={{ position: "absolute", inset: 0, objectFit: "cover" }} />
    <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 1200, height, background: "linear-gradient(90deg,rgba(13,9,7,0.95),rgba(17,11,8,0.7),rgba(17,11,8,0.2))" }} />
    <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 1200, height, background: "linear-gradient(0deg,rgba(11,8,6,0.6),rgba(11,8,6,0))" }} />
    {children}
  </div>;
}

function titleSize(name: string) { return name.length > 60 ? 36 : name.length > 40 ? 45 : name.length > 28 ? 56 : name.length > 18 ? 68 : name.length > 12 ? 76 : 92; }
function title(name: string) { return name.length > 90 ? `${name.slice(0, 87)}…` : name; }
function wordBreak(name: string): "normal" | "break-all" { return name.split(/\s+/).some(word => word.length > 12) ? "break-all" : "normal"; }

/** The same marks as the public award shelf, without tooltip text on an image. */
function awardMarks(awards: readonly PublicAward[] | undefined) {
  if (!awards?.length) return null;
  const color = "#f0d69e";
  return <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
    {awards.slice(0, 4).map(award => <svg key={award.id} width="52" height="59" viewBox="0 0 64 72" fill="none">
      <path d="M32 3 58 16v29L32 68 6 45V16Z" stroke={color} strokeWidth="2.5" />
      {award.theme === "season-0" && <path d="M32 8 53 19v24L32 62 11 43V19Z" stroke={color} opacity=".45" />}
      {award.theme === "season-0" && (award.code.includes("participant") ? <circle cx="32" cy="27" r="9" stroke={color} strokeWidth="2.5" />
        : award.code.includes("top-eight") ? <path d="M32 27c-7 0-7-10 0-10s7 10 0 10Zm0 0c-9 0-9 13 0 13s9-13 0-13Z" stroke={color} strokeWidth="2.5" />
        : award.code.includes("werewolf") ? <path d="m19 15 5 8 8-5 8 5 5-8-2 22-11 7-11-7Z" stroke={color} strokeWidth="2.5" />
        : <path d="m18 23 7 6 7-12 7 12 7-6-3 17H21Z" stroke={color} strokeWidth="2.5" />)}
      {award.theme === "season-0" && <path d="M30 48h-4c-3 0-3 4 0 4h2c3 0 3 4 0 4h-4m10-8c-3 0-3 8 0 8s3-8 0-8Z" stroke={color} strokeWidth="1.5" />}
      {award.theme !== "season-0" && <path d="m32 17 5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1Z" stroke={color} strokeWidth="2.5" />}
    </svg>)}
    {awards.length > 4 && <div style={{ display: "flex", alignItems: "center", color, fontSize: 30, fontWeight: 700 }}>+{awards.length - 4}</div>}
  </div>;
}

export async function renderAgentCard(profile: PublicAgentProfile, farcaster = false): Promise<Response> {
  const id = publicAgentId(profile.profileHref);
  if (!id) throw new Error("Public agent identity is invalid");
  const body = await artwork(id, "body");
  const portrait = body ? null : await artwork(id, "portrait");
  const visual = body ?? portrait;
  const name = title(profile.name);
  const height = farcaster ? 800 : 630;
  const background = await houseBackdrop();
  const image = new ImageResponse(frame(background, height, <>
    {visual && (body
      ? <div style={{ display: "flex", position: "absolute", left: 625, top: 0, width: 575, height, overflow: "hidden" }}>
          <img src={visual} alt="" width={960} height={1440} style={{ position: "absolute", left: -180, top: farcaster ? 25 : 5, objectFit: "contain", objectPosition: "center top" }} />
        </div>
      : <div style={{ display: "flex", position: "absolute", left: 710, top: (height - 440) / 2, width: 440, height: 440, border: "3px solid #b49560", borderRadius: 10, overflow: "hidden" }}>
          <img src={visual} alt="" width={440} height={440} style={{ objectFit: "cover" }} />
        </div>)}
    <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: 0, height: 150, background: "linear-gradient(0deg,rgba(9,6,4,0.75),rgba(9,6,4,0))" }} />
    <div style={{ display: "flex", position: "absolute", left: 62, top: 55, color: "#e7ca91", fontSize: 38, fontWeight: 700, letterSpacing: 5 }}>THE HOUSE</div>
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 62, top: farcaster ? 300 : 245, width: 570 }}>
      <div style={{ display: "flex", width: 560, fontSize: titleSize(name), fontWeight: 700, lineHeight: 1.02, wordBreak: wordBreak(name) }}>{name}</div>
      {awardMarks(profile.awards)}
    </div>
  </>), { width: 1200, height, headers });
  const bytes = await image.arrayBuffer();
  if (visual && await artwork(id, body ? "body" : "portrait") !== visual) throw new Error("Public agent artwork changed during rendering");
  return new Response(bytes, image);
}

export async function renderPlayerCard(profile: PublicPlayerProfile, farcaster = false): Promise<Response> {
  const roster = profile.agents.flatMap(agent => { const id = publicAgentId(agent.profileHref); return id ? [{ id, name: agent.name }] : []; }).slice(0, 4);
  const portraits: Array<(typeof roster)[number] & { image: string | null }> = [];
  for (const agent of roster) portraits.push({ ...agent, image: await artwork(agent.id, "portrait") });
  const name = title(profile.identity.displayName);
  const height = farcaster ? 800 : 630;
  const background = await houseBackdrop();
  const image = new ImageResponse(frame(background, height, <>
    <div style={{ display: "flex", position: "absolute", left: 62, top: 55, color: "#e7ca91", fontSize: 38, fontWeight: 700, letterSpacing: 5 }}>THE HOUSE</div>
    <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 62, top: farcaster ? 300 : 245, width: 550 }}>
      <div style={{ display: "flex", width: 550, fontSize: titleSize(name), fontWeight: 700, lineHeight: 1.02, wordBreak: wordBreak(name) }}>{name}</div>
      {awardMarks(profile.awards)}
    </div>
    <div style={{ display: "flex", position: "absolute", left: 665, top: (height - 450) / 2, width: 466, height: 450, flexWrap: "wrap", gap: 14 }}>
      {portraits.map(agent => <div key={agent.id} style={{ display: "flex", width: 218, height: 218, border: "2px solid #b49560", borderRadius: 8, overflow: "hidden", background: "#30251c", alignItems: "center", justifyContent: "center", fontSize: 72 }}>
        {agent.image ? <img src={agent.image} alt="" width={218} height={218} style={{ objectFit: "cover" }} /> : agent.name.charAt(0)}
      </div>)}
    </div>
  </>), { width: 1200, height, headers });
  const bytes = await image.arrayBuffer();
  for (const agent of portraits) {
    if (agent.image && await artwork(agent.id, "portrait") !== agent.image) throw new Error("Public agent artwork changed during rendering");
  }
  return new Response(bytes, image);
}
