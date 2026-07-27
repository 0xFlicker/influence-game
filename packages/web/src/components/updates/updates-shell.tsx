import type { ReactNode } from "react";
import Link from "next/link";
import { Nav } from "@/components/nav";
import type { UpdatePost } from "@/lib/updates";
import { UpdatesSidebar } from "./updates-sidebar";

type UpdatesShellProps = {
  posts: readonly UpdatePost[];
  /** When set, this is an article page: desktop sidebar + back link. */
  activeSlug?: string;
  children: ReactNode;
};

/**
 * Updates layout:
 * - Index: single column, full-width summary list (no sidebar)
 * - Article (desktop): sticky sidebar of all summaries + main article
 * - Article (mobile): article first, archive list below
 */
export function UpdatesShell({
  posts,
  activeSlug,
  children,
}: UpdatesShellProps) {
  const isArticle = Boolean(activeSlug);

  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <div
        className={`flex-1 w-full mx-auto px-6 py-12 sm:py-16 ${
          isArticle ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        {isArticle ? (
          <div className="lg:grid lg:grid-cols-[minmax(240px,18rem)_minmax(0,1fr)] lg:gap-12 lg:items-start">
            <div className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
              <p className="mb-4">
                <Link href="/updates" className="influence-link text-sm">
                  ← All updates
                </Link>
              </p>
              <UpdatesSidebar posts={posts} activeSlug={activeSlug} />
            </div>

            <div className="min-w-0">{children}</div>

            <div className="mt-14 border-t border-white/10 pt-10 lg:hidden">
              <UpdatesSidebar posts={posts} activeSlug={activeSlug} />
            </div>
          </div>
        ) : (
          <div className="min-w-0">{children}</div>
        )}
      </div>
    </div>
  );
}
