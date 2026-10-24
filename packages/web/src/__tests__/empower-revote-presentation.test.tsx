import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { GameState, Phase } from "@influence/engine";
import { projectViewerDecisionEvent, type ViewerDecisionEvent } from "@influence/engine/viewer-presentation";
import { compileFormatPresentationPrefix } from "../app/games/[slug]/components/format-presentation-model";
import { FormatPresentation } from "../app/games/[slug]/components/format-presentation";
import { FormatTerminalSnapshot } from "../app/games/[slug]/components/format-terminal-snapshot";
import { buildExportCues } from "../lib/replay-export/cues";

const roster = ["Arden", "Marnie", "Milo", "Rowan", "Larry"].map(name => ({ id: name.toLowerCase(), name }));

// Same ballots and accepted outcome as void-fawn-edge, round 2, events 41–48.
function recordedRevote(): ViewerDecisionEvent[] {
  const state = new GameState(roster, { empowerRevoteVersion: 1 });
  state.startRound();
  state.recordPhaseEntered(Phase.VOTE);
  state.recordVote("arden", "rowan");
  state.recordVote("marnie", "rowan");
  state.recordVote("milo", "arden");
  state.recordVote("rowan", "marnie");
  state.recordVote("larry", "arden");
  state.tallyEmpowerVotes();
  for (const id of ["marnie", "milo", "larry"]) state.clearEmpowerVote(id);
  state.recordEmpowerReVote("marnie", "rowan");
  state.recordEmpowerReVote("milo", "arden");
  state.recordEmpowerReVote("larry", "arden");
  state.setEmpowered("rowan", "wheel");
  return state.getCanonicalEvents().flatMap(event => {
    const decision = projectViewerDecisionEvent(event);
    return decision ? [decision] : [];
  });
}

function compile(decisions: readonly ViewerDecisionEvent[], empowerRevoteVersion?: 1 | 2) {
  return compileFormatPresentationPrefix({ gameId: "recorded-revote", gameKernel: "format", roster, decisions, empowerRevoteVersion });
}

