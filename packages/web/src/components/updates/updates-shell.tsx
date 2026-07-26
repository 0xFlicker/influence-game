import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import type { UpdatePost } from "@/lib/updates";
import { UpdatesSidebar } from "./updates-sidebar";

type UpdatesShellProps = {
  posts: readonly UpdatePost[];
  activeSlug?: string;
  children: ReactNode;
};

/**
 * Responsive Updates layout:
 * - Desktop (lg+): sticky sidebar of all post summaries + main column
 * - Mobile: main content first; post pages get the full list below
 */
export function UpdatesShell({
  posts,
  activeSlug,
  children,
}: UpdatesShellProps) {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <div className="flex-1 w-full max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <div className="lg:grid lg:grid-cols-[minmax(240px,18rem)_minmax(0,1fr)] lg:gap-12 lg:items-start">
          <div className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
            <UpdatesSidebar posts={posts} activeSlug={activeSlug} />
          </div>

          <div className="min-w-0">{children}</div>

          {activeSlug ? (
            <div className="mt-14 border-t border-white/10 pt-10 lg:hidden">
              <UpdatesSidebar posts={posts} activeSlug={activeSlug} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
