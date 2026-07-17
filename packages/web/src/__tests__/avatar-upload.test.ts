import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AvatarUpload } from "../components/avatar-upload";

describe("AvatarUpload", () => {
  it("keeps portrait preview separate from the file-picker action", () => {
    const html = renderToString(
      createElement(AvatarUpload, {
        currentUrl: undefined,
        persona: "strategic",
        name: "Atlas",
        onUploaded: () => undefined,
      }),
    );

    expect(html).toContain("/avatars/personas/strategic.png");
    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain("Change portrait");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
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
