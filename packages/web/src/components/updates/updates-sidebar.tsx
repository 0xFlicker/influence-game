import Link from "next/link";
import type { UpdatePost } from "@/lib/updates";
import { formatUpdateDate } from "./format-update-date";

type UpdatesSidebarProps = {
  posts: readonly UpdatePost[];
  activeSlug?: string;
  /** Mobile places the list after the article; desktop always shows it. */
  className?: string;
};

export function UpdatesSidebar({
  posts,
  activeSlug,
  className = "",
}: UpdatesSidebarProps) {
  return (
    <aside className={className} aria-label="All updates">
      <p className="influence-table-header text-xs uppercase tracking-wider font-semibold mb-4">
        All updates
      </p>
      {posts.length === 0 ? (
        <p className="influence-copy text-sm opacity-80">No public updates yet.</p>
      ) : (
        <ul className="list-none p-0 m-0 space-y-1">
          {posts.map((post) => {
            const active = post.slug === activeSlug;
            return (
              <li key={post.slug}>
                <Link
                  href={`/updates/${post.slug}`}
                  className={`block rounded-xl border px-3 py-3 transition-colors ${
                    active
                      ? "border-border-active/80 bg-white/5"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <p className="influence-table-header text-[10px] uppercase tracking-wide opacity-70 mb-1">
                    {formatUpdateDate(post.date, "short")}
                  </p>
                  <p
                    className={`text-sm font-medium leading-snug mb-1.5 ${
                      active ? "text-text-primary" : "text-text-primary/90"
                    }`}
                  >
                    {post.title}
                  </p>
                  <p className="influence-copy text-xs leading-relaxed line-clamp-3 opacity-80">
                    {post.summary}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
