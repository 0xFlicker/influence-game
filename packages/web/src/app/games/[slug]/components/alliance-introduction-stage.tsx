"use client";

import { useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { ALLIANCE_MEMBERS_PER_PAGE, allianceIntroductionDurationMs, allianceMemberPage } from "@influence/engine/alliance-introductions";
import { HouseMessage } from "@/components/watch/house-message";
import { houseSegmentMotion } from "./house-segment";
import { RoomBackdrop } from "./stage-backdrop";
import { INFLUENCE_ROOMS } from "./influence-rooms";
import type { FormatPresentationRosterPlayer } from "./types";
import styles from "./alliance-introduction-stage.module.css";

/** Editorial introduction; every transition follows the shared playback clock. */
export function AllianceIntroductionStage({ allianceName, participants, text, elapsedMs, readingElapsedMs, paused, reducedMotion,
  controlsInset = 0, logoUrl = "/logo.png" }: {
  allianceName: string; participants: FormatPresentationRosterPlayer[]; text: string;
  elapsedMs: number; readingElapsedMs: number; paused: boolean; reducedMotion: boolean; controlsInset?: number; logoUrl?: string;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const duration = allianceIntroductionDurationMs(text, participants.length);
  const motion = houseSegmentMotion(elapsedMs, duration, paused, reducedMotion);
  const page = allianceMemberPage(elapsedMs, duration, participants.length);
  const pages = Math.ceil(participants.length / ALLIANCE_MEMBERS_PER_PAGE);
  const visible = participants.slice(page * ALLIANCE_MEMBERS_PER_PAGE, (page + 1) * ALLIANCE_MEMBERS_PER_PAGE);
  return <section aria-label={allianceName} data-alliance-introduction className="relative isolate flex min-h-0 w-full flex-1 flex-col overflow-hidden text-center"
    style={{ paddingBottom: controlsInset }}>
    <RoomBackdrop source={INFLUENCE_ROOMS.lobby} />
    <div className="pointer-events-none absolute inset-0 -z-10 bg-black/65" />
    <div className={`${styles.viewport} flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-5 sm:px-10`}>
    <div className={`${styles.layout} my-auto shrink-0`} style={motion}>
      <h2 className={`${styles.title} text-balance text-3xl font-medium tracking-wide text-[#e6ce9a] sm:text-5xl`}>{allianceName}</h2>
      <div className={`${styles.members} mx-auto flex w-full max-w-4xl flex-wrap justify-center gap-x-5 gap-y-4 sm:gap-x-8`}>
        {visible.map(player => {
          const saved = resolveAgentAvatarUrl(player.avatarUrl, player.persona ?? "", player.name, player.personaKey);
          const source = failed.has(saved) ? resolveAgentAvatarUrl(null, player.persona ?? "", player.name, player.personaKey) : saved;
          return <div key={player.id} data-alliance-member={player.id} className={`${styles.member} flex flex-col items-center gap-3`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- frozen cast art with deterministic portrait fallback */}
            <img src={source} alt={player.name} onError={() => setFailed(previous => new Set(previous).add(saved))}
              className="aspect-square w-full rounded-full object-cover shadow-2xl ring-2 ring-[#d9c9a2]/60" />
            <p className="w-full break-words text-sm text-white/90 sm:text-base">{player.name}</p>
          </div>;
        })}
      </div>
      <div className={`${styles.copy} mx-auto flex w-full max-w-3xl flex-col`}>
        <HouseMessage text={text} elapsedMs={readingElapsedMs} logoUrl={logoUrl} />
      </div>
      {pages > 1 && <p className={`${styles.page} text-xs text-white/60`} aria-label={`Members ${page * ALLIANCE_MEMBERS_PER_PAGE + 1} to ${Math.min(participants.length, (page + 1) * ALLIANCE_MEMBERS_PER_PAGE)} of ${participants.length}`}>{page + 1} / {pages}</p>}
    </div>
    </div>
  </section>;
}
