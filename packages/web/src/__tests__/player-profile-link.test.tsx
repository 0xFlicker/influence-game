import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerProfileLink } from "../components/player-profile-link";

const publicId = "9e8e3b45-11a3-4f32-a215-713daaf25186";

describe("PlayerProfileLink", () => {
  test("prefers a canonical handle and preserves visible copy", () => {
    const html = renderToStaticMarkup(
      <PlayerProfileLink
        player={{ publicId, handle: "flick-player", displayName: "Flick" }}
      >
        Historical owner copy
      </PlayerProfileLink>,
    );

    expect(html).toContain('href="/profile/flick-player"');
    expect(html).toContain("Historical owner copy");
  });

  test("falls back to the public UUID without using legacy internal IDs", () => {
    const html = renderToStaticMarkup(
      <PlayerProfileLink
        player={{ publicId, handle: null, displayName: "Flick" }}
      >
        Flick
      </PlayerProfileLink>,
    );

    expect(html).toContain(`href="/profile/${publicId}"`);
  });

  test("renders unresolved, Anonymous, and malformed identities as plain text", () => {
    for (const player of [
      null,
      { publicId, handle: "flick", displayName: "Anonymous" },
      { publicId: "legacy-internal-user-id", handle: null, displayName: "Legacy" },
    ]) {
      const html = renderToStaticMarkup(
        <PlayerProfileLink player={player}>Plain owner copy</PlayerProfileLink>,
      );
      expect(html).toContain("<span");
      expect(html).toContain("Plain owner copy");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("legacy-internal-user-id");
    }
  });
});
