import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { AgentRow } from "../app/admin/agents-admin-panel";
import { AgentPicker } from "../app/dashboard/join-game-modal";
import { QueueSection } from "../app/games/free/free-game-content";
import type { AdminAgent, SavedAgent } from "../lib/api";

function savedAgent(overrides: Partial<SavedAgent> = {}): SavedAgent {
  return {
    id: "agent-1",
    name: "Atlas",
    backstory: null,
    personality: "Patient and observant.",
    strategyStyle: null,
    personaKey: "strategic",
    avatarUrl: null,
    gamesPlayed: 5,
    gamesWon: 2,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function adminAgent(overrides: Partial<AdminAgent> = {}): AdminAgent {
  return {
    ...savedAgent(),
    userId: "user-1",
    ownerWallet: "0x0000000000000000000000000000000000000001",
    ownerDisplayName: "Architect",
    ownerEmail: null,
    ...overrides,
  };
}

function expectSiblingButtons(html: string, expectedCount: number) {
  expect(html.match(/<button/g)).toHaveLength(expectedCount);
  expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
}

describe("current-agent portrait action separation", () => {
  it("keeps the custom-game portrait preview independent from agent selection", () => {
    const html = renderToString(
      <AgentPicker
        agents={[savedAgent()]}
        selectedId={null}
        onSelect={() => undefined}
        onClear={() => undefined}
        onCreateNew={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain('aria-label="Select Atlas"');
    expect(html).toContain('aria-pressed="false"');
    expectSiblingButtons(html, 3);
  });

  it("keeps the Daily Free portrait preview independent from selection and join", () => {
    const html = renderToString(
      <QueueSection
        queueStatus={null}
        agents={[savedAgent()]}
        authenticated
        login={() => undefined}
        onJoin={async () => undefined}
        onLeave={async () => undefined}
        actionLoading={false}
        actionError={null}
      />,
    );

    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain('aria-label="Select Atlas"');
    expect(html).toContain("Join Influence Queue");
    expectSiblingButtons(html, 3);
  });

  it("keeps the admin row passive except for portrait preview and explicit details", () => {
    const html = renderToString(
      <table>
        <tbody>
          <AgentRow agent={adminAgent()} onDetails={() => undefined} />
        </tbody>
      </table>,
    );

    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain('aria-label="View Atlas admin details"');
    expect(html).not.toContain("cursor-pointer");
    expectSiblingButtons(html, 2);
  });
});
