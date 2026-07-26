import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllPosts, UPDATES_CONTENT_DIR } from "../lib/updates";

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

  it("ships public archive posts for recent features", () => {
    const posts = getAllPosts(UPDATES_CONTENT_DIR);
    expect(posts.length).toBeGreaterThanOrEqual(5);
    const titles = posts.map((p) => p.title);
    expect(titles.some((t) => t.includes("House Highlights"))).toBe(true);
    expect(titles.some((t) => t.includes("public identities"))).toBe(true);
    expect(titles.some((t) => t.includes("dual crowns"))).toBe(true);
    expect(titles.some((t) => t.includes("MCP setup"))).toBe(true);
    const seed = posts.find((p) => p.slug.includes("format-kernel"));
    expect(seed).toBeDefined();
    expect(seed?.title.length).toBeGreaterThan(0);
    expect(seed?.tags.length).toBeGreaterThan(0);
    expect(seed?.body.toLowerCase()).not.toContain("reasoningcontext");
    expect(seed?.body.toLowerCase()).not.toContain("private trace");
  });
});
