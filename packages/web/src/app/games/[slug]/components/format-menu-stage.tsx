"use client";
import {useState} from "react";
import {AgentAvatar} from "@/components/agent-avatar";
import {characterImageError} from "@/components/character/image-error";
import {formatPresentationMetadata, type LaunchFormatId} from "@influence/engine/format-presentation-metadata";
import type {FormatPresentationRosterPlayer} from "./types";
import styles from "./format-menu-stage.module.css";

/** Canonical offer stays visible while the House explains the Empowered player's choice. */
export function FormatMenuStage({player, offeredFormatIds}: {player:FormatPresentationRosterPlayer; offeredFormatIds:readonly [LaunchFormatId,LaunchFormatId]}) {
  const [missing, setMissing] = useState<string|null>(null);
  const body=player.fullBodyReferenceUrl && player.fullBodyReferenceUrl!==missing ? player.fullBodyReferenceUrl : null;
  return <section data-format-cue="format_menu" data-format-menu-stage className={styles.stage}>
    <div className={styles.layout}>
      <figure className={styles.player} aria-label={`Empowered: ${player.name}`}>
        {body && <div className={styles.art} data-format-menu-fullbody>
          {/* eslint-disable-next-line @next/next/no-img-element -- match-frozen character artwork */}
          <img src={body} alt={player.name} onError={event=>void characterImageError(event,()=>setMissing(body))} />
        </div>}
        <div className={body ? styles.portraitFallback : undefined}><AgentAvatar name={player.name} persona={player.persona ?? ""} personaKey={player.personaKey} avatarUrl={player.avatarUrl} size="12" /></div>
        <figcaption><p className={styles.status}>Empowered</p><p className={styles.name}>{player.name}</p></figcaption>
      </figure>
      <div className={styles.offer}>
        <header><h2>The House offers two formats</h2><p>{player.name} chooses the round format.</p></header>
        <div className={styles.cards} role="group" aria-label="House format offer">
          {offeredFormatIds.map(id=><article key={id} data-format-card={id} data-card-state="offered"><h3>{formatPresentationMetadata(id).displayName}</h3></article>)}
        </div>
      </div>
    </div>
  </section>;
}
