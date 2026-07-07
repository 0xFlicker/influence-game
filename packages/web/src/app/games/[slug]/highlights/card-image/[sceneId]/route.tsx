import { ImageResponse } from "next/og";
import type { HouseHighlightPlayerRef, HouseHighlightSceneCard } from "@/lib/api";
import { getServerPostgameHighlights, resolveServerApiUrl } from "@/lib/server-api";
import { houseHighlightGeneratedBackgroundAsset } from "../../../components/house-highlights-backgrounds";
import { sceneForCardImage } from "../card-image-data";

export const dynamic = "force-dynamic";

const SIZE = {
  width: 1200,
  height: 630,
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};

const FALLBACK_CACHE_HEADERS = {
  "Cache-Control": "no-store",
};

interface RouteContext {
  params: Promise<{
    slug: string;
    sceneId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { slug, sceneId } = await context.params;

  try {
    const response = await getServerPostgameHighlights(slug);
    const scene = sceneForCardImage(response, sceneId);

    if (!scene) {
      return fallbackImage("Scene unavailable", 404);
    }

    return new ImageResponse(
      <CardImage scene={scene} requestUrl={request.url} />,
      {
        ...SIZE,
        headers: CACHE_HEADERS,
      },
    );
  } catch (err) {
    console.error(`[HouseHighlightCardImage] render failed for slug="${slug}" scene="${sceneId}":`, err);
    return fallbackImage("Highlights unavailable", 503);
  }
}

function fallbackImage(title: string, status: number) {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(135deg,#111113,#1f2933 52%,#09090b)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 28, fontWeight: 700 }}>
        House Highlights
      </div>
      <div style={{ fontSize: 74, fontWeight: 800, marginTop: 26 }}>{title}</div>
    </div>,
    {
      ...SIZE,
      status,
      headers: status >= 500 ? FALLBACK_CACHE_HEADERS : CACHE_HEADERS,
    },
  );
}

function CardImage({
  scene,
  requestUrl,
}: {
  scene: HouseHighlightSceneCard;
  requestUrl: string;
}) {
  const card = scene.visualCard;
  const primary = card.primaryAgents[0];
  const secondary = card.secondaryAgents[0];
  const generatedBackground = generatedBackgroundForImage(scene.visualBrief.visualType, requestUrl);

  return (
    <div
      style={{
        background: backgroundFor(card.backdrop.category),
        color: "white",
        display: "flex",
        height: "100%",
        padding: 58,
        position: "relative",
        width: "100%",
      }}
    >
      {generatedBackground ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generatedBackground}
          alt=""
          height={SIZE.height}
          width={SIZE.width}
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      ) : null}
      <div
        style={{
          background: "radial-gradient(circle at 72% 22%,rgba(255,255,255,0.08),transparent 32%),linear-gradient(90deg,rgba(0,0,0,0.82),rgba(0,0,0,0.48) 55%,rgba(0,0,0,0.76))",
          display: "flex",
          inset: 0,
          position: "absolute",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", width: "100%" }}>
        <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "rgba(255,255,255,0.54)", fontSize: 24, fontWeight: 800, letterSpacing: 0, textTransform: "uppercase" }}>
              House Highlights
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, color: "rgba(255,255,255,0.82)", display: "flex", fontSize: 24, fontWeight: 800, marginTop: 18, padding: "10px 18px" }}>
              {card.eyebrow}
            </div>
          </div>
          {card.roundLabel ? (
            <div style={{ alignItems: "flex-end", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 12, display: "flex", flexDirection: "column", padding: "14px 18px" }}>
              <div style={{ color: "rgba(255,255,255,0.46)", fontSize: 18, fontWeight: 800, textTransform: "uppercase" }}>
                Round
              </div>
              <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4 }}>{card.roundLabel}</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 34, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
              {primary ? <AgentPill agent={primary} requestUrl={requestUrl} tone="cyan" /> : null}
              {secondary ? <AgentPill agent={secondary} requestUrl={requestUrl} tone="rose" /> : null}
            </div>
            <div style={{ display: "flex", fontSize: 70, fontWeight: 900, lineHeight: 0.94, maxWidth: 760 }}>
              {card.title}
            </div>
            <div style={{ color: "rgba(255,255,255,0.74)", display: "flex", fontSize: 30, lineHeight: 1.28, marginTop: 26, maxWidth: 720 }}>
              {card.outcome}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 355 }}>
            {card.factLines.slice(0, 3).map((fact) => (
              <div
                key={fact.id}
                style={{
                  background: "rgba(0,0,0,0.34)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  borderRadius: 12,
                  color: "rgba(255,255,255,0.84)",
                  display: "flex",
                  fontSize: 25,
                  lineHeight: 1.24,
                  padding: "16px 18px",
                }}
              >
                {fact.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function generatedBackgroundForImage(visualType: string, requestUrl: string): string | null {
  const asset = houseHighlightGeneratedBackgroundAsset(visualType);
  return asset ? new URL(asset, requestUrl).toString() : null;
}

function AgentPill({
  agent,
  requestUrl,
  tone,
}: {
  agent: HouseHighlightPlayerRef;
  requestUrl: string;
  tone: "cyan" | "rose";
}) {
  const border = tone === "cyan" ? "rgba(165,243,252,0.28)" : "rgba(254,205,211,0.28)";
  const background = tone === "cyan" ? "rgba(34,211,238,0.13)" : "rgba(244,63,94,0.13)";
  const avatarUrl = avatarSrcForImage(agent.avatarUrl ?? fallbackPersonaAvatarUrl(agent.name), requestUrl);

  return (
    <div style={{ alignItems: "center", background, border: `1px solid ${border}`, borderRadius: 999, display: "flex", fontSize: 26, fontWeight: 850, gap: 12, padding: "9px 18px 9px 10px" }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          height={44}
          width={44}
          style={{ borderRadius: 999, height: 44, objectFit: "cover", width: 44 }}
        />
      ) : (
        <div style={{ alignItems: "center", background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, display: "flex", fontSize: 18, fontWeight: 900, height: 44, justifyContent: "center", width: 44 }}>
          {initialsFor(agent.name)}
        </div>
      )}
      {agent.name}
    </div>
  );
}

export function avatarSrcForImage(
  avatarUrl: string | null | undefined,
  requestUrl = "http://127.0.0.1:3001/",
): string | null {
  const trimmed = avatarUrl?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/")) return resolveServerApiUrl(trimmed);
  if (trimmed.startsWith("/")) return new URL(trimmed, requestUrl).toString();
  return resolveServerApiUrl(trimmed);
}

const PERSONA_AVATAR_KEYS = [
  "honest",
  "strategic",
  "deceptive",
  "paranoid",
  "social",
  "aggressive",
  "loyalist",
  "observer",
  "diplomat",
  "wildcard",
  "contrarian",
  "provocateur",
  "martyr",
] as const;

function fallbackPersonaAvatarUrl(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const key = PERSONA_AVATAR_KEYS[hash % PERSONA_AVATAR_KEYS.length] ?? "strategic";
  return `/avatars/personas/${key}.png`;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function backgroundFor(category: string): string {
  switch (category) {
    case "empty_council_chamber":
      return "linear-gradient(160deg,rgba(250,204,21,0.16),transparent 34%),linear-gradient(135deg,#18130d,#27201a 45%,#080706)";
    case "jury_wall":
      return "linear-gradient(160deg,rgba(34,211,238,0.14),transparent 36%),linear-gradient(135deg,#101417,#242a2e 50%,#070809)";
    case "abstract_vote_board":
      return "linear-gradient(145deg,rgba(244,63,94,0.18),transparent 32%),linear-gradient(215deg,rgba(34,211,238,0.12),transparent 38%),linear-gradient(135deg,#111114,#242025 55%,#09090b)";
    case "fractured_alliance_table":
      return "linear-gradient(155deg,rgba(16,185,129,0.15),transparent 34%),linear-gradient(135deg,#101514,#252927 48%,#080908)";
    case "spotlight_stage":
      return "linear-gradient(180deg,rgba(255,255,255,0.19),transparent 38%),linear-gradient(135deg,#151315,#27242a 52%,#08070a)";
    case "surveillance_board_texture":
      return "linear-gradient(145deg,rgba(251,146,60,0.14),transparent 34%),linear-gradient(215deg,rgba(34,197,94,0.1),transparent 42%),linear-gradient(135deg,#121313,#242525 50%,#070808)";
    default:
      return "linear-gradient(135deg,#111113,#18181b 48%,#09090b)";
  }
}
