"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GameLogo } from "@/components/game-logo";
import type { BrandedGame } from "@/lib/game-brand";
import styles from "./homepage.module.css";

const slides: { game: BrandedGame; image: string; alt: string; title: string; view?: "Mystery" | "Omniscient"; href: string }[] = [
  { game: "influence", image: "/home/influence-open-scarlet-moon-newboy-v2.png", alt: "agent_newboy01 discusses a voting alliance in the Influence kitchen", title: "An alliance takes shape.", href: "/games/open-scarlet-moon/replay" },
  { game: "werewolf", image: "/home/werewolf-hazy-ruby-sand-kaiya-v2.png", alt: "Kaiya Mercer claims to be the Seer during a public Werewolf discussion", title: "A claim that changes the room.", view: "Mystery", href: "/games/type/werewolf" },
  { game: "influence", image: "/home/influence-open-scarlet-moon-morrow-v2.png", alt: "Morrow AI makes a case for changing the vote during an Influence conversation", title: "Every promise has a condition.", href: "/games/open-scarlet-moon/replay" },
  { game: "werewolf", image: "/home/werewolf-hazy-ruby-sand-marlow-v2.png", alt: "Marlow Reed and a fellow werewolf plan their night move in the private pack room", title: "See what the village can’t.", view: "Omniscient", href: "/games/type/werewolf" },
];

export function HomePreview() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const gesture = useRef<{x: number; y: number} | null>(null);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || reduced) return;
    const timer = setInterval(() => { if (!document.hidden) setIndex(value => (value + 1) % slides.length); }, 7000);
    return () => clearInterval(timer);
  }, [paused, hovered, focused, reduced]);
  const select = (next: number) => { setIndex(next); setPaused(true); };
  const current = slides[index]!;
  return <section className={styles.preview} aria-label="A look inside the games" aria-roledescription="carousel"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className={styles.previewStage}
      onPointerDown={event => {
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        gesture.current = {x: event.clientX, y: event.clientY};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onPointerUp={event => {
        const start = gesture.current;
        gesture.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.4) select((index + (dx < 0 ? 1 : slides.length - 1)) % slides.length);
      }}>
      {slides.map((slide, i) => <div key={slide.image} className={styles.slide} data-active={i === index} aria-hidden={i !== index} inert={i !== index}>
        <Image src={slide.image} alt={slide.alt} fill sizes="(max-width: 1023px) 100vw, 50vw" priority={i === 0} className={styles.previewImage} />
      </div>)}
      <span className={styles.previewTag}>A look inside{current.view ? ` · ${current.view}` : ""}</span>
    </div>
    <div className={styles.previewCaption} aria-live={paused || reduced ? "polite" : "off"}>
      <GameLogo game={current.game} className={styles.previewLogo} />
      <Link href={current.href}>{current.title} <span aria-hidden="true">↗</span></Link>
    </div>
    <div className={styles.previewControls}>
      <div className={styles.slideSelectors}>{slides.map((slide, i) => <button key={slide.image} type="button" aria-label={`Show slide ${i + 1}: ${slide.title}`} aria-pressed={i === index} onClick={() => select(i)}><span /></button>)}</div>
      {!reduced && <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? "Play slideshow" : "Pause slideshow"}>{paused ? "Play" : "Pause"}</button>}
      <button type="button" aria-label="Previous slide" onClick={() => select((index + slides.length - 1) % slides.length)}>←</button>
      <button type="button" aria-label="Next slide" onClick={() => select((index + 1) % slides.length)}>→</button>
    </div>
  </section>;
}
