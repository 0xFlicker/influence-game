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
      const quote = cut.quotes[0];
      const image = new ImageResponse(<div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 60, background: "linear-gradient(135deg,#24221e,#090909)", color: "#eee9df" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, letterSpacing: 4, color: "#d7b977" }}><span>THE HOUSE / HOUSE CUTS</span><span>{data.audience === "omniscient" ? "FULL SPOILERS" : data.game.kind.toUpperCase()}</span></div>
        <div style={{ display: "flex", marginTop: 35, fontSize: cut.title.length > 65 ? 42 : 54, fontWeight: 700, lineHeight: 1.12 }}>{cut.title}</div>
        <div style={{ display: "flex", marginTop: 25, fontSize: 25, lineHeight: 1.4, color: "#ccc6bc" }}>{quote ? `“${quote.text.length > 220 ? `${quote.text.slice(0, 217)}…` : quote.text}”` : cut.context}</div>
        {quote && <div style={{ display: "flex", marginTop: 18, color: "#d7b977", fontSize: 20 }}>{quote.name}</div>}
        <div style={{ display: "flex", marginTop: "auto", fontSize: 18, color: "#a5a19a" }}>{data.game.slug} · Watch the moment at The House</div>
      </div>, { width: 1200, height: 630, headers });
      return new Response(await image.arrayBuffer(), image);
    });
    return response.clone();
  } catch (error) {
    const status = error instanceof ServerApiError && error.status === 404 ? 404 : 503;
    return new Response(null, { status, headers: { ...headers, ...(error instanceof CardImageRenderOverloadedError ? { "Retry-After": "5" } : {}) } });
  }
}
