import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { HOUSE_DISCORD_URL } from "../lib/product-identity";
import {
  EXTERNAL_FOOTER_LINK_PROPS,
  SITE_FOOTER_SECTIONS,
  shouldShowSiteFooter,
} from "../components/site-footer";

const layoutSource = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8",
);
const navSource = readFileSync(
  new URL("../components/nav.tsx", import.meta.url),
  "utf8",
);

describe("site footer", () => {
  it("is rendered by the root layout", () => {
    expect(layoutSource).toContain('import { SiteFooter } from "@/components/site-footer"');
    expect(layoutSource).toContain("<SiteFooter />");
  });

  it("keeps About and Privacy in the footer, not the header", () => {
    expect(navSource).not.toContain('href="/about"');
    expect(navSource).not.toContain('href="/privacy"');
  });

  it("appears on standard site and account routes", () => {
    expect(shouldShowSiteFooter("/")).toBe(true);
    expect(shouldShowSiteFooter("/games")).toBe(true);
    expect(shouldShowSiteFooter("/games/free")).toBe(true);
    expect(shouldShowSiteFooter("/rules")).toBe(true);
    expect(shouldShowSiteFooter("/about")).toBe(true);
    expect(shouldShowSiteFooter("/privacy")).toBe(true);
    expect(shouldShowSiteFooter("/dashboard")).toBe(true);
  });

  it("stays out of direct game-watch and replay routes", () => {
    expect(shouldShowSiteFooter("/games/cold-navy-horn")).toBe(false);
    expect(shouldShowSiteFooter("/games/cold-navy-horn/replay")).toBe(false);
  });

  it("keeps non-immersive game subpages covered", () => {
    expect(shouldShowSiteFooter("/games/cold-navy-horn/results")).toBe(true);
    expect(shouldShowSiteFooter("/games/cold-navy-horn/highlights")).toBe(true);
  });

  it("publishes the approved House destinations", () => {
    const links = SITE_FOOTER_SECTIONS.flatMap((section) => section.links);

    expect(links).toEqual([
      { label: "Games", href: "/games" },
      { label: "Influence Queue", href: "/games/free" },
      { label: "Rules", href: "/rules" },
      { label: "About", href: "/about" },
      { label: "Discord", href: HOUSE_DISCORD_URL, external: true },
      {
        label: "GitHub",
        href: "https://github.com/0xFlicker/influence-game",
        external: true,
      },
      { label: "Privacy", href: "/privacy" },
    ]);
  });

  it("opens external community links safely in a new tab", () => {
    expect(EXTERNAL_FOOTER_LINK_PROPS).toEqual({
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });
});
