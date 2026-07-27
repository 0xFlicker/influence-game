import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatUpdateDate } from "@/components/updates/format-update-date";
import { UpdateMarkdownAnchor } from "@/components/updates/update-markdown-anchor";
import { UpdatesShell } from "@/components/updates/updates-shell";
import { getAllPosts, getAllPostSlugs, getPostBySlug } from "@/lib/updates";

export const dynamic = "force-static";
export const dynamicParams = false;

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): Array<{ slug: string }> {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return { title: "Update — Influence" };
  }
  return {
    title: `${post.title} — Influence`,
    description: post.summary,
  };
}

export default async function UpdatePostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  const posts = getAllPosts();

  return (
    <UpdatesShell posts={posts} activeSlug={slug}>
      <p className="mb-6 lg:hidden">
        <Link href="/updates" className="influence-link text-sm">
          ← All updates
        </Link>
      </p>


      <header className="mb-10">
        <p className="influence-table-header text-xs uppercase tracking-wide mb-3 opacity-70">
          {formatUpdateDate(post.date)}
        </p>
        <h1 className="influence-phase-title text-4xl font-bold mb-4 tracking-tight">
          {post.title}
        </h1>
        <p className="influence-copy text-lg leading-relaxed mb-4">
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
      </header>

      <article className="influence-copy updates-markdown space-y-4 text-base leading-relaxed [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:tracking-tight [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_blockquote]:my-5 [&_blockquote]:rounded-r-md [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-200/40 [&_blockquote]:bg-cyan-300/[0.05] [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote_p]:m-0 [&_img]:h-auto [&_img]:w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-white/10 [&_img]:bg-black/30 [&_img]:shadow-panel [&_em]:text-white/65 [&_code]:text-sm [&_code]:px-1 [&_code]:rounded [&_code]:bg-white/10 [&_pre]:p-4 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:bg-white/5">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: UpdateMarkdownAnchor,
          }}
        >
          {post.body}
        </ReactMarkdown>
      </article>
    </UpdatesShell>
  );
}
