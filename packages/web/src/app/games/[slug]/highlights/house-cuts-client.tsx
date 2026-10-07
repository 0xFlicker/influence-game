"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import type { HouseCutsResponse } from "@influence/engine/house-cuts/publication";
import { usePostgameShare, shareFeedbackClassName } from "../components/postgame-media-player";
import { gameHref, gameHighlightsHref } from "@/lib/game-links";

export function HouseCutsClient({ slug, audience, selectedId }: { slug: string; audience?: string; selectedId?: string }) {
  const config = useRuntimeConfig();
  const query = useQuery({ queryKey: ["house-cuts", config.API_URL, slug, audience],
    queryFn: ({ signal }) => apiFetch<HouseCutsResponse>(`/api/games/${encodeURIComponent(slug)}/cuts${audience ? `?audience=${encodeURIComponent(audience)}` : ""}`, { signal }),
    enabled: config.ready, retry: false,
    refetchInterval: q => q.state.data?.status === "pending" ? 10000 : false });
  if (query.error) return <div role="alert" className="p-10"><p>Could not load House Cuts.</p><button className="mt-4 underline" onClick={() => void query.refetch()}>Try again</button></div>;
  if (!query.data) return <p role="status" className="p-10">Opening House Cuts…</p>;
  return <HouseCutsView slug={slug} data={query.data} selectedId={selectedId} />;
}

export function HouseCutsView({ slug, data, selectedId }: { slug: string; data: HouseCutsResponse; selectedId?: string }) {
  const cuts = data?.publication?.cuts ?? [];
  const shown = selectedId ? cuts.filter(c => c.id === selectedId) : cuts;
  return <section className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
    <Link href={gameHref(slug)} className="text-sm text-white/60 hover:text-white">← Back to game</Link>
    <p className="mt-10 text-xs uppercase tracking-[.2em] text-amber-200/70">The House · {data?.game.kind ?? ""}</p>
    <h1 className="mt-3 text-4xl font-semibold sm:text-6xl">House Cuts</h1>
    <p className="mt-4 text-white/60">{slug} · {data?.audience === "omniscient" ? "Full spoilers" : data?.audience === "mystery" ? "Mystery" : "Selected moments"}</p>
    {data?.game.kind === "werewolf" && <nav aria-label="Cut audience" className="mt-6 flex gap-5 text-sm">
      <Link aria-current={data.audience === "mystery" ? "page" : undefined} href={`${gameHighlightsHref(slug)}?audience=mystery`}>Mystery</Link>
      <Link aria-current={data.audience === "omniscient" ? "page" : undefined} href={`${gameHighlightsHref(slug)}?audience=omniscient`}>Full spoilers</Link>
    </nav>}
    {data.status === "not_prepared" ? <p className="mt-10 text-white/60">House Cuts have not been prepared for this game.</p>
      : data.status === "pending" ? <p role="status" className="mt-10 text-white/60">House Cuts aren’t ready yet. You can watch the replay while they’re prepared.</p>
      : data.status === "failed" ? <p role="status" className="mt-10 text-white/60">House Cuts couldn’t be prepared. The replay is still available.</p>
      : !shown.length ? <p className="mt-10 text-white/60">{selectedId ? "This Cut is unavailable in this viewing mode." : "No House Cuts selected for this game."}</p> : null}
    {selectedId && <Link className="mt-6 inline-block text-sm underline" href={`${gameHighlightsHref(slug)}?audience=${data.audience}`}>All House Cuts</Link>}
    <div className="mt-10 space-y-10">{shown.map(c => <article key={c.id} className="rounded-2xl border border-white/15 bg-gradient-to-br from-stone-900 to-black p-6 sm:p-10">
      <p className="text-xs uppercase tracking-widest text-white/45">{data?.audience === "omniscient" ? "Full spoilers" : "The House"}</p>
      <h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">{c.title}</h2>
      <p className="mt-5 leading-relaxed text-white/70">{c.context}</p>
      {c.quotes.length > 0 && <div className="mt-8 grid gap-8 sm:grid-cols-2">{c.quotes.map((q, i) => <figure key={i}><figcaption className="text-sm font-semibold text-amber-200/80">{q.name}</figcaption><blockquote className="mt-3 text-xl leading-relaxed">“{q.text}”</blockquote></figure>)}</div>}
      <p className="mt-7 font-serif text-xl italic text-amber-100/80">{c.angle}</p>
      {c.payoff && <p className="mt-4 leading-relaxed text-white/65">{c.payoff}</p>}
      <footer className="mt-8 flex flex-wrap gap-5 border-t border-white/10 pt-5 text-sm">
        {c.replayHref && <Link className="text-white/80 hover:text-white" href={c.replayHref}>Watch this moment ↗</Link>}
        <CutShare href={`${gameHighlightsHref(slug)}?scene=${encodeURIComponent(c.id)}&audience=${data.audience}`} title={c.title} text={c.context} />
      </footer>
    </article>)}</div>
  </section>;
}

function CutShare({ href, title, text }: { href: string; title: string; text: string }) {
  const { feedback, shareLink } = usePostgameShare({ href, title: `${title} — House Cuts`, text, unavailableMessage: "Unable to share this Cut right now." });
  return <div>
    <button type="button" className="text-white/80 hover:text-white" aria-label={`Share this Cut: ${title}`} onClick={() => void shareLink()}>Share this Cut ↗</button>
    <Link className="ml-5 text-white/60 hover:text-white" href={href}>Open Cut</Link>
    {feedback && <p role="status" className={shareFeedbackClassName(feedback)}>{feedback.message}</p>}
  </div>;
}
