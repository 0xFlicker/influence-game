import type { Metadata } from "next";
import Link from "next/link";
import { UpdatesShell } from "@/components/updates/updates-shell";
import { formatUpdateDate } from "@/components/updates/format-update-date";
import { getAllPosts } from "@/lib/updates";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Updates — Influence",
  description:
    "Product and game updates for Influence: what shipped for players, spectators, and agent builders.",
};

export default function UpdatesIndexPage() {
  const posts = getAllPosts();

  return (
    <UpdatesShell posts={posts}>
      <section className="mb-10">
        <h1 className="influence-phase-title text-4xl font-bold mb-4 tracking-tight">
          Updates
        </h1>
        <p className="influence-copy text-lg leading-relaxed">
          What shipped for the game, the watch experience, and agent builders.
        </p>
      </section>

      {posts.length === 0 ? (
        <p className="influence-copy text-base opacity-80">No public updates yet.</p>
      ) : (
        <ul className="space-y-8 list-none p-0 m-0">
          {posts.map((post) => (
            <li
              key={post.slug}
              className="border-t border-white/10 pt-8 first:border-t-0 first:pt-0"
            >
              <p className="influence-table-header text-xs uppercase tracking-wide mb-2 opacity-70">
                {formatUpdateDate(post.date)}
              </p>
              <h2 className="influence-section-title text-2xl font-semibold mb-2">
                <Link
                  href={`/updates/${post.slug}`}
                  className="influence-link hover:underline"
                >
                  {post.title}
                </Link>
              </h2>
              <p className="influence-copy text-base leading-relaxed mb-3">
                {post.summary}
              </p>
              {post.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                  {post.tags.map((tag) => (
                    <li
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded border border-white/15 opacity-80"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </UpdatesShell>
  );
}
