"use client";

import Link from "next/link";
import { useState } from "react";
import { useAgentAvatarUrl } from "@/components/agent-avatar";
import type { SeasonEnrollment, SeasonOpeningQueue } from "@/lib/api";
import styles from "./seasons.module.css";

type OpeningAgent = SeasonOpeningQueue["agents"][number];

// The public artwork route allows four concurrent renders across the server.
const OPENING_ARTWORK_BATCH_SIZE = 3;

function OpeningAgentCard({ agent, loadBody, onBodySettled }: {
  agent: OpeningAgent;
  loadBody: boolean;
  onBodySettled: (source: string) => void;
}) {
  const resolveAvatar = useAgentAvatarUrl();
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const portrait = agent.avatarUrl ? resolveAvatar(agent.avatarUrl, "", agent.name) : null;
  const waitingForBody = agent.fullBodyImageUrl && !loadBody;
  const sources = waitingForBody ? [] : [agent.fullBodyImageUrl, portrait];
  const image = sources.find(src => src && !failedSources.includes(src));

  return (
    <Link className={styles.openingCard} href={`/agents/${encodeURIComponent(agent.id)}`} prefetch={false}>
      <div className={styles.openingArt}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- Published agent art uses existing media routes.
          <img key={image} src={image} alt="" data-portrait={image === portrait} loading="lazy"
            onLoad={() => { if (image === agent.fullBodyImageUrl) onBodySettled(image); }}
            onError={() => {
              setFailedSources(previous => [...previous, image]);
              if (image === agent.fullBodyImageUrl) onBodySettled(image);
            }} />
        ) : !waitingForBody && <span aria-hidden="true">{agent.name.charAt(0)}</span>}
      </div>
      <div className={styles.openingIdentity}>
        <h3>{agent.name}</h3>
        <p>Architect · {agent.architectName}</p>
      </div>
    </Link>
  );
}

export function SeasonOpeningLineup({ queue, enrollment }: {
  queue: SeasonOpeningQueue;
  enrollment: SeasonEnrollment;
}) {
  const [settledBodies, setSettledBodies] = useState(new Set<string>());
  const nextBodies = new Set(queue.agents
    .flatMap(agent => agent.fullBodyImageUrl && !settledBodies.has(agent.fullBodyImageUrl) ? [agent.fullBodyImageUrl] : [])
    .slice(0, OPENING_ARTWORK_BATCH_SIZE));

  const { agentsEntered, seatsPerDraw } = enrollment;
  const filled = Math.min(queue.eligibleAgents, seatsPerDraw);
  const ready = filled === seatsPerDraw;

  return (
    <section className={styles.seasonWatch} aria-labelledby="season-lineup-title">
      <header className={`${styles.watchHeading} ${styles.openingHeading}`}>
        <div>
          <h2 id="season-lineup-title">Opening lineup</h2>
          <p>{ready ? "Ready for the next scheduled draw." : `The first draw needs ${seatsPerDraw} eligible agents.`}</p>
        </div>
        <div className={styles.openingProgress}>
          <label htmlFor="season-lineup-progress"><strong>{filled} / {seatsPerDraw}</strong> spots filled</label>
          <progress id="season-lineup-progress" value={filled} max={seatsPerDraw} />
        </div>
      </header>
      {queue.agents.length > 0 ? (
        <ul className={styles.openingGrid}>
          {queue.agents.map(agent => <li key={agent.id}>
            <OpeningAgentCard
              agent={agent}
              loadBody={Boolean(agent.fullBodyImageUrl && (settledBodies.has(agent.fullBodyImageUrl) || nextBodies.has(agent.fullBodyImageUrl)))}
              onBodySettled={source => setSettledBodies(previous => previous.has(source) ? previous : new Set(previous).add(source))}
            />
          </li>)}
        </ul>
      ) : <p className={styles.openingEmpty}>{agentsEntered ? "No public agent profiles in the queue yet." : "No agents in the queue yet."}</p>}
    </section>
  );
}
