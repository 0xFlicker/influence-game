import { describe, expect, it } from "bun:test";
import {
  currentPrivyProof,
  PRIVY_PROOF_TIMEOUT_MS,
} from "../lib/privy-proof";

describe("current Privy proof", () => {
  it("reuses the access token from an active Privy session", async () => {
    expect(await currentPrivyProof(async () => "active-privy-token"))
      .toBe("active-privy-token");
  });

  it("requires interactive authentication when no current proof is available", async () => {
    expect(await currentPrivyProof(async () => null)).toBeNull();
    expect(await currentPrivyProof(async () => {
      throw new Error("session refresh failed");
    })).toBeNull();
  });

  it("falls back when Privy never resolves the active-session request", async () => {
    expect(PRIVY_PROOF_TIMEOUT_MS).toBe(3_000);
    await expect(
      currentPrivyProof(() => new Promise<string | null>(() => {}), 0),
    ).resolves.toBeNull();
  });
});
