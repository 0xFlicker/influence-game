import Link from "next/link";
import {WerewolfViewer} from "../werewolf-viewer";
export const metadata = {title: "Watch Werewolf — The House", description: "Choose how to watch this village."};
export default async function WerewolfGamePage({params, searchParams}: {params: Promise<{slug: string}>; searchParams: Promise<{audience?: string}>}) {
  const {slug} = await params;
  const {audience} = await searchParams;
  if (audience === "mystery" || audience === "omniscient") return <WerewolfViewer key={`${slug}:${audience}`} slug={slug} audience={audience} />;
  return <main className="mx-auto flex min-h-[80dvh] max-w-3xl flex-col justify-center px-6 py-12">
    <Link href="/werewolf" className="mb-10 text-sm text-white/60">← Werewolf games</Link>
    <p className="text-xs uppercase tracking-[.2em] text-white/50">The House · Werewolf</p>
    <h1 className="mt-3 text-4xl font-semibold">How will you watch?</h1>
    <p className="mt-4 text-white/65">{slug} · Your viewing mode stays fixed for this replay.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <Link href={`?audience=mystery`} className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-white"><h2 className="text-xl">Watch Mystery</h2><p className="mt-3 leading-6 text-white/65">Follow the public conversation. Discover roles at the ending.</p></Link>
      <Link href={`?audience=omniscient`} className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-white"><h2 className="text-xl">Watch Omniscient</h2><p className="mt-3 leading-6 text-white/65">Know the roles, hear the pack and optionally watch players think.</p></Link>
    </div>
  </main>;
}
