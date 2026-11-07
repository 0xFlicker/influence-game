import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { PublicAgentProfileView } from "../app/agents/[id]/public-agent-profile";
import { AgentProfileLink, agentProfileHref } from "../components/agent-profile-link";
import { CastCard } from "../components/casting/casting-roster";
import { getServerPublicAgentProfile } from "../lib/server-api";
import type { PublicAgentProfile } from "../lib/api";

const profile: PublicAgentProfile = {
  name: "Public Agent", avatarUrl: null, role: null, profileHref: "/agents/agent-1",
  owner: { publicId: "owner-1", handle: "architect", displayName: "Architect" },
  competition: { gamesPlayed: 4, wins: 1, winRate: .25 },
  awards: [{ id: "award-1", code: "season-0-agent-participant", title: "Season 0 Participant", theme: "season-0", awardedAt: "2026-11-03T00:00:00Z", sourceSeasonId: "s0", sourceEventId: null }], recentResults: [],
};
test("public agent view presents honors, correctly scoped stats and accessible history filters", () => {
  const html = renderToString(<PublicAgentProfileView profile={profile} gameKind="werewolf" />);
  expect(html).toContain("Public Agent");
  expect(html).toContain('href="/profile/architect"');
  expect(html).toContain("Season 0 Participant");
  expect(html).toContain("Rated Influence record");
  expect(html).toContain("25%");
  expect(html).toContain('href="/agents/agent-1?game=werewolf"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("No completed games in this history yet.");
  expect(html).not.toContain("Sign in to");
});
test("agent name navigation validates canonical targets without wrapping sibling controls", () => {
  const html = renderToString(<div><AgentProfileLink agentId="agent-1">Agent</AgentProfileLink><button>Portrait</button></div>);
  expect(html).toContain('href="/agents/agent-1"');
  expect(html).toContain('</a><button>Portrait</button>');
  expect(agentProfileHref("../private")).toBeNull();
  expect(renderToString(<AgentProfileLink href="https://evil.test">Agent</AgentProfileLink>)).toBe("<span>Agent</span>");
});
test("joining-game cast cards open public agent profiles while keeping seat controls separate", () => {
  const html = renderToString(<CastCard name="Agent" src="/agent.png" index={0} eyebrow="Competitor" detail="In the cast"
    profileHref="/agents/agent-1" onInspect={() => {}} action={<button type="button">Remove</button>} />);
  expect(html).toContain('href="/agents/agent-1"');
  expect(html).toContain("</a><button");
  expect(html).not.toContain('aria-label="Meet Agent"');
  const unlinked = renderToString(<CastCard name="Guest" src="/guest.png" index={1} eyebrow="Competitor" detail="In the cast" onInspect={() => {}} />);
  expect(unlinked).toContain('aria-label="Meet Guest"');
});
test("server public agent fetch sends no authentication and disables caching", async () => {
  const original = globalThis.fetch;
  let requested = "", options: RequestInit | undefined;
  globalThis.fetch = (async (url, init) => { requested = String(url); options = init; return Response.json({ schemaVersion: 1, status: "found", profile }); }) as typeof fetch;
  try {
    expect((await getServerPublicAgentProfile("agent-1", "werewolf")).status).toBe("found");
    expect(requested).toEndWith("/api/public/agents/agent-1?game=werewolf");
    expect(options?.cache).toBe("no-store");
    const headers = new Headers(options?.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.has("Cookie")).toBe(false);
  } finally { globalThis.fetch = original; }
});
