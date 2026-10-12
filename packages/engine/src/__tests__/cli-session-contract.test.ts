import { describe, expect, test } from "bun:test";
import { parseCliSessionHandoff, parseCliSessionOrigin, parseCliSessionRequest } from "../cli-session-contract";

const state = "S".repeat(43);
const request = { api: "https://api.house.example", callback: "http://127.0.0.1:12345/cli-session", state };

describe("ordinary CLI session handoff contract", () => {
  test("accepts safe origins and canonicalizes a trailing slash", () => {
    for (const origin of ["https://house.example", "http://127.0.0.1:3000", "http://localhost:3001", "http://[::1]:3000"]) {
      expect(parseCliSessionOrigin(origin)).toBe(origin);
      expect(parseCliSessionOrigin(`${origin}/`)).toBe(origin);
    }
    for (const origin of ["http://house.example", "https://user:pass@house.example", "https://house.example/path", "https://house.example?token=secret", "https://house.example#fragment", " https://house.example", "file:///tmp/house", "http://127.1:3000"]) {
      expect(() => parseCliSessionOrigin(origin)).toThrow();
    }
  });

  test("accepts only the exact literal loopback callback and bounded state", () => {
    expect(parseCliSessionRequest(request)).toEqual({ apiOrigin: request.api, callbackUrl: request.callback, state });
    for (const callback of ["http://localhost:12345/cli-session", "https://127.0.0.1:12345/cli-session", "http://127.0.0.1/cli-session", "http://127.0.0.1:0/cli-session", "http://127.0.0.1:12345/other", `${request.callback}?token=secret`, `${request.callback}#fragment`, "http://127.0.0.1:012345/cli-session", "http://127.0.0.1:12345/%63li-session", "http://user@127.0.0.1:12345/cli-session"]) {
      expect(() => parseCliSessionRequest({ ...request, callback })).toThrow();
    }
    for (const badState of ["", "S".repeat(42), "S".repeat(44), "!".repeat(43)]) expect(() => parseCliSessionRequest({ ...request, state: badState })).toThrow();
    expect(() => parseCliSessionRequest({ ...request, extra: true })).toThrow();
    expect(() => parseCliSessionRequest({ api: request.api, callback: request.callback })).toThrow();
  });

  test("handoff carries credentials only in strict JSON fields", () => {
    const handoff = { state, apiOrigin: request.api, token: "session-token" };
    expect(parseCliSessionHandoff(handoff)).toEqual(handoff);
    for (const token of ["", "white space", "x".repeat(16_385)]) expect(() => parseCliSessionHandoff({ ...handoff, token })).toThrow();
    expect(() => parseCliSessionHandoff({ ...handoff, apiOrigin: `${request.api}/` })).toThrow();
    expect(() => parseCliSessionHandoff({ ...handoff, callback: request.callback })).toThrow();
    expect(() => parseCliSessionHandoff([handoff])).toThrow();
  });
});
