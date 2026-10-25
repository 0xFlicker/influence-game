import { expect, test } from "bun:test";
import { assignPlayerVoice, HOUSE_VOICE, isPlayerVoiceId, PLAYER_VOICES, STOCK_VOICES } from "../voice-catalog";

test("the frozen catalog reserves Helios exclusively for the global House", () => {
  expect(STOCK_VOICES).toHaveLength(28);
  expect(PLAYER_VOICES).toHaveLength(27);
  expect(PLAYER_VOICES.filter(voice => voice.gender === "male")).toHaveLength(18);
  expect(PLAYER_VOICES.filter(voice => voice.gender === "female")).toHaveLength(9);
  expect(HOUSE_VOICE).toMatchObject({ voiceId: "helios", origin: "house" });
  for (const invalid of ["helios", "invented", "ARA", null, {}, 1]) {
    expect(isPlayerVoiceId(invalid)).toBe(false);
    expect(() => assignPlayerVoice("agent-1", null, invalid)).toThrow();
  }
});

test("stable identity chooses an eligible matching voice without a live catalog or name", () => {
  for (const gender of ["male", "female", "non-binary", null] as const) {
    for (let index = 0; index < 100; index++) {
      const identity = `agent-${index}`;
      const assignment = assignPlayerVoice(identity, gender);
      expect(assignment).toEqual(assignPlayerVoice(identity, gender));
      expect(assignment.origin).toBe("automatic");
      expect(assignment.voiceId).not.toBe("helios");
      if (gender === "male" || gender === "female") expect(PLAYER_VOICES.find(voice => voice.id === assignment.voiceId)?.gender).toBe(gender);
    }
  }
  expect(["male", "female", null].map(gender => assignPlayerVoice("agent-1", gender as "male" | "female" | null).voiceId)).toEqual(["sirius", "liora", "ursa"]);
  expect(assignPlayerVoice("😀-雪", null).voiceId).toBe("helix");
  expect(assignPlayerVoice("agent-1", null)).toEqual(assignPlayerVoice("agent-1", "non-binary"));
  expect(() => assignPlayerVoice(" ", null)).toThrow("stable character identity");
});

test("explicit selection can cross gender labels, and reset returns the deterministic choice", () => {
  const initial = assignPlayerVoice("saved-agent", "male");
  const selected = assignPlayerVoice("saved-agent", "male", "ara");
  expect(selected).toMatchObject({ voiceId: "ara", origin: "selected", seedIdentity: "saved-agent" });
  expect(assignPlayerVoice("saved-agent", "male")).toEqual(initial);
  expect(Object.isFrozen(selected)).toBe(true);
  expect(Object.isFrozen(PLAYER_VOICES)).toBe(true);
});
