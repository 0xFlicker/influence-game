"use client";
import Link from "next/link";
import type {WerewolfAudience} from "@influence/engine/werewolf/observation";
import {gameReplayHref} from "@/lib/game-links";
import styles from "./werewolf-watch-choices.module.css";

type Props = {slug:string;onWatch?:never;className?:string} | {slug?:never;onWatch:(audience:WerewolfAudience)=>void;className?:string};
const modes = ["mystery", "omniscient"] as const;
const label = (mode:WerewolfAudience) => mode === "mystery" ? "Mystery" : "Omniscient";

/** Both audiences are equal actions; container width determines their labels. */
export function WerewolfWatchChoices({slug,onWatch,className}:Props) {
  const action = (mode:WerewolfAudience, full:boolean) => {
    const content = <span><span className={full ? styles.prefix : styles.noPrefix}>Watch </span>{label(mode)}</span>;
    const props = {className:`${styles.action} ${className ?? ""}`, "aria-label":`Watch ${label(mode)}`};
    return slug ? <Link key={mode} {...props} href={gameReplayHref(slug,undefined,mode)}>{content}</Link>
      : <button key={mode} type="button" {...props} onClick={() => onWatch!(mode)}>{content}</button>;
  };
  return <div className={styles.container}>
    <div className={styles.pair}>{modes.map(mode => action(mode,true))}</div>
    <details className={styles.menu} onKeyDown={event => {if (event.key === "Escape") {event.currentTarget.open = false;event.currentTarget.querySelector("summary")?.focus();event.stopPropagation();}}}>
      <summary className={`${styles.action} ${className ?? ""}`}>Watch ▾</summary>
      <div className={styles.menuItems}>{modes.map(mode => action(mode,false))}</div>
    </details>
  </div>;
}
