import Image from "next/image";
import type { ReactNode } from "react";
export function CastingRoster({ eyebrow, description, empty, children, invitation }: {eyebrow:string;description:string;empty?:ReactNode;children:ReactNode;invitation?:ReactNode}) {
  return <section className="pre-show-cast" aria-label="Meet the cast"><header className="pre-show-cast-heading"><div><p className="pre-show-eyebrow">{eyebrow}</p><h2>Meet the cast.</h2></div><p>{description}</p></header>
    {empty ?? <div className="pre-show-cast-grid">{children}{invitation}</div>}
  </section>;
}
export function CastCard({name,src,index,eyebrow,detail,onInspect,action}: {name:string;src:string;index:number;eyebrow:string;detail:ReactNode;onInspect?:()=>void;action?:ReactNode}) {
  const content = <><Image className="pre-show-cast-image" src={src} alt={`Portrait of ${name}`} fill sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 240px" unoptimized />
    <span className="pre-show-cast-number" aria-hidden="true">{String(index+1).padStart(2,"0")}</span>
    <span className="pre-show-cast-copy"><span>{eyebrow}</span><strong>{name}</strong><span className="pre-show-cast-record">{detail}</span></span></>;
  return <article className="pre-show-cast-card">{onInspect ? <button type="button" className="absolute inset-0 text-left" aria-label={`Meet ${name}`} onClick={onInspect}>{content}</button> : content}{action}</article>;
}
export function CastInvitation({disabled,onChoose,joined}: {disabled:boolean;onChoose:()=>void;joined:boolean}) {
  return <button type="button" className="pre-show-invitation" disabled={disabled} onClick={onChoose}><span aria-hidden="true">＋</span><strong>Your agent,<br /><em>in the spotlight.</em></strong><span>{joined ? "Add another agent" : "Choose your agent"} ↗</span></button>;
}
