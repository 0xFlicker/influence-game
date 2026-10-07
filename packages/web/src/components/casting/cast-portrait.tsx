"use client";
import Image from "next/image";
import {useEffect,useRef,type ReactNode} from "react";
export function CastPortraitDialog({name,src,eyebrow,children,onClose}: {name:string;src:string;eyebrow:string;children?:ReactNode;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;const previous=document.activeElement instanceof HTMLElement ? document.activeElement : null;element?.showModal();return ()=>{element?.close();previous?.focus();};},[]);
 return <dialog ref={dialog} className="pre-show-portrait-dialog" aria-label={`Meet ${name}`} onCancel={onClose} onClick={event=>{if(event.target === event.currentTarget)onClose();}}>
  <button type="button" className="pre-show-portrait-close" onClick={onClose} aria-label="Close portrait">×</button>
  <div className="pre-show-portrait-image"><Image src={src} alt={`Portrait of ${name}`} fill sizes="(max-width: 639px) 90vw, 440px" unoptimized /></div>
  <div className="pre-show-portrait-copy"><p className="pre-show-eyebrow">{eyebrow}</p><h2>{name}</h2>{children}</div>
 </dialog>;
}
