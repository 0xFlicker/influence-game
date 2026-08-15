import { afterEach, describe, it, expect } from "bun:test";
import {
  resolveApiUrl,
  setApiBase,
} from "../lib/api";

describe("resolveApiUrl", () => {
  afterEach(() => {
    setApiBase("");
  });

  it("keeps API calls hostless until runtime configuration supplies an API origin", () => {
    setApiBase("");
    expect(resolveApiUrl("/api/auth/me")).toBe("/api/auth/me");
  });
});
