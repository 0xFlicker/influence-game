import { describe, expect, it } from "bun:test";
import {
  createAgentAvatarPreviewState,
  getAgentAvatarPreviewStats,
  isAgentAvatarPreviewOpen,
  reduceAgentAvatarPreviewState,
} from "../components/agent-avatar-preview-model";

describe("agent avatar preview interaction model", () => {
  it("stays open while hover transfers between the trigger and portaled panel", () => {
    let state = createAgentAvatarPreviewState();

    state = reduceAgentAvatarPreviewState(state, { type: "hover", active: true });
    expect(isAgentAvatarPreviewOpen(state)).toBe(true);

    // Floating UI's safe polygon keeps the hover source active across the gap.
    state = reduceAgentAvatarPreviewState(state, { type: "hover", active: true });
    expect(isAgentAvatarPreviewOpen(state)).toBe(true);

    state = reduceAgentAvatarPreviewState(state, { type: "hover", active: false });
    expect(isAgentAvatarPreviewOpen(state)).toBe(false);
  });

  it("opens on focus and suppresses reopening after Escape until leave and blur", () => {
    let state = createAgentAvatarPreviewState();
    state = reduceAgentAvatarPreviewState(state, { type: "hover", active: true });
    state = reduceAgentAvatarPreviewState(state, { type: "focus", active: true });
    expect(isAgentAvatarPreviewOpen(state)).toBe(true);

    state = reduceAgentAvatarPreviewState(state, { type: "dismiss" });
    expect(isAgentAvatarPreviewOpen(state)).toBe(false);

    state = reduceAgentAvatarPreviewState(state, { type: "hover", active: false });
    expect(isAgentAvatarPreviewOpen(state)).toBe(false);

    state = reduceAgentAvatarPreviewState(state, { type: "focus", active: false });
    state = reduceAgentAvatarPreviewState(state, { type: "focus", active: true });
    expect(isAgentAvatarPreviewOpen(state)).toBe(true);
  });

  it("pins and unpins on click or touch and dismisses an open pin from outside", () => {
    let state = createAgentAvatarPreviewState();

    state = reduceAgentAvatarPreviewState(state, { type: "toggle-pin" });
    expect(isAgentAvatarPreviewOpen(state)).toBe(true);
    expect(state.pinned).toBe(true);

    state = reduceAgentAvatarPreviewState(state, { type: "toggle-pin" });
    expect(isAgentAvatarPreviewOpen(state)).toBe(false);
    expect(state.pinned).toBe(false);

    state = reduceAgentAvatarPreviewState(state, { type: "toggle-pin" });
    state = reduceAgentAvatarPreviewState(state, { type: "dismiss" });
    expect(isAgentAvatarPreviewOpen(state)).toBe(false);
    expect(state.pinned).toBe(false);
  });
});

describe("agent avatar preview statistics", () => {
  it("distinguishes unavailable, zero-game, and positive records", () => {
    expect(getAgentAvatarPreviewStats(null, null)).toEqual({
      kind: "unavailable",
      message: "Current stats unavailable",
    });
    expect(getAgentAvatarPreviewStats(0, 0)).toEqual({
      kind: "empty",
      message: "No games yet",
    });
    expect(getAgentAvatarPreviewStats(5, 2)).toEqual({
      kind: "record",
      gamesPlayed: 5,
      gamesWon: 2,
      winRate: 40,
    });
  });

  it("treats partially unavailable current records as unavailable", () => {
    expect(getAgentAvatarPreviewStats(5, null).kind).toBe("unavailable");
    expect(getAgentAvatarPreviewStats(null, 2).kind).toBe("unavailable");
  });
});
