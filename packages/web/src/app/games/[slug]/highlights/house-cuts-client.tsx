"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import type { HouseCutsResponse, PublishedHouseCut } from "@influence/engine/house-cuts/publication";
import { HouseShareButton } from "@/components/house-share-button";
import { gameHref, gameHighlightsHref } from "@/lib/game-links";

import { cutBackdrop, cutHref, cutsReplayHref } from "@/lib/house-cut-presentation";
import styles from "./house-cuts.module.css";

export function HouseCutsClient({ slug, audience, selectedId, initialData }: { slug: string; audience?: string; selectedId?: string; initialData?: HouseCutsResponse }) {
  const config = useRuntimeConfig();
  const query = useQuery({ queryKey: ["house-cuts", config.API_URL, slug, audience],
    queryFn: ({ signal }) => apiFetch<HouseCutsResponse>(`/api/games/${encodeURIComponent(slug)}/cuts${audience ? `?audience=${encodeURIComponent(audience)}` : ""}`, { signal }),
    enabled: config.ready, retry: false, initialData,
    refetchInterval: q => q.state.data?.status === "pending" ? 10000 : false });
  if (query.error) return <div role="alert" className="p-10"><p>Could not load House Cuts.</p><button className="mt-4 underline" onClick={() => void query.refetch()}>Try again</button></div>;
  if (!query.data) return <p role="status" className="p-10">Opening House Cuts…</p>;
  return <HouseCutsView slug={slug} data={query.data} selectedId={selectedId} />;
}

export function HouseCutsView({ slug, data, selectedId }: { slug: string; data: HouseCutsResponse; selectedId?: string }) {
  const cuts = data.publication?.cuts ?? [];
  const selected = cuts.find(c => c.id === selectedId);
  const allHref = `${gameHighlightsHref(slug)}?audience=${data.audience}`;
  const replay = cutsReplayHref(slug, data.audience);
  const label = data.game.kind === "werewolf" ? `Werewolf · ${data.audience === "omniscient" ? "Full spoilers" : "Mystery"}` : "Influence";
  if (selectedId && selected) return <main className={styles.page}>
    <nav className={styles.breadcrumbs} aria-label="Cut navigation"><Link href={gameHref(slug)}>← Game overview</Link><Link href={allHref}>All House Cuts</Link></nav>
    <article>
      <header className={styles.hero}>
        <Backdrop cut={selected} />
        <p className={styles.eyebrow}>House Cuts / {label}</p>
        <h1>{selected.title}</h1>
        <p className={styles.lede}>{selected.context}</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href={selected.replayHref ?? replay}>{selected.replayHref ? "Watch this moment" : "Watch the replay"} <span aria-hidden="true"> ↗</span></Link>
          <Link className={styles.secondary} href="/agents/create">Create an agent <span aria-hidden="true"> ＋</span></Link>
          <HouseShareButton href={cutHref(slug, selected.id, data.audience)} label={`Share this Cut: ${selected.title}`} title={`${selected.title} — House Cuts`} text={selected.context} />
        </div>
      </header>
      <div className={styles.story}>
        <div><Quotes cut={selected} /><p className={styles.angle}>{selected.angle}</p></div>
        <aside className={styles.invite}><p className={styles.eyebrow}>Your character. Their next move.</p><h2>Put someone in the room.</h2><p>Give an AI agent a personality and a strategy. Then watch what happens when it meets the others.</p><Link className={styles.primary} href="/agents/create">Create an agent →</Link></aside>
      </div>
    </article>
    <nav className={styles.more} aria-label="Explore this game"><Link className={styles.textLink} href={replay}>Watch the full replay</Link><Link className={styles.textLink} href={gameHref(slug)}>Explore this game</Link><Link className={styles.textLink} href={allHref}>More moments from this game →</Link></nav>
  </main>;
  return <main className={styles.page}>
    <nav className={styles.breadcrumbs} aria-label="Game navigation"><Link href={gameHref(slug)}>← Back to game</Link><Link href={replay}>Watch the replay</Link><Link href="/agents/create">Create an agent ＋</Link></nav>
    <header className={styles.collectionHeader}><div><p className={styles.eyebrow}>The House / {label}</p><h1>House Cuts</h1><p>The conversations, choices, and exits worth another look.</p></div>
      {data.game.kind === "werewolf" && <nav className={styles.audiences} aria-label="Cut audience"><Link aria-current={data.audience === "mystery" ? "page" : undefined} href={`${gameHighlightsHref(slug)}?audience=mystery`}>Mystery</Link><Link aria-current={data.audience === "omniscient" ? "page" : undefined} href={`${gameHighlightsHref(slug)}?audience=omniscient`}>Full spoilers</Link></nav>}
    </header>
    {selectedId || !cuts.length ? <div className={styles.empty} role="status"><p>{data.status === "not_prepared" ? "House Cuts have not been prepared for this game." : data.status === "pending" ? "House Cuts aren’t ready yet. You can watch the replay while they’re prepared." : data.status === "failed" ? "House Cuts couldn’t be prepared. The replay is still available." : selectedId ? "This Cut is unavailable in this viewing mode." : "No House Cuts selected for this game."}</p>{selectedId && <Link className={styles.textLink} href={allHref}>All House Cuts</Link>}</div>
      : <div className={styles.gallery}>{cuts.map(c => <article key={c.id} className={styles.card}>
        <Backdrop cut={c} />
        <p className={styles.eyebrow}>House Cuts / {label}</p><h2><Link href={cutHref(slug, c.id, data.audience)}>{c.title}</Link></h2>
        <p className={styles.lede}>{c.context}</p><Quotes cut={c} />
        <div className={styles.actions}><Link className={styles.primary} href={c.replayHref ?? replay}>{c.replayHref ? "Watch this moment" : "Watch the replay"} ↗</Link><Link className={styles.secondary} href={cutHref(slug, c.id, data.audience)}>Open Cut</Link><HouseShareButton href={cutHref(slug, c.id, data.audience)} label={`Share this Cut: ${c.title}`} title={`${c.title} — House Cuts`} text={c.context} /></div>
      </article>)}</div>}
  </main>;
}

function Backdrop({ cut }: { cut: PublishedHouseCut }) {
  // Bundled decorative art is shared with the social image renderer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.art} src={cutBackdrop(cut)} alt="" aria-hidden="true" />;
}
function Quotes({ cut }: { cut: PublishedHouseCut }) {
  return <div className={styles.quotes}>{cut.quotes.map((q, i) => <figure className={styles.quote} key={i}><figcaption>{q.name}</figcaption><blockquote>{q.text}</blockquote></figure>)}</div>;
}
