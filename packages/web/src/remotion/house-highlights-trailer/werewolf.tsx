import type { CSSProperties } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { WerewolfTrailerManifest } from "@influence/engine/postgame-media/werewolf-trailer-manifest";

/** Werewolf owns the edit's visual language; House owns sequencing, transport and delivery. */
export function WerewolfTrailerBeat({ manifest, segmentId }: { manifest: WerewolfTrailerManifest; segmentId: string }) {
  const frame = useCurrentFrame();
  const segment = manifest.cueSheet.segments.find(s => s.id === segmentId)!;
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const quote = manifest.story.quotes.find(q => q.id === segmentId);
  const speaker = quote ? manifest.cast.find(p => p.id === quote.speakerId)! : null;
  const ending = segment.kind === "end_card";
  return <AbsoluteFill style={stage}>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 16% 78%, #ae752326, transparent 55%), radial-gradient(ellipse at 95% 5%, #48607024, transparent 65%)" }} />
    <div style={{ position: "absolute", inset: 36, border: "1px solid #c49d5e55" }} />
    <div style={{ position: "absolute", top: 70, left: 90, display: "flex", alignItems: "center", gap: 24 }}>
      <Img src={staticFile("logo.png")} style={{ width: 66, height: 66, objectFit: "contain" }} />
      <span style={kicker}>THE HOUSE <span style={{ color: "#8d8373", margin: "0 22px" }}>/</span> WEREWOLF</span>
    </div>
    {segment.kind === "cast_roster" ? <div style={{ opacity, position: "absolute", inset: "190px 90px 80px" }}>
      <h1 style={{ ...title, margin: "0 0 20px", fontSize: 92 }}>A village of familiar faces.</h1>
      <p style={{ color: "#ceb986", fontSize: 34, margin: "0 0 42px" }}>Wolves among them.</p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${manifest.cast.length === 6 ? 3 : 4}, 1fr)`, gap: 22 }}>
        {manifest.cast.map((p, i) => <div key={p.id} style={{ ...castCard,
          opacity: interpolate(frame - i * 3, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <Img src={asset(p.avatarUrl)} style={{ width: 126, height: 166, objectFit: "contain", background: "#1a1916" }} />
          <div style={{ padding: "0 20px", minWidth: 0, fontSize: 30, lineHeight: 1.2, overflowWrap: "anywhere" }}>{p.name}</div>
        </div>)}
      </div>
    </div> : quote && speaker ? <div style={{ position: "absolute", inset: "200px 110px 120px", display: "grid", gridTemplateColumns: "540px 1fr", gap: 90, alignItems: "center", opacity }}>
      <div style={{ border: "1px solid #b28e4f66", padding: 12, background: "#1b1915" }}>
        <Img src={asset(speaker.avatarUrl)} style={{ width: "100%", height: 560, objectFit: "contain", display: "block" }} />
      </div>
      <div>
        <div style={{ ...kicker, color: "#b49a6b", marginBottom: 36 }}>AT THE TABLE</div>
        <blockquote style={{ ...title, fontSize: quote.text.length > 150 ? 52 : 64, margin: 0, lineHeight: 1.18 }}>“{quote.text}”</blockquote>
        <p style={{ fontSize: 32, color: "#cdbd9d", marginTop: 38 }}>{speaker.name}</p>
      </div>
    </div> : ending ? <div style={{ opacity, position: "absolute", inset: "240px 130px 160px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
      <div style={{ ...kicker, color: "#cdb47f" }}>SUSPICION HAS A SEAT AT THE TABLE.</div>
      <h1 style={{ ...title, fontSize: 126, margin: "45px 0" }}>Who will you trust?</h1>
      <p style={{ fontSize: 36, color: "#c5bbaa", margin: 0 }}>Watch Werewolf at The House</p>
      <p style={{ fontSize: 25, color: "#918775", marginTop: 36 }}>{manifest.game.slug}</p>
    </div> : null}
    <div style={{ position: "absolute", bottom: 62, right: 90, ...kicker, fontSize: 18, color: "#8d826d" }}>WEREWOLF / {manifest.cast.length} PLAYERS</div>
  </AbsoluteFill>;
}
function asset(path: string) { return /^https?:\/\//.test(path) ? path : staticFile(path.replace(/^\//,"")); }
const stage: CSSProperties = { background: "#12120f", color: "#f0e8d7", fontFamily: "Inter, Arial, sans-serif" };
const title: CSSProperties = { fontFamily: "Georgia, serif", fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.06 };
const kicker: CSSProperties = { fontSize: 24, letterSpacing: "0.17em", fontWeight: 600 };
const castCard: CSSProperties = { display: "flex", alignItems: "center", minWidth: 0, border: "1px solid #b28e4f44", background: "#211e18" };
