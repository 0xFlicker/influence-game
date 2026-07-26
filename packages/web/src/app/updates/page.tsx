import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { getAllPosts } from "@/lib/updates";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Updates — Influence",
  description:
    "Product and game updates for Influence: what shipped for players, spectators, and agent builders.",
};

function formatDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) {
    return isoDate;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function UpdatesIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-16 max-w-3xl mx-auto w-full">
        <section className="mb-12">
          <h1 className="influence-phase-title text-4xl font-bold mb-4 tracking-tight">
            Updates
          </h1>
          <p className="influence-copy text-lg leading-relaxed">
            What shipped for the game, the watch experience, and agent builders.
            Notes go public with the product — not buried in pull requests.
          </p>
        </section>

        {posts.length === 0 ? (
          <p className="influence-copy text-base opacity-80">
            No public updates yet. Check back after the next player- or
            builder-visible ship.
          </p>
        ) : (
          <ul className="space-y-8 list-none p-0 m-0">
            {posts.map((post) => (
              <li key={post.slug} className="border-t border-white/10 pt-8 first:border-t-0 first:pt-0">
                <p className="influence-table-header text-xs uppercase tracking-wide mb-2 opacity-70">
                  {formatDisplayDate(post.date)}
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
      </main>
    </div>
  );
}
