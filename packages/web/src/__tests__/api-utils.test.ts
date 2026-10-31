import { afterEach, describe, it, expect } from "bun:test";
import {
  resolveApiUrl,
  setApiBase,
} from "../lib/api";

describe("resolveApiUrl", () => {
  afterEach(() => {
    setApiBase("");
  });

  it("keeps bundled character art on the web origin with a separate API server", () => {
    setApiBase("http://localhost:3000/");
    expect(resolveApiUrl("/avatars/personas/full-body-v1/social.webp")).toBe("/avatars/personas/full-body-v1/social.webp");
    expect(resolveApiUrl("/avatars/personas/social.png")).toBe("/avatars/personas/social.png");
    expect(resolveApiUrl("/api/games/g/cutouts/c")).toBe("http://localhost:3000/api/games/g/cutouts/c");
    expect(resolveApiUrl("https://images.example/avatar.webp")).toBe("https://images.example/avatar.webp");
  });

  it("keeps API calls hostless until runtime configuration supplies an API origin", () => {
    setApiBase("");
    expect(resolveApiUrl("/api/auth/me")).toBe("/api/auth/me");
  });
});
