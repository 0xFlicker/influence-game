import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AvatarUpload } from "../components/avatar-upload";

describe("AvatarUpload", () => {
  it("does not show the persona default when no avatar URL has been selected", () => {
    const html = renderToString(
      createElement(AvatarUpload, {
        currentUrl: undefined,
        persona: "strategic",
        name: "Atlas",
        onUploaded: () => undefined,
      }),
    );

    expect(html).not.toContain("/avatars/personas/strategic.png");
    expect(html).toContain("Atlas avatar placeholder");
  });

  it("still renders an explicit avatar URL when one exists", () => {
    const html = renderToString(
      createElement(AvatarUpload, {
        currentUrl: "https://cdn.example/atlas.png",
        persona: "strategic",
        name: "Atlas",
        onUploaded: () => undefined,
      }),
    );

    expect(html).toContain("https://cdn.example/atlas.png");
  });
});
