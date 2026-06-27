import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { CompletedResultsVoteMatrix } from "../app/games/[slug]/components/completed-results-vote-matrix";
import { CompletedResultsAgentCard } from "../app/games/[slug]/components/completed-results-agent-card";

describe("completed results review components", () => {
  it("renders vote matrix cells and keeps formal alliance wording absent", () => {
    const html = renderToString(
      <CompletedResultsVoteMatrix
        columns={[
          { id: "r1:empower", label: "Round 1 empower", shortLabel: "R1 E+", round: 1, kind: "empower" },
          { id: "r1:expose", label: "Round 1 expose", shortLabel: "R1 X", round: 1, kind: "expose" },
        ]}
        rows={[
          {
            player: { id: "alice", name: "Alice" },
            cells: [
              { targetId: "bob", targetName: "Bob", groupKey: "r1:empower:bob", colorClass: "bg-cyan-400/15 text-cyan-100 border-cyan-300/20" },
              { targetId: "cara", targetName: "Cara", groupKey: "r1:expose:cara", colorClass: "bg-emerald-400/15 text-emerald-100 border-emerald-300/20" },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Cara");
    expect(html.toLowerCase()).not.toContain("alliance");
  });

  it("renders agent facts without transient thinking snippets", () => {
    const html = renderToString(
      <CompletedResultsAgentCard
        card={{
          player: { id: "alice", name: "Alice", placement: 1, status: "winner" },
          placementLabel: "1st",
          votesCast: 3,
          votesReceived: 4,
          tags: ["Winner", "Won final vote 2-0", "Reached final"],
        }}
      />,
    );

    expect(html).toContain("Alice");
    expect(html).toContain("1st");
    expect(html).toContain("3");
    expect(html).toContain("cast");
    expect(html).toContain("4");
    expect(html).toContain("received");
    expect(html).toContain("Winner");
    expect(html).toContain("Won final vote 2-0");
    expect(html).toContain("Reached final");
    expect(html).not.toContain("Decision Log");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("Alice owned the jury story.");
  });
});
