import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
export function GameCard({title,href,status,statusLabel,eyebrow,description,meta,artwork,actions,onOpen,...article}: {
 title:string;href:string;status:string;statusLabel:string;eyebrow:string;description:string;meta:ReactNode;artwork:ReactNode;actions:ReactNode;
 onOpen?:ComponentProps<typeof Link>["onClick"];
} & Omit<ComponentProps<"article">,"title"|"children">) {
 return <article {...article} className={`episode-card ${article.className ?? ""}`}>
  <Link className="episode-card-link" aria-label={`Open ${title}`} href={href} onClick={onOpen}>{artwork}
   <span className={`episode-status episode-status-${status}`}>{statusLabel}</span>
   <div className="episode-copy"><div className="episode-eyebrow">{eyebrow}</div><h2>{title}</h2><p>{description}</p><span className="episode-meta">{meta}</span></div>
  </Link><div className="episode-desktop-actions">{actions}</div>
 </article>;
}
