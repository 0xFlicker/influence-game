import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cutBackdrop } from "@/lib/house-cut-presentation";
import { ImageResponse } from "next/og";
import { getServerHouseCuts, ServerApiError } from "@/lib/server-api";
import { createCardImageRenderQueue, CardImageRenderOverloadedError } from "../card-image-render-queue";
export const dynamic = "force-dynamic";
const queue = createCardImageRenderQueue<Response>();
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, context: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await context.params;
  const audience = new URL(request.url).searchParams.get("audience") ?? undefined;
  try {
    const response = await queue.run(`${slug}\0${audience}\0${sceneId}`, async () => {
      const data = await getServerHouseCuts(slug, audience);
      const cut = data.publication?.cuts.find(c => c.id === sceneId);
      if (!cut) return new Response(null, { status: 404, headers });
      const asset = cutBackdrop(cut, data.game.kind);
      const publicRoot = process.cwd().endsWith("packages/web") ? "public" : "packages/web/public";
      const background = `data:image/jpeg;base64,${(await readFile(resolve(process.cwd(), publicRoot, asset.slice(1)))).toString("base64")}`;
      const title = cut.title.length > 135 ? `${cut.title.slice(0, 132)}…` : cut.title;
      const description = cut.context.length > 180 ? `${cut.context.slice(0, 177)}…` : cut.context;
      const image = new ImageResponse(<div style={{ display: "flex", position: "relative", flexDirection: "column", width: "100%", height: "100%", padding: "50px 64px", background: "#090c0c", color: "#f3eee3" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Embedded bundled artwork for Satori. */}
        <img src={background} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "linear-gradient(90deg,rgba(6,10,10,.94),rgba(6,10,10,.38))" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, letterSpacing: 3, color: "#e4cc8b" }}><span>THE HOUSE / HOUSE CUTS</span><span>{data.game.kind.toUpperCase()}{data.audience === "omniscient" ? " · FULL SPOILERS" : data.audience === "mystery" ? " · MYSTERY" : ""}</span></div>
        <div style={{ display: "flex", maxWidth: 980, marginTop: 48, fontSize: title.length > 90 ? 48 : 60, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>{title}</div>
        <div style={{ display: "flex", maxWidth: 900, marginTop: 24, fontSize: 25, lineHeight: 1.4, color: "#d8d2c5" }}>{description}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}><span style={{ fontSize: 20, color: "#d8d2c5" }}>thehouse.game</span><span style={{ padding: "14px 24px", borderRadius: 6, background: "#e4cc8b", color: "#17160f", fontSize: 21, fontWeight: 700 }}>Watch the story</span></div>
      </div>, { width: 1200, height: 630, headers });
      return new Response(await image.arrayBuffer(), image);
    });
    return response.clone();
  } catch (error) {
    const status = error instanceof ServerApiError && error.status === 404 ? 404 : 503;
    return new Response(null, { status, headers: { ...headers, ...(error instanceof CardImageRenderOverloadedError ? { "Retry-After": "5" } : {}) } });
  }
}
