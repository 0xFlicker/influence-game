"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { WerewolfEvent, WerewolfObservation, WerewolfOutcome } from "@influence/engine/werewolf";
import { werewolfMomentHref } from "@/lib/game-links";

type Action = Extract<WerewolfEvent, { type: "werewolf.action_accepted" }>["payload"];
interface WerewolfFacts {
  gameKind: "werewolf";
  game: { id: string; slug: string };
  reviewedPlayer: { role: string; faction: string; won: boolean; survived: boolean; readableSummary: string };
  werewolf: {
    laterOutcome: WerewolfOutcome;
    cast: Array<{ id: string; name: string }>;
    missingThinkingCount: number;
    decisions: Array<{ sequence: number; day: number; phase: string; cursor: number; action: Action; thinking: string | null; knownAtDecision: WerewolfObservation }>;
  };
}

/** The API owns validation; the discriminator keeps Influence evidence in its own renderer. */
export function werewolfLearningFacts(value: unknown): WerewolfFacts | null {
  return value !== null && typeof value === "object" && "gameKind" in value && value.gameKind === "werewolf"
    ? value as WerewolfFacts : null;
}

export function WerewolfLearningFacts({ facts }: { facts: WerewolfFacts }) {
  useEffect(() => {
    function openSource() {
      const target = document.getElementById(window.location.hash.slice(1));
      if (!target || !target.closest(`[id="facts-${facts.game.id}"]`)) return;
      let parent: HTMLElement | null = target;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target.scrollIntoView({ block: "center" });
    }
    openSource();
    window.addEventListener("hashchange", openSource);
    return () => window.removeEventListener("hashchange", openSource);
  }, [facts.game.id]);
  const name = (id: string) => facts.werewolf.cast.find(player => player.id === id)?.name ?? id;
  return <section id={`facts-${facts.game.id}`} className="olm-section" aria-label="Werewolf game evidence">
    <h2 className="text-xl font-semibold">{facts.game.slug}</h2>
    <p className="mt-2">{facts.reviewedPlayer.readableSummary}</p>
    <p className="mt-2 text-sm text-white/65">{facts.reviewedPlayer.survived ? "Survived" : "Eliminated"} · Survival and faction outcome are recorded separately from decision quality.</p>
    <p className="my-4 text-sm text-white/65">{facts.werewolf.decisions.length} recorded decisions · {facts.werewolf.missingThinkingCount} without recorded thinking</p>
    <details><summary className="cursor-pointer py-3 font-semibold">Inspect decisions and their context</summary>
    <div className="space-y-3">{facts.werewolf.decisions.map(turn => {
      const observation = turn.knownAtDecision;
      const decision = turn.action.decision;
      const target = "targetId" in decision ? decision.targetId : null;
      const dialogue = observation.board.entries.filter(entry => entry.kind === "speech" || entry.kind === "discussion");
      return <details id={`decision-${facts.game.id}-${turn.sequence}`} key={turn.sequence} className="rounded-xl border border-white/15 p-4">
        <summary className="cursor-pointer">Day {turn.day} · {actionLabel(turn.action.action)}{turn.action.fallback ? " · Unavailable decision" : target ? ` · ${name(target)}` : turn.action.action === "vote" ? " · Hear more" : ""}</summary>
        <div className="mt-4 space-y-4 text-sm leading-6">
          <div><h3 className="font-semibold">What happened</h3><p>{turn.action.fallback ? "The provider did not supply an accepted decision. The game used its legal fallback." : "text" in decision ? decision.text ?? "Passed" : target ? `Chose ${name(target)}.` : "No target selected."}</p></div>
          <div><h3 className="font-semibold">What they knew</h3><p>Role: {observation.self.role} · {observation.board.players.filter(player => player.alive).length} players alive</p>
            {observation.packIds.length > 0 && <p>Pack: {observation.packIds.map(name).join(", ")}</p>}
            {observation.investigations.map(item => <p key={`${item.day}:${item.targetId}`}>Night {item.day}: {name(item.targetId)} was {item.isWolf ? "a wolf" : "not a wolf"}.</p>)}
            {observation.previousProtection && <p>Previous protection: {name(observation.previousProtection)}</p>}
            <p>Legal targets: {turn.action.legalTargetIds.map(name).join(", ") || "None"}</p>
          </div>
          <div><h3 className="font-semibold">Recorded thinking</h3><p className="text-slate-300">{turn.thinking ?? "Not captured for this decision."}</p></div>
          <details><summary className="cursor-pointer">Starting strategy</summary><p className="mt-2 whitespace-pre-wrap">{observation.self.strategy}</p></details>
          <details><summary className="cursor-pointer">Conversation available before this choice</summary>
            {dialogue.length > 12 && <p className="text-white/50">Showing the last 12 of {dialogue.length} public contributions.</p>}
            {dialogue.slice(-12).map((entry, index) => {
              if (entry.kind === "speech") return <p key={index}><strong>{name(entry.actorId)}:</strong> {entry.text ?? "Passed"}</p>;
              if (entry.kind === "discussion") return <p key={index}><strong>{name(entry.contribution.actorId)}:</strong> {entry.contribution.text ?? "Passed"}</p>;
              return null;
            })}
            {observation.packDiscussion.length > 0 && <><h4 className="mt-3 font-semibold">Private pack conversation</h4>{observation.packDiscussion.map((entry, index) => <p key={index}><strong>{name(entry.actorId)}:</strong> {entry.text ?? "Passed"}</p>)}</>}
          </details>
          <Link className="underline" href={werewolfMomentHref(facts.game.slug, "omniscient", turn.cursor)}>Watch around this choice · Omniscient ↗</Link>
        </div>
      </details>;
    })}</div></details>
  </section>;
}

function actionLabel(action: Action["action"]): string {
  const labels: Record<Action["action"], string> = { introduce: "Introduction", pack_talk: "Pack discussion", attack: "Night target", protect: "Doctor protection", investigate: "Seer investigation", open_thread: "Opened a thread", discuss: "Discussion", vote: "Day vote" };
  return labels[action];
}
