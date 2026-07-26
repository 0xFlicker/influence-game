import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const webRoot = join(import.meta.dir, "../..");
const postPath = join(
  webRoot,
  "content/updates/2026-07-01-inside-the-house-agentic-architecture.md",
);
const diagramNames = [
  "system-map",
  "agent-decision-loop",
  "influence-evaluation",
  "truth-and-evidence",
  "interface-mesh",
  "authority-lanes",
  "change-contract",
] as const;

describe("genesis architecture update", () => {
  it("publishes the long-form architecture baseline with paired explanations", () => {
    expect(existsSync(postPath)).toBe(true);

    const { data, content } = matter(readFileSync(postPath, "utf8"));
    expect(data.title).toContain("Inside The House");
    expect(data.date).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(data.tags).toEqual(
      expect.arrayContaining(["agents", "architecture", "mcp"]),
    );

    expect(content.match(/> \*\*In plain terms:\*\*/g)).toHaveLength(
      diagramNames.length,
    );
    expect(content.match(/### Technical view/g)).toHaveLength(
      diagramNames.length,
    );
  });

  it("keeps accessible Mermaid sources beside every rendered diagram", () => {
    const content = readFileSync(postPath, "utf8");

    for (const diagramName of diagramNames) {
      const sourcePath = join(
        webRoot,
        `content/updates/diagrams/inside-the-house/${diagramName}.mmd`,
      );
      const publicPath = join(
        webRoot,
        `public/updates/inside-the-house/${diagramName}.svg`,
      );

      expect(content).toContain(
        `/updates/inside-the-house/${diagramName}.svg`,
      );
      expect(existsSync(sourcePath)).toBe(true);
      expect(existsSync(publicPath)).toBe(true);

      const source = readFileSync(sourcePath, "utf8");
      expect(source).toContain("accTitle:");
      expect(source).toContain("accDescr:");

      const svg = readFileSync(publicPath, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("<title");
      expect(svg).toContain("<desc");
    }
  });
});
