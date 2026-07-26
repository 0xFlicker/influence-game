import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export type UpdatePost = {
  slug: string;
  title: string;
  date: string;
  summary: string;
  tags: string[];
  draft: boolean;
  body: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve content dir for Bun tests, Next/Turbopack dev, and monorepo roots.
 * Prefer module-relative path (import.meta.url); fall back to cwd variants.
 * Do not use Bun-only `import.meta.dir` — it is undefined under Next.js.
 */
function resolveUpdatesContentDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "../../content/updates"),
    join(process.cwd(), "content/updates"),
    join(process.cwd(), "packages/web/content/updates"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  return candidates[0] ?? join(moduleDir, "../../content/updates");
}

/** Production content directory (package-relative when possible). */
export const UPDATES_CONTENT_DIR = resolveUpdatesContentDir();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeDate(value: unknown, filePath: string): string {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    return value;
  }
  // gray-matter/yaml may parse bare ISO dates as Date
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    if (ISO_DATE.test(iso)) {
      return iso;
    }
  }
  throw new Error(
    `Updates post missing or invalid ISO date (YYYY-MM-DD): ${filePath}`,
  );
}

function parsePostFile(filePath: string, fileName: string): UpdatePost {
  const slug = basename(fileName, ".md");
  if (!slug) {
    throw new Error(`Updates post has empty slug: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const title = data.title;
  const summary = data.summary;
  const tags = data.tags;
  const date = normalizeDate(data.date, filePath);

  if (typeof title !== "string" || title.trim() === "") {
    throw new Error(`Updates post missing title: ${filePath}`);
  }
  if (typeof summary !== "string" || summary.trim() === "") {
    throw new Error(`Updates post missing summary: ${filePath}`);
  }
  if (!isStringArray(tags)) {
    throw new Error(`Updates post missing tags string array: ${filePath}`);
  }

  const draft = data.draft === true;

  return {
    slug,
    title: title.trim(),
    date,
    summary: summary.trim(),
    tags: tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    draft,
    body: content.replace(/^\uFEFF?/, "").trimStart(),
  };
}

/**
 * Load and validate all markdown posts under `dir`.
 * Throws on missing fields, bad dates, or duplicate slugs.
 * Draft posts are included in the return value; filter for public lists.
 */
export function loadPostsFromDir(dir: string): UpdatePost[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const mdFiles = entries.filter((name) => name.endsWith(".md")).sort();
  const posts: UpdatePost[] = [];
  const seenSlugs = new Set<string>();

  for (const fileName of mdFiles) {
    const filePath = join(dir, fileName);
    const post = parsePostFile(filePath, fileName);
    if (seenSlugs.has(post.slug)) {
      throw new Error(`Duplicate updates slug "${post.slug}" in ${dir}`);
    }
    seenSlugs.add(post.slug);
    posts.push(post);
  }

  return posts;
}

/** Public posts newest-first (non-draft only). */
export function getAllPosts(dir: string = UPDATES_CONTENT_DIR): UpdatePost[] {
  return loadPostsFromDir(dir)
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
}

export function getPostBySlug(
  slug: string,
  dir: string = UPDATES_CONTENT_DIR,
): UpdatePost | null {
  const post = loadPostsFromDir(dir).find((entry) => entry.slug === slug);
  if (!post || post.draft) {
    return null;
  }
  return post;
}

/** All non-draft slugs for static generation. */
export function getAllPostSlugs(dir: string = UPDATES_CONTENT_DIR): string[] {
  return getAllPosts(dir).map((post) => post.slug);
}
