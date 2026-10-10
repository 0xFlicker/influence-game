"use client";
import { useEffect, useState } from "react";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { werewolfDoctorSave, type WerewolfWatchCue } from "./werewolf-watch-model";

/** Nonviolent hunt staging with the recorded protection outcome in Omniscient. */
export function WerewolfHuntStage({ cue, scene, onReady }: { cue: WerewolfWatchCue; scene: AcceptedVisualScene | null; onReady: (ready: boolean) => void }) {
  const hunt = cue.nightAction;
  if (!hunt || hunt.kind !== "hunt") throw new Error("Hunt stage requires a hunt action");
  const imageUrl = scene?.imageUrl ?? null;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = imageUrl !== null && failedUrl === imageUrl;
  useEffect(() => { onReady(!imageUrl || loadedUrl === imageUrl || failed); }, [imageUrl, loadedUrl, failed, onReady]);
  const players = cue.moment.snapshot.players;
  const save = werewolfDoctorSave(cue.moment);
  const [failedDoctorUrl, setFailedDoctorUrl] = useState<string | null>(null);
  const doctorUrl = save?.doctor.avatarUrl ?? save?.doctor.fullBodyReferenceUrl;
  return <div className="relative flex min-h-0 flex-1 flex-col gap-4 bg-[#101318] p-4 sm:p-5" data-night-hunt>
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
    {/* eslint-disable-next-line @next/next/no-img-element -- immutable audience-scoped generated scene */}
    {scene && !failed ? <img src={scene.imageUrl} alt="The pack and their distant target in the moonlit village" className="absolute inset-0 h-full w-full object-contain" onLoad={() => setLoadedUrl(scene.imageUrl)} onError={() => setFailedUrl(scene.imageUrl)} />
      : <div className="flex h-full min-h-0 w-full max-w-4xl items-center justify-between gap-4 sm:gap-8">
        {[hunt.wolfIds, [hunt.targetId]].map((ids, group) => <div key={group} className="flex flex-1 flex-wrap justify-center gap-3">{ids.map(id => {
          const player = players.find(p => p.id === id)!;
          return <figure key={id} className={`min-w-0 max-w-56 flex-1 text-center ${group === 1 && save ? "rounded-xl border border-emerald-200/40 bg-emerald-950/25 p-2" : ""}`}>
            <HuntPortrait player={player} wolfUrl={group === 0 ? cue.moment.wolfForms?.[id] : undefined} />
            <figcaption className="mt-3 text-sm text-white">{player.name}<span className="block text-xs text-white/50">{group === 0 ? "The pack" : save ? "Saved tonight" : "Tonight’s target"}</span></figcaption>
          </figure>;
        })}</div>)}
      </div>}
    </div>
    {save ? <aside data-doctor-save className="z-10 mx-auto flex w-full max-w-xl shrink-0 items-center gap-3 rounded-xl border border-emerald-200/30 bg-[#102923] p-3 text-emerald-50 sm:gap-4 sm:p-4">
      {doctorUrl && failedDoctorUrl !== doctorUrl ?
        // eslint-disable-next-line @next/next/no-img-element -- frozen doctor portrait
        <img src={doctorUrl} alt={save.doctor.name} onError={() => setFailedDoctorUrl(doctorUrl)} className={`size-14 shrink-0 rounded-lg border border-emerald-200/30 bg-black/20 sm:size-16 ${save.doctor.avatarUrl ? "object-cover" : "object-contain"}`} />
        : <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-emerald-200/30 text-2xl">+</span>}
      <div className="min-w-0">
        <p className="text-balance text-base font-semibold sm:text-lg">{save.target.name} was saved by the Doctor.</p>
        <p className="mt-1 text-sm text-emerald-100/75">{save.doctor.name} · Doctor</p>
      </div>
    </aside> : <p className="shrink-0 text-center text-sm text-white/75">Night falls over the village</p>}
  </div>;
}

function HuntPortrait({player, wolfUrl}: {player: {name: string; avatarUrl: string | null; fullBodyReferenceUrl?: string | null}; wolfUrl?: string}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const source = [wolfUrl, player.fullBodyReferenceUrl, player.avatarUrl].find(url => url && !failed.has(url));
  // The caption remains when all available pictures fail.
  return source ? <img src={source} alt={player.name} className="max-h-[38cqh] w-full object-contain" onError={() => setFailed(previous => new Set(previous).add(source))} /> : null; // eslint-disable-line @next/next/no-img-element
}
