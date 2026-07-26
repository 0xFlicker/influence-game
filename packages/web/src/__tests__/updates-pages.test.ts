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

describe("updates pages", () => {
  it("publishes a static Updates index with list fields", () => {
    expect(indexSource).toContain('export const dynamic = "force-static"');
    expect(indexSource).toContain("getAllPosts");
    expect(indexSource).toContain("Updates");
    expect(indexSource).toContain("post.summary");
    expect(indexSource).toContain("post.tags");
    expect(indexSource).toContain('href={`/updates/${post.slug}`}');
  });

  it("publishes static post pages with Next 16 async params", () => {
    expect(postSource).toContain('export const dynamic = "force-static"');
    expect(postSource).toContain("export const dynamicParams = false");
    expect(postSource).toContain("generateStaticParams");
    expect(postSource).toContain("params: Promise<{ slug: string }>");
    expect(postSource).toContain("await params");
    expect(postSource).toContain("ReactMarkdown");
    expect(postSource).toContain("getPostBySlug");
  });

  it("ships with at least one public seed post", () => {
    const posts = getAllPosts(UPDATES_CONTENT_DIR);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const seed = posts.find((p) => p.slug.includes("format-kernel"));
    expect(seed).toBeDefined();
    expect(seed?.title.length).toBeGreaterThan(0);
    expect(seed?.tags.length).toBeGreaterThan(0);
    // Public-safe: no producer-only trace language in seed body
    expect(seed?.body.toLowerCase()).not.toContain("reasoningcontext");
    expect(seed?.body.toLowerCase()).not.toContain("private trace");
  });
});
