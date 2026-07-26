import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { centeredScrollLeft } from "../components/updates/update-diagram-lightbox";
import { UpdateMarkdownAnchor } from "../components/updates/update-markdown-anchor";

const indexSource = readFileSync(
  join(import.meta.dir, "../app/updates/page.tsx"),
  "utf8",
);
const postSource = readFileSync(
  join(import.meta.dir, "../app/updates/[slug]/page.tsx"),
  "utf8",
);
const shellSource = readFileSync(
  join(import.meta.dir, "../components/updates/updates-shell.tsx"),
  "utf8",
);
const sidebarSource = readFileSync(
  join(import.meta.dir, "../components/updates/updates-sidebar.tsx"),
  "utf8",
);

describe("updates pages", () => {
  it("publishes a static Updates index with list fields", () => {
    expect(indexSource).toContain('export const dynamic = "force-static"');
    expect(indexSource).toContain("getAllPosts");
    expect(indexSource).toContain("Updates");
    expect(indexSource).toContain("post.summary");
    expect(indexSource).toContain("post.tags");
    expect(indexSource).toContain('href={`/updates/${post.slug}`}');
    expect(indexSource).toContain("UpdatesShell");
  });

  it("publishes static post pages with Next 16 async params", () => {
    expect(postSource).toContain('export const dynamic = "force-static"');
    expect(postSource).toContain("export const dynamicParams = false");
    expect(postSource).toContain("generateStaticParams");
    expect(postSource).toContain("params: Promise<{ slug: string }>");
    expect(postSource).toContain("await params");
    expect(postSource).toContain("ReactMarkdown");
    expect(postSource).toContain("getPostBySlug");
    expect(postSource).toContain("UpdatesShell");
    expect(postSource).toContain("activeSlug");
    expect(postSource).toContain("UpdateMarkdownAnchor");
  });

  it("renders a fit-width diagram preview with a full-size lightbox", () => {
    const html = renderToStaticMarkup(
      createElement(
        UpdateMarkdownAnchor,
        {
          href: "/updates/diagrams/architecture.svg",
          title: "Open the architecture diagram",
          className: "diagram-link",
          "aria-label": "Open the full-size architecture diagram",
        },
        createElement("img", {
          src: "/updates/diagrams/architecture.svg",
          alt: "Influence architecture",
        }),
      ),
    );

    expect(html).toContain('href="/updates/diagrams/architecture.svg"');
    expect(html).toContain(
      'class="diagram-link group relative block max-w-full rounded-xl border border-white/10 bg-black/30 p-2 pt-12 shadow-panel"',
    );
    expect(html).toContain(
      'aria-label="Open the full-size architecture diagram"',
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("<dialog");
    expect(html).toContain("Full-size diagram");
    expect(html).toContain('aria-label="Close full-size diagram"');
    expect(html).toContain("min-w-[64rem]");
    expect(html).not.toContain("<details");
    expect(html).toContain('src="/updates/diagrams/architecture.svg"');
    expect(html).toContain('alt="Influence architecture"');
  });

  it("leaves plain-text root-relative SVG links ordinary", () => {
    const html = renderToStaticMarkup(
      createElement(
        UpdateMarkdownAnchor,
        { href: "/updates/diagrams/architecture.svg" },
        "Open the architecture diagram",
      ),
    );

    expect(html).toContain('href="/updates/diagrams/architecture.svg"');
    expect(html).toContain("Open the architecture diagram");
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("aria-haspopup");
  });

  it("centers a full-size diagram when its mobile scroller opens", () => {
    expect(centeredScrollLeft(1024, 316)).toBe(354);
    expect(centeredScrollLeft(280, 316)).toBe(0);
  });

  it("leaves normal links ordinary", () => {
    const html = renderToStaticMarkup(
      createElement(
        UpdateMarkdownAnchor,
        { href: "/updates", target: "_blank", rel: "noreferrer" },
        "All updates",
      ),
    );

    expect(html).toBe(
      '<a target="_blank" rel="noreferrer" href="/updates">All updates</a>',
    );
  });

  it("uses a desktop sidebar of all post summaries", () => {
    expect(shellSource).toContain("lg:grid");
    expect(shellSource).toContain("UpdatesSidebar");
    expect(shellSource).toContain("lg:sticky");
    expect(sidebarSource).toContain("All updates");
    expect(sidebarSource).toContain("post.summary");
    expect(sidebarSource).toContain('href={`/updates/${post.slug}`}');
    expect(sidebarSource).toContain("aria-current");
  });
});