describe("Empower revote playback", () => {
  it.each([1, 2] as const)("uses version %s in terminal playback and exported video", (version) => {
    const decisions = recordedRevote().map(decision => decision.type === "vote.empowered_set" && version === 2
      ? { ...decision, payload: { empowered: "arden", method: "revote" as const } }
      : decision);
    const html = renderToString(<FormatTerminalSnapshot gameId="recorded-revote" roster={roster} decisions={decisions} empowerRevoteVersion={version} />);
    expect(html).not.toContain("Presentation incomplete");
    expect(html).toContain(version === 1 ? "Rowan is Empowered." : "Arden is Empowered.");
    const players = roster.map(player => ({ ...player, persona: "", status: "alive" as const, shielded: false }));
    const cues = buildExportCues({
      kind: "influence",
      game: { id: "recorded-revote", slug: "recorded-revote", status: "completed", gameKernel: "format", players, empowerRevoteVersion: version },
      messages: [], thoughts: {}, visual: { enabled: false, status: null, portraits: {}, scenes: [] },
      frames: decisions.map(event => ({
        schemaVersion: 3, gameId: "recorded-revote", slug: "recorded-revote", sequence: event.sequence,
        eventType: event.type, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT",
        players, counts: { totalPlayers: 5, alivePlayers: 5, eliminatedPlayers: 0, unknownPlayers: 0 }, viewerDecisionEvent: event,
      })),
    });
    const tally = cues.flatMap(cue => cue.picture.kind === "influence" && cue.picture.cue.kind === "empowered_tally" ? [cue.picture.cue] : []);
    expect(tally.length).toBeGreaterThan(0);
    for (const shot of tally) expect(shot).toMatchObject(version === 1
      ? { counts: { arden: 2, rowan: 2 }, empoweredId: "rowan", resolutionMethod: "wheel" }
      : { counts: { arden: 2, rowan: 1 }, empoweredId: "arden", resolutionMethod: "revote" });
  });

  it("shows the historical 2–2 tally, all counted ballots, and Rowan's actual wheel win", () => {
    const decisions = recordedRevote();
    const before = structuredClone(decisions);
    const result = compile(decisions);
    expect(result.status).toBe("ready");
    expect(result.snapshot.empoweredId).toBe("rowan");
    const cue = result.cues.at(-1)!;
    expect(cue).toMatchObject({ kind: "empowered_tally", counts: { arden: 2, rowan: 2 }, empoweredId: "rowan", resolutionMethod: "wheel" });
    if (cue.kind !== "empowered_tally") throw new Error("Expected Empower tally");
    expect(cue.countedVotes).toHaveLength(4);
    expect(cue.countedVotes).toContainEqual({ voterId: "arden", targetId: "rowan" });
    expect(cue.countedVotes).not.toContainEqual({ voterId: "rowan", targetId: "marnie" });
    const html = renderToString(<FormatPresentation cue={cue} roster={roster} currentStateEntry={false} />).replaceAll(/<!--.*?-->/g, "");
    expect(html).toContain("Empower revote");
    expect(html).toContain("Rowan is Empowered.");
    expect(html).not.toContain("retained first-ballot");
    expect(html).not.toContain("Only the new ballots");
    expect(html).toContain("The vote stayed tied. The wheel decided.");
    expect(html).toContain('aria-label="Arden → Rowan"');
    expect(html).toContain("Marnie");
    expect(html).toContain("Milo");
    expect(html).toContain("Larry");
    expect(decisions).toEqual(before);
    for (let length = 1; length < decisions.length; length++) {
      const prefix = compile(decisions.slice(0, length));
      expect(prefix.status).toBe("ready");
      expect(prefix.cues.some(entry => entry.kind === "empowered_tally")).toBe(false);
    }
  });

  it("requires the new-ballot winner on games created with version 2", () => {
    const decisions = recordedRevote().map(decision => decision.type === "vote.empowered_set"
      ? { ...decision, payload: { empowered: "arden", method: "revote" as const } }
      : decision);
    expect(compile(decisions, 1).status).toBe("incomplete");
    const result = compile(decisions, 2);
    expect(result.status).toBe("ready");
    const cue = result.cues.at(-1)!;
    expect(cue).toMatchObject({ counts: { arden: 2, rowan: 1 }, empoweredId: "arden", resolutionMethod: "revote" });
    if (cue.kind !== "empowered_tally") throw new Error("Expected Empower tally");
    expect(cue.countedVotes).toHaveLength(3);
    const html = renderToString(<FormatPresentation cue={cue} roster={roster} currentStateEntry={false} />);
    expect(html).not.toContain("wheel");
    expect(html).not.toContain('aria-label="Arden → Rowan"');
    for (const payload of [
      { empowered: "rowan", method: "wheel" as const },
      { empowered: "arden", method: "wheel" as const },
      { empowered: "rowan", method: "revote" as const },
    ]) {
      const invalid = compile(decisions.map(decision => decision.type === "vote.empowered_set"
        ? { ...decision, payload: { ...payload } }
        : decision), 2);
      expect(invalid.diagnostic?.code).toBe("empower_tally_mismatch");
    }
  });

  it("shows the historical counted ballots even when both tally methods select the same winner", () => {
    const decisions = recordedRevote().map(decision => {
      if (decision.type === "vote.empower_revote_cast") return { ...decision, payload: { ...decision.payload, target: "arden" } };
      if (decision.type === "vote.empowered_set") return { ...decision, payload: { empowered: "arden", method: "revote" as const } };
      return decision;
    });
    const result = compile(decisions);
    expect(result.status).toBe("ready");
    expect(result.cues.at(-1)).toMatchObject({ counts: { arden: 3, rowan: 1 }, empoweredId: "arden", resolutionMethod: "revote" });
    expect(renderToString(<FormatPresentation cue={result.cues.at(-1)!} roster={roster} currentStateEntry={false} />)).not.toContain("wheel");
  });

  it("does not accept missing ballots or unexplained historical outcomes", () => {
    const decisions = recordedRevote();
    expect(compile(decisions.filter(decision => decision.type !== "vote.empower_revote_cast" || decision.payload.voterId !== "larry")).status).toBe("incomplete");
    expect(compile(decisions.map(decision => decision.type === "vote.empowered_set"
      ? { ...decision, payload: { empowered: "rowan", method: "revote" } }
      : decision)).status).toBe("incomplete");
  });
});
