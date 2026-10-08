import { test, expect } from "bun:test";
import { bundlePath, fetchReplay } from "./assets";
test("bundle paths cannot escape into arbitrary local files", () => {
  for (const path of ["../secret", "/etc/passwd", "."])
    expect(() => bundlePath("/tmp/bundle", path)).toThrow();
  expect(bundlePath("/tmp/bundle", "assets/abc")).toBe(
    "/tmp/bundle/assets/abc",
  );
});
test("API credentials do not follow an asset redirect to another origin", async () => {
  let received: string | null = null,
    authorized = false;
  const target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      received = request.headers.get("authorization");
      return new Response("image");
    },
  });
  const source = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      authorized = request.headers.get("authorization") === "Bearer test-only";
      return Response.redirect(target.url, 302);
    },
  });
  try {
    await fetchReplay(
      source.url,
      source.url,
      "test-only",
      AbortSignal.timeout(5000),
    );
    expect(authorized).toBe(true);
    expect(received).toBeNull();
  } finally {
    source.stop(true);
    target.stop(true);
  }
});
