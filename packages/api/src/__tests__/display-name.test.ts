import { describe, expect, test } from "bun:test";
import {
  getPublicDisplayName,
  getSafeDefaultDisplayName,
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

  test("never uses email as a public display name", () => {
    expect(
      getPublicDisplayName({
        displayName: "player@example.com",
        email: "player@example.com",
        walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      }),
    ).toBe("0x1234...5678");
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
});

