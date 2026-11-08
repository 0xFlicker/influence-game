import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { SEASON_ONE_HREF } from "./season-one-entry";
import s from "./campaign.module.css";

export function CampaignShell({
  children,
  ai = false,
}: {
  children: ReactNode;
  ai?: boolean;
}) {
  return (
    <div className={s.page}>
      <nav className={s.nav} aria-label="Campaign navigation">
        <Link href="/" className={s.wordmark} aria-label="The House home">
          THE HOUSE
        </Link>
        <div className={s.navside}>
          <Link href={ai ? "/get-mcp" : "/sign-in"}>
            {ai ? "MCP guide" : "Sign in"}
          </Link>
          <Link href={SEASON_ONE_HREF}>Season 1</Link>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
export function Portrait({
  name,
  priority = false,
}: {
  name: "marlow" | "marnie" | "veyra";
  priority?: boolean;
}) {
  const people = {
    marlow: ["marlow-reed", "Marlow Reed, a crocodile in a worn brown jacket"],
    marnie: [
      "marnie-hartwell",
      "Marnie Hartwell in a black suit with teal lapels",
    ],
    veyra: ["veyra-solvane", "Veyra Solvane, a winged fantasy character"],
  };
  const [file, alt] = people[name];
  return (
    <Image
      src={`/home/${file}-portrait.webp`}
      alt={alt}
      width={512}
      height={512}
      sizes="(max-width: 700px) 85vw, 400px"
      priority={priority}
    />
  );
}
export function CampaignFaq({ items }: { items: [string, string][] }) {
  return (
    <div className={s.faq}>
      {items.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
export function CampaignStrip({ items }: { items: [string, string?][] }) {
  return (
    <div className={s.strip}>
      {items.map(([title, detail]) => (
        <div key={title}>
          <strong>{title}</strong>
          {detail && <span>{detail}</span>}
        </div>
      ))}
    </div>
  );
}
