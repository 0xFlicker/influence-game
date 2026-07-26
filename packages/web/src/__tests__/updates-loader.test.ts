import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAllPosts,
  getPostBySlug,
  loadPostsFromDir,
  UPDATES_CONTENT_DIR,
} from "../lib/updates";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "influence-updates-"));
  tempDirs.push(dir);
  return dir;
}

function writePost(
  dir: string,
  fileName: string,
  frontmatter: string,
  body = "Body text.\n",
): void {
  writeFileSync(join(dir, fileName), `---\n${frontmatter}\n---\n\n${body}`, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("updates loader", () => {
  it("parses a valid post with required fields", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "2026-07-25-sample.md",
      [
        'title: "Sample Update"',
        "date: 2026-07-25",
        'summary: "A short summary."',
        "tags:",
        "  - watch",
        "  - mcp",
      ].join("\n"),
    );

    const posts = loadPostsFromDir(dir);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      slug: "2026-07-25-sample",
      title: "Sample Update",
      date: "2026-07-25",
      summary: "A short summary.",
      tags: ["watch", "mcp"],
      draft: false,
    });
    expect(posts[0]?.body).toContain("Body text.");
  });

  it("sorts public posts newest first", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "2026-07-01-old.md",
      'title: "Old"\ndate: 2026-07-01\nsummary: "Older"\ntags: [watch]',
    );
    writePost(
      dir,
      "2026-07-20-new.md",
      'title: "New"\ndate: 2026-07-20\nsummary: "Newer"\ntags: [play]',
    );

    const posts = getAllPosts(dir);
    expect(posts.map((p) => p.slug)).toEqual([
      "2026-07-20-new",
      "2026-07-01-old",
    ]);
  });

  it("throws when title is missing", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "bad.md",
      "date: 2026-07-25\nsummary: s\ntags: [watch]",
    );
    expect(() => loadPostsFromDir(dir)).toThrow(/missing title/i);
  });

  it("throws when date is not ISO YYYY-MM-DD", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "bad-date.md",
      'title: "T"\ndate: 07/25/2026\nsummary: s\ntags: [watch]',
    );
    expect(() => loadPostsFromDir(dir)).toThrow(/invalid ISO date/i);
  });

  it("throws when tags are missing", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "no-tags.md",
      'title: "T"\ndate: 2026-07-25\nsummary: s',
    );
    expect(() => loadPostsFromDir(dir)).toThrow(/tags/i);
  });

  it("excludes draft posts from getAllPosts and getPostBySlug", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "2026-07-25-draft.md",
      'title: "Draft"\ndate: 2026-07-25\nsummary: s\ntags: [watch]\ndraft: true',
    );
    writePost(
      dir,
      "2026-07-25-live.md",
      'title: "Live"\ndate: 2026-07-25\nsummary: s\ntags: [play]',
    );

    expect(getAllPosts(dir).map((p) => p.slug)).toEqual(["2026-07-25-live"]);
    expect(getPostBySlug("2026-07-25-draft", dir)).toBeNull();
    expect(getPostBySlug("2026-07-25-live", dir)?.title).toBe("Live");
  });

  it("uses the full filename stem as the public slug", () => {
    const dir = makeTempDir();
    writePost(
      dir,
      "2026-07-25-format-kernel.md",
      'title: "Format"\ndate: 2026-07-25\nsummary: s\ntags: [rules]',
    );
    expect(loadPostsFromDir(dir)[0]?.slug).toBe("2026-07-25-format-kernel");
  });

  it("loads production content dir without throwing", () => {
    const posts = getAllPosts(UPDATES_CONTENT_DIR);
    for (const post of posts) {
      expect(post.title.length).toBeGreaterThan(0);
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(post.tags)).toBe(true);
      expect(post.draft).toBe(false);
    }
  });
});
