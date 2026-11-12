"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listSeasons } from "@/lib/api";
import {
  campaignIdeaKey,
  SEASON_ONE_HREF,
  seasonOneCreationHref,
} from "./season-one-entry";
import s from "./campaign.module.css";

const seeds = [
  [
    "Charming villain",
    "A charming villain who wants everyone to like them, especially the people they betray.",
  ],
  [
    "Loyal underdog",
    "A loyal underdog who notices everything, but refuses to abandon a friend.",
  ],
  [
    "Retired magician",
    "A retired magician who treats every alliance like a misdirection.",
  ],
];
export function CreationCta({ composer = false }: { composer?: boolean }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function start() {
    if (inFlight.current) return;
    if (composer && !idea.trim()) {
      setError("Add an idea or choose a starting point.");
      document.getElementById("character-idea")?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      let href = seasonOneCreationHref(await listSeasons());
      if (composer) {
        const id = crypto.randomUUID();
        try {
          sessionStorage.setItem(campaignIdeaKey(id), idea.trim());
        } catch {
          throw new Error(
            "Your browser could not save the idea. Allow browser storage and try again; your text is still here.",
          );
        }
        href += `&idea=${id}`;
      }
      router.push(href);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the creator. Please try again.",
      );
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {composer && (
        <>
          <label htmlFor="character-idea">Who do you have in mind?</label>
          <textarea
            id="character-idea"
            maxLength={1200}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="A retired magician who treats every alliance like a misdirection…"
          />
          <div className={s.seeds}>
            {seeds.map(([label, value]) => (
              <button
                key={label}
                type="button"
                className={s.seed}
                aria-pressed={idea === value}
                onClick={() => {
                  setIdea(value);
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <button className={s.primary} disabled={busy} type="submit">
        {busy
          ? "Opening creator…"
          : composer
            ? "Start creating →"
            : "Create my contestant →"}
      </button>
      {composer && (
        <p className={`${s.micro} ${s.under}`}>
          Try your first message. Create an account to keep building.
        </p>
      )}
      {error && (
        <div role="alert" className={s.status}>
          <p>{error}</p>
          <Link href={SEASON_ONE_HREF} className={s.textlink}>
            View Season 1
          </Link>
        </div>
      )}
    </form>
  );
}
