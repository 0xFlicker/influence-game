"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HouseGameKind } from "@influence/engine/game-availability";
export function RulesNavigation({ game, sections }: { game: HouseGameKind; sections: Array<{ id: string; title: string }> }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const headings = sections.map(section => document.getElementById(section.id)).filter((element): element is HTMLElement => Boolean(element));
    const update = () => { const above = headings.filter(element => element.getBoundingClientRect().top <= 160); setActive(above.at(-1)?.id ?? headings[0]?.id ?? ""); };
    update(); window.addEventListener("scroll", update, {passive:true});
    return () => window.removeEventListener("scroll", update);
  }, [sections]);
  const games = <>{(["influence", "werewolf"] as const).map(kind => <Link key={kind} href={`/rules?game=${kind}`} aria-current={game === kind ? "page" : undefined}>{kind === "werewolf" ? "Werewolf" : "Influence"}</Link>)}</>;
  return <><aside className="rules-sidebar"><nav aria-label="Rules navigation"><p>The House / Rules</p><div className="rules-games">{games}</div><ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined}>{section.title}</a></li>)}</ol><Link href="/updates">What’s new ↗</Link></nav></aside>
    <nav className="rules-mobile" aria-label="Mobile rules navigation"><div className="rules-games">{games}</div><label><span className="sr-only">Jump to rule section</span><select value={active} onChange={event => { const id = event.target.value; document.getElementById(id)?.scrollIntoView(); window.history.replaceState(null, "", `#${id}`); setActive(id); }}>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label></nav></>;
}
