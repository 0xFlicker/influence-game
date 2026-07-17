import { describe, expect, test } from "bun:test";
import {
  getPublicDisplayName,
  getSafeDefaultDisplayName,
  hasSafePublicDisplayName,
  isEmailLike,
} from "../lib/display-name.js";

describe("display-name helpers", () => {
  test("detects email-like names", () => {
    expect(isEmailLike("player@example.com")).toBe(true);
    expect(isEmailLike("Not An Email")).toBe(false);
  });

  test("uses wallet truncation for default signup name", () => {
    expect(
      getSafeDefaultDisplayName({
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      }),
    ).toBe("0x1234...5678");
  });

  test("never publishes an auth-derived placeholder as a display name", () => {
    const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";

    expect(
      getPublicDisplayName({
        displayName: "player@example.com",
        email: "player@example.com",
        walletAddress,
      }),
    ).toBe("Anonymous");
    expect(getPublicDisplayName({ displayName: walletAddress, walletAddress })).toBe("Anonymous");
    expect(getPublicDisplayName({ displayName: "0x1234...5678", walletAddress })).toBe("Anonymous");
    expect(getPublicDisplayName({ displayName: "Player", walletAddress })).toBe("Anonymous");
    expect(getPublicDisplayName({ displayName: "  ", walletAddress })).toBe("Anonymous");
  });

  test("preserves non-email public display names", () => {
    expect(
      getPublicDisplayName({
        displayName: "TableFlip",
        email: "player@example.com",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      }),
    ).toBe("TableFlip");
  });

  test("falls back to anonymous when no safe identifier exists", () => {
    expect(
      getPublicDisplayName({
        displayName: "player@example.com",
        email: "player@example.com",
        walletAddress: null,
      }),
    ).toBe("Anonymous");
  });

  test("uses the same placeholder policy for onboarding completeness", () => {
    const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
    expect(hasSafePublicDisplayName({ displayName: "TableFlip", walletAddress })).toBe(true);
    expect(hasSafePublicDisplayName({ displayName: "Player", walletAddress })).toBe(false);
    expect(hasSafePublicDisplayName({ displayName: walletAddress, walletAddress })).toBe(false);
    expect(hasSafePublicDisplayName({ displayName: "0x1234...5678", walletAddress })).toBe(false);
    expect(hasSafePublicDisplayName({ displayName: "player@example.com", email: "player@example.com" })).toBe(false);
  });
});
