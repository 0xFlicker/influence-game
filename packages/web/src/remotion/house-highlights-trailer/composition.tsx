import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {
  HouseHighlightsTrailerAgent,
  HouseHighlightsTrailerCueSegment,
  HouseHighlightsTrailerManifest,
  HouseHighlightsTrailerPlayerResult,
  HouseHighlightsTrailerScenelet,
} from "../../app/games/[slug]/components/house-highlights-trailer-model";

export interface HouseHighlightsTrailerCompositionProps extends Record<string, unknown> {
  manifest: HouseHighlightsTrailerManifest;
}

export const HOUSE_HIGHLIGHTS_TRAILER_ROSTER_COLUMNS = 4;

export function HouseHighlightsTrailerComposition({
  manifest,
}: HouseHighlightsTrailerCompositionProps) {
  return (
    <AbsoluteFill style={styles.stage}>
      {manifest.cueSheet.segments.map((segment) => (
        <Sequence
          key={segment.id}
          from={segment.startFrame}
          durationInFrames={segment.endFrame - segment.startFrame}
        >
          <Segment manifest={manifest} segment={segment} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function Segment({
  manifest,
  segment,
}: {
  manifest: HouseHighlightsTrailerManifest;
  segment: HouseHighlightsTrailerCueSegment;
}) {
  if (segment.kind === "cast_roster") {
    return <CastRosterBeat cast={manifest.cast} />;
  }
  if (segment.kind === "scenelet") {
    const sceneletId = segment.id.replace(/^scenelet:/, "");
    const scenelet = manifest.scenelets.find((candidate) => candidate.id === sceneletId);
    return scenelet ? <SceneletBeat scenelet={scenelet} /> : <FallbackBeat title={segment.label} />;
  }
  if (segment.kind === "final_vote") {
    return <FinalVoteBeat manifest={manifest} />;
  }
  if (segment.kind === "winner") {
    return <WinnerBeat manifest={manifest} />;
  }
  const agentId = segment.id.replace(/^player_result:/, "");
  const result = manifest.playerResults.find((candidate) => candidate.agent.id === agentId);
  return result ? <PlayerResultBeat result={result} /> : <FallbackBeat title={segment.label} />;
}

function CastRosterBeat({ cast }: { cast: HouseHighlightsTrailerAgent[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Backdrop src={null} tone="cast">
      <div style={styles.rosterHeader}>
        <div style={styles.rosterKicker}>HOUSE HIGHLIGHTS</div>
        <div style={styles.rosterTitle}>The Room</div>
      </div>
      <div style={styles.rosterGrid}>
        {cast.map((agent, index) => {
          const itemFrame = frame - index * Math.max(2, Math.floor(fps * 0.16));
          const reveal = spring({ frame: itemFrame, fps, config: { damping: 18, stiffness: 95 } });
          const opacity = interpolate(itemFrame, [-8, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const y = interpolate(reveal, [0, 1], [34, 0]);
          return (
            <div key={agent.id} style={{ ...styles.rosterTile, opacity, transform: `translateY(${y}px)` }}>
              <Avatar agent={agent} size={96} />
              <AgentName style={styles.rosterName}>{agent.name}</AgentName>
            </div>
          );
        })}
      </div>
    </Backdrop>
  );
}

function SceneletBeat({ scenelet }: { scenelet: HouseHighlightsTrailerScenelet }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const factOpacity = interpolate(frame, [fps * 1.2, fps * 1.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const agents = [...scenelet.primaryAgents, ...scenelet.secondaryAgents].slice(0, 4);

  return (
    <Backdrop src={scenelet.backgroundImage} tone={scenelet.visualType}>
      <div style={styles.sceneTopline}>HOUSE HIGHLIGHTS</div>
      <div style={styles.sceneType}>{labelFromToken(scenelet.visualType)}</div>
      <div style={styles.sceneLayout}>
        <div style={{ ...styles.sceneMain, opacity: titleOpacity }}>
          <AgentRail agents={agents} />
          <h1 style={styles.sceneTitle}>{scenelet.title}</h1>
          <p style={styles.sceneOutcome}>{scenelet.outcome}</p>
        </div>
        <div style={{ ...styles.factStack, opacity: factOpacity }}>
          {scenelet.facts.length > 0
            ? scenelet.facts.map((fact) => (
                <div key={fact.id} style={styles.factBox}>{fact.text}</div>
              ))
            : <div style={styles.factBox}>{scenelet.outcome}</div>}
        </div>
      </div>
    </Backdrop>
  );
}

function FinalVoteBeat({ manifest }: { manifest: HouseHighlightsTrailerManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame: frame - fps * 0.5, fps, config: { damping: 20, stiffness: 90 } });

  return (
    <Backdrop src="/house-highlights/generated/jury-judgment.jpg" tone="jury">
      <div style={styles.sceneTopline}>FINAL VOTE</div>
      <div style={styles.voteLayout}>
        {manifest.finalVote.groups.map((group) => (
          <div key={group.finalist.id} style={{ ...styles.voteColumn, transform: `translateY(${interpolate(reveal, [0, 1], [60, 0])}px)` }}>
            <Avatar agent={group.finalist} size={132} />
            <AgentName style={styles.finalistName}>{group.finalist.name}</AgentName>
            <div style={styles.voteCount}>{group.votes}</div>
            <div style={styles.jurorGrid}>
              {group.jurors.map((juror) => (
                <div key={juror.id} style={styles.jurorChip}>
                  <Avatar agent={juror} size={58} />
                  <AgentName lines={1} style={styles.jurorName}>{juror.name}</AgentName>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={styles.finalScore}>Final vote {manifest.finalVote.voteLabel}</div>
    </Backdrop>
  );
}

function WinnerBeat({ manifest }: { manifest: HouseHighlightsTrailerManifest }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - fps * 0.25, fps, config: { damping: 16, stiffness: 100 } });
  const scale = interpolate(pop, [0, 1], [0.84, 1]);

  return (
    <Backdrop src="/house-highlights/generated/winner-reveal.png" tone="winner">
      <div style={styles.winnerLayout}>
        <div style={styles.winnerLabel}>WINNER</div>
        <div style={{ transform: `scale(${scale})` }}>
          <Avatar agent={manifest.finalVote.winner} size={260} />
        </div>
        <AgentName as="h1" style={styles.winnerName}>{manifest.finalVote.winner.name}</AgentName>
        <div style={styles.winnerScore}>Final vote {manifest.finalVote.voteLabel}</div>
      </div>
    </Backdrop>
  );
}

function PlayerResultBeat({ result }: { result: HouseHighlightsTrailerPlayerResult }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame, fps, config: { damping: 18, stiffness: 92 } });
  const y = interpolate(reveal, [0, 1], [70, 0]);
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop src="/house-highlights/generated/jury-judgment.jpg" tone="result">
      <div style={styles.resultTopline}>FINAL DOSSIER</div>
      <div style={{ ...styles.resultLayout, opacity, transform: `translateY(${y}px)` }}>
        <Avatar agent={result.agent} size={220} />
        <div style={styles.resultBody}>
          <div style={styles.resultPlacement}>{result.placementLabel}</div>
          <AgentName style={styles.resultName}>{result.agent.name}</AgentName>
          <div style={styles.resultTags}>
            {result.tags.map((tag) => (
              <span key={tag} style={styles.resultTag}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function FallbackBeat({ title }: { title: string }) {
  return (
    <Backdrop src={null} tone="fallback">
      <div style={styles.sceneLayout}>
        <h1 style={styles.sceneTitle}>{title}</h1>
      </div>
    </Backdrop>
  );
}

function Backdrop({
  children,
  src,
  tone,
}: {
  children: ReactNode;
  src: string | null;
  tone: string;
}) {
  const resolved = src ? assetSrc(src) : null;
  return (
    <AbsoluteFill style={{ ...styles.backdrop, ...toneStyle(tone) }}>
      {resolved ? <Img src={resolved} style={styles.backdropImage} /> : null}
      <AbsoluteFill style={styles.backdropShade} />
      <AbsoluteFill style={styles.backdropVignette} />
      {children}
    </AbsoluteFill>
  );
}

function AgentRail({ agents }: { agents: HouseHighlightsTrailerAgent[] }) {
  if (agents.length === 0) return null;
  return (
    <div style={styles.agentRail}>
      {agents.map((agent) => (
        <div key={agent.id} style={styles.agentPill}>
          <Avatar agent={agent} size={58} />
          <AgentName style={styles.agentPillName}>{agent.name}</AgentName>
        </div>
      ))}
    </div>
  );
}

function Avatar({ agent, size }: { agent: HouseHighlightsTrailerAgent; size: number }) {
  return (
    <div style={{ ...styles.avatarFrame, width: size, height: size, borderRadius: size / 2 }}>
      <Img src={assetSrc(agent.avatarUrl)} style={{ ...styles.avatarImage, borderRadius: size / 2 }} />
    </div>
  );
}

function AgentName({
  as: Component = "div",
  children,
  lines = 2,
  style,
}: {
  as?: "div" | "h1";
  children: ReactNode;
  lines?: 1 | 2;
  style: CSSProperties;
}) {
  return (
    <Component style={{
      ...trailerAgentNameStyle(lines),
      ...style,
    }}>
      {children}
    </Component>
  );
}

export function trailerAgentNameStyle(lines: 1 | 2): CSSProperties {
  return {
    ...styles.agentName,
    ...(lines === 1 ? styles.agentNameSingleLine : { WebkitLineClamp: lines }),
  };
}

function assetSrc(src: string): string {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src.replace(/^\//, ""));
}

function labelFromToken(value: string): string {
  return value
    .split(/[_: -]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toneStyle(tone: string): CSSProperties {
  if (tone.includes("betrayal") || tone.includes("rupture") || tone.includes("collapse")) {
    return { backgroundColor: "#1a0d13" };
  }
  if (tone.includes("jury")) return { backgroundColor: "#071319" };
  if (tone.includes("winner") || tone.includes("power")) return { backgroundColor: "#171309" };
  if (tone.includes("alliance") || tone.includes("survival")) return { backgroundColor: "#091511" };
  return { backgroundColor: "#0d0d11" };
}

const baseText: CSSProperties = {
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  color: "white",
  letterSpacing: 0,
};

const styles: Record<string, CSSProperties> = {
  stage: {
    ...baseText,
    backgroundColor: "#09090b",
  },
  backdrop: {
    overflow: "hidden",
  },
  backdropImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: 0.72,
  },
  backdropShade: {
    background: "linear-gradient(90deg, rgba(0,0,0,0.72), rgba(0,0,0,0.25) 48%, rgba(0,0,0,0.72))",
  },
  backdropVignette: {
    boxShadow: "inset 0 0 240px rgba(0,0,0,0.9)",
  },
  rosterHeader: {
    position: "absolute",
    zIndex: 2,
    left: 92,
    top: 76,
  },
  rosterKicker: {
    fontSize: 32,
    fontWeight: 700,
    color: "rgba(255,255,255,0.72)",
  },
  rosterTitle: {
    marginTop: 18,
    fontSize: 84,
    lineHeight: 1,
    fontWeight: 800,
  },
  rosterGrid: {
    position: "absolute",
    zIndex: 2,
    left: 92,
    right: 92,
    top: 270,
    display: "grid",
    gridTemplateColumns: `repeat(${HOUSE_HIGHLIGHTS_TRAILER_ROSTER_COLUMNS}, 1fr)`,
    gap: 24,
  },
  rosterTile: {
    minWidth: 0,
    height: 150,
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "24px 26px",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  rosterName: {
    flex: 1,
    fontSize: 36,
    lineHeight: 1.05,
    fontWeight: 760,
  },
  sceneTopline: {
    position: "absolute",
    top: 76,
    left: 92,
    zIndex: 2,
    fontSize: 34,
    fontWeight: 700,
    color: "rgba(255,255,255,0.74)",
  },
  sceneType: {
    position: "absolute",
    top: 128,
    left: 92,
    zIndex: 2,
    padding: "16px 30px",
    border: "1px solid rgba(255,255,255,0.34)",
    borderRadius: 999,
    fontSize: 34,
    color: "rgba(255,255,255,0.86)",
  },
  sceneLayout: {
    position: "absolute",
    zIndex: 2,
    inset: "230px 92px 92px",
    display: "grid",
    gridTemplateColumns: "1.35fr 0.75fr",
    gap: 72,
    alignItems: "end",
  },
  sceneMain: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    minWidth: 0,
  },
  sceneTitle: {
    ...baseText,
    margin: "30px 0 0",
    fontSize: 104,
    lineHeight: 1.02,
    fontWeight: 780,
    maxWidth: 1040,
  },
  sceneOutcome: {
    margin: "34px 0 0",
    fontSize: 40,
    lineHeight: 1.22,
    color: "rgba(255,255,255,0.76)",
    maxWidth: 1040,
  },
  agentRail: {
    display: "flex",
    flexWrap: "wrap",
    gap: 18,
  },
  agentPill: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "10px 22px 10px 10px",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.36)",
    maxWidth: 430,
  },
  agentPillName: {
    maxWidth: 330,
    fontSize: 34,
    fontWeight: 680,
  },
  factStack: {
    display: "flex",
    flexDirection: "column",
    gap: 22,
  },
  factBox: {
    padding: "30px 34px",
    border: "1px solid rgba(255,255,255,0.24)",
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.48)",
    fontSize: 36,
    lineHeight: 1.18,
    color: "rgba(255,255,255,0.86)",
  },
  voteLayout: {
    position: "absolute",
    zIndex: 2,
    inset: "190px 100px 170px",
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "1fr",
    gap: 42,
  },
  voteColumn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "38px 34px",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  finalistName: {
    marginTop: 18,
    maxWidth: "100%",
    fontSize: 50,
    fontWeight: 760,
    textAlign: "center",
  },
  voteCount: {
    marginTop: 12,
    fontSize: 96,
    fontWeight: 820,
    color: "#fde68a",
  },
  jurorGrid: {
    width: "100%",
    marginTop: 22,
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
  },
  jurorChip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px 8px 8px",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  jurorName: {
    maxWidth: 220,
    fontSize: 24,
    fontWeight: 650,
  },
  finalScore: {
    position: "absolute",
    zIndex: 2,
    left: 100,
    bottom: 72,
    fontSize: 46,
    fontWeight: 720,
    color: "rgba(255,255,255,0.82)",
  },
  winnerLayout: {
    position: "absolute",
    zIndex: 2,
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  winnerLabel: {
    fontSize: 48,
    fontWeight: 760,
    color: "rgba(255,255,255,0.74)",
    marginBottom: 36,
  },
  winnerName: {
    ...baseText,
    margin: "44px 0 0",
    fontSize: 124,
    lineHeight: 1,
    fontWeight: 840,
    textAlign: "center",
    maxWidth: 1500,
  },
  winnerScore: {
    marginTop: 28,
    fontSize: 44,
    fontWeight: 700,
    color: "#fde68a",
  },
  resultTopline: {
    position: "absolute",
    top: 76,
    left: 92,
    zIndex: 2,
    fontSize: 34,
    fontWeight: 700,
    color: "rgba(255,255,255,0.74)",
  },
  resultLayout: {
    position: "absolute",
    zIndex: 2,
    inset: "230px 150px 190px",
    display: "flex",
    alignItems: "center",
    gap: 62,
    padding: "58px 68px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 34,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  resultBody: {
    minWidth: 0,
  },
  resultPlacement: {
    fontSize: 44,
    fontWeight: 760,
    color: "#fde68a",
  },
  resultName: {
    marginTop: 14,
    maxWidth: 940,
    fontSize: 108,
    lineHeight: 1,
    fontWeight: 830,
  },
  resultTags: {
    marginTop: 34,
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
  },
  resultTag: {
    padding: "12px 22px",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    fontSize: 30,
    fontWeight: 680,
    color: "rgba(255,255,255,0.86)",
  },
  avatarFrame: {
    flex: "0 0 auto",
    overflow: "hidden",
    border: "2px solid rgba(255,255,255,0.48)",
    backgroundColor: "rgba(255,255,255,0.08)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.36)",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  agentName: {
    minWidth: 0,
    overflow: "hidden",
    overflowWrap: "anywhere",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
  },
  agentNameSingleLine: {
    display: "block",
    whiteSpace: "nowrap",
  },
};
