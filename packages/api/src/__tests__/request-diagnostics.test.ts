import { expect, test, spyOn } from "bun:test";
import { Hono } from "hono";
import { APIConnectionTimeoutError } from "openai";
import { FAILURE_HEADER, REQUEST_ID_HEADER, uuid } from "@influence/engine/operational-errors";
import { generationFailure, requestDiagnostics } from "../middleware/request-diagnostics.js";

test("the normal Hono request entry correlates known origin and handled server errors without request content", async () => {
  const app = new Hono();
  const sub = new Hono();
  const log = spyOn(console, "error").mockImplementation(() => {});
  sub.onError((error, c) => {
    generationFailure(c, error);
    return c.json({ error: "Try again." }, 502);
  });
  sub.post("/api/agent-profiles/anonymous", () => {
    throw new APIConnectionTimeoutError({ message: "SECRET upstream output" });
  });
  sub.post("/api/agent-profiles/generate/:id", c => c.json({ error: "Unavailable" }, 503));
  sub.get("/redirect", () => Response.redirect("https://thehouse.game/"));
  app.use("*", requestDiagnostics);
  app.route("/", sub);
  try {
    const response = await app.request("/api/agent-profiles/anonymous?prompt=SECRET", {
      method: "POST", body: "SECRET request body",
      headers: { [REQUEST_ID_HEADER]: "11111111-1111-1111-1111-111111111111", Cookie: "SECRET", Authorization: "Bearer SECRET" },
    });
    const id = response.headers.get(REQUEST_ID_HEADER);
    expect(uuid(id)).toBe(id ?? undefined);
    expect(id).not.toBe("11111111-1111-1111-1111-111111111111");
    expect(response.status).toBe(502);
    expect(response.headers.get(FAILURE_HEADER)).toBe("upstream_timeout");
    expect(await response.json()).toEqual({ error: "Try again." });
    expect(log).toHaveBeenCalledWith("[request-error]", expect.objectContaining({
      request_id: id, code: "upstream_timeout", route: "/api/agent-profiles/anonymous", method: "POST", status: 502,
    }));
    const unavailable = await app.request("/api/agent-profiles/generate/SECRET", { method: "POST" });
    expect(unavailable.headers.get(FAILURE_HEADER)).toBe("app_unavailable");
    expect(log.mock.calls[1]?.[1]).toMatchObject({ route: "/api/agent-profiles/generate/:id", no_frames_reason: "stack_unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    const redirect = await app.request("/redirect");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://thehouse.game/");
  } finally { log.mockRestore(); }
});
