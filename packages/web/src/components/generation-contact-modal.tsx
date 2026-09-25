"use client";
import { useEffect, useRef, useState } from "react";
import { FALSE_FLOOR, HOUSE_DISCORD_URL } from "@/lib/product-identity";
export function GenerationContactModal() {
  const ref=useRef<HTMLDialogElement>(null); const [paused,setPaused]=useState(false);
  useEffect(()=>{
    function show(event:Event) { setPaused((event as CustomEvent<string>).detail==='generation_paused'); if(!ref.current?.open) ref.current?.showModal(); }
    window.addEventListener('generation:contact',show);return ()=>window.removeEventListener('generation:contact',show);
  },[]);
  return <dialog ref={ref} aria-labelledby="generation-contact-title" className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/20 bg-zinc-950 p-6 text-white backdrop:bg-black/70">
    <h2 id="generation-contact-title" className="text-xl font-semibold">{paused?'Generation is paused':'Need more generations?'}</h2>
    <p className="my-4 text-white/70">{paused?'Generation is paused for your account. Contact us for help.':'You’ve reached your current generation allowance. Contact us and we can help you get more.'}</p>
    <div className="flex flex-wrap gap-4"><a className="rounded bg-indigo-600 px-4 py-2" href={HOUSE_DISCORD_URL} target="_blank" rel="noreferrer">Ask on Discord</a><a className="py-2 underline" href={`mailto:${FALSE_FLOOR.supportEmail}`}>Email</a><a className="py-2 underline" href="https://x.com/0xflick" target="_blank" rel="noreferrer">Contact on X</a></div>
    <form method="dialog" className="mt-5"><button className="rounded border border-white/20 px-4 py-2">Dismiss</button></form>
  </dialog>;
}
