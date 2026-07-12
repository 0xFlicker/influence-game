import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  containedFocusTargetIndex,
  DAILY_AGENT_PROMPT_DELAY_MS,
  DAILY_AGENT_RETRY_DELAYS_MS,
  dailyAgentPromptBranch,
  shouldLoadDailyAgentPrompt,
} from "../components/standing-daily-agent-prompt-model";

const freePage = readFileSync(
  join(import.meta.dir, "../app/games/free/free-game-content.tsx"),
  "utf8",
);
const adminPanel = readFileSync(
  join(import.meta.dir, "../app/admin/free-queue-panel.tsx"),
  "utf8",
);

describe("standing Daily Agent acquisition", () => {
  it("selects zero, one, and many-agent branches with bounded delays", () => {
    expect(dailyAgentPromptBranch(0)).toBe("create");
    expect(dailyAgentPromptBranch(1)).toBe("single");
    expect(dailyAgentPromptBranch(2)).toBe("choose");
    expect(DAILY_AGENT_PROMPT_DELAY_MS).toBe(3000);
    expect(DAILY_AGENT_RETRY_DELAYS_MS).toEqual([2000, 5000]);
  });

  it("keeps keyboard focus inside from edges and outside focus", () => {
    expect(containedFocusTargetIndex(3, -1, false)).toBe(0);
    expect(containedFocusTargetIndex(3, -1, true)).toBe(2);
    expect(containedFocusTargetIndex(3, 0, true)).toBe(2);
    expect(containedFocusTargetIndex(3, 2, false)).toBe(0);
    expect(containedFocusTargetIndex(3, 1, false)).toBeNull();
  });

  it("does not arm until authentication and the root invite gate resolve", () => {
    const ready = { signedIn: true, needsInvite: false, hasAuthToken: true, sessionDismissed: false };
    expect(shouldLoadDailyAgentPrompt(ready)).toBe(true);
    expect(shouldLoadDailyAgentPrompt({ ...ready, needsInvite: true })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, signedIn: false })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, hasAuthToken: false })).toBe(false);
    expect(shouldLoadDailyAgentPrompt({ ...ready, sessionDismissed: true })).toBe(false);
  });

  it("keeps owner and admin removal direct and free of consequence warnings", () => {
    expect(freePage).toContain('onClick={onLeave}');
    expect(adminPanel).toContain('onClick={() => void remove(entry.userId)}');
    const removalSource = `${freePage}\n${adminPanel}`.toLowerCase();
    expect(removalSource).not.toContain("are you sure");
    expect(removalSource).not.toContain("next season");
    expect(removalSource).not.toContain("won't get");
  });
});
