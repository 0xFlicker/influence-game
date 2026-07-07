import Image from "next/image";
import { resolveApiUrl } from "@/lib/api";
import { houseHighlightBackdropClass } from "./house-highlights-backgrounds";
import type { HouseHighlightsSceneModel } from "./house-highlights-model";

export function HouseHighlightCard({
  scene,
  index,
}: {
  scene: HouseHighlightsSceneModel;
  index: number;
}) {
  const card = scene.visualCard;
  const primaryAgent = card.primaryAgents[0];
  const secondaryAgent = card.secondaryAgents[0];

  return (
    <section
      aria-label={card.altText}
      className={`relative isolate min-h-[520px] overflow-hidden rounded-lg border border-white/10 md:aspect-[1200/630] md:min-h-0 ${houseHighlightBackdropClass(card.backdropCategory)}`}
      data-testid="house-highlight-visual-card"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.76),rgba(0,0,0,0.34)_55%,rgba(0,0,0,0.7))]" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/30" />
      <div className="relative flex h-full flex-col justify-between p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-normal text-white/52">
              Scene {index + 1}
            </div>
            <div className="mt-2 inline-flex rounded-full border border-white/14 bg-black/28 px-2.5 py-1 text-[11px] font-semibold text-white/70">
              {card.eyebrow}
            </div>
          </div>
          {card.roundLabel ? (
            <div className="rounded-md border border-white/12 bg-black/28 px-3 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase text-white/38">Round</div>
              <div className="text-sm font-semibold text-white">{card.roundLabel}</div>
            </div>
          ) : null}
        </div>

        <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.48fr)]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              {primaryAgent ? <AgentBadge agent={primaryAgent} emphasis="primary" /> : null}
              {secondaryAgent ? <AgentBadge agent={secondaryAgent} emphasis="secondary" /> : null}
            </div>
            <h2 className="max-w-3xl text-balance text-3xl font-semibold leading-[1.05] text-white sm:text-4xl lg:text-5xl">
              {card.title}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
              {card.outcome}
            </p>
          </div>

          <div className="grid gap-2">
            {card.factLines.slice(0, 3).map((fact) => (
              <div
                key={fact.id}
                className="rounded-md border border-white/12 bg-black/32 px-3 py-2 text-sm leading-5 text-white/82"
              >
                {fact.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentBadge({
  agent,
  emphasis,
}: {
  agent: { id: string; name: string; initials: string; avatarUrl: string | null };
  emphasis: "primary" | "secondary";
}) {
  const tone =
    emphasis === "primary"
      ? "border-cyan-200/26 bg-cyan-400/12 text-cyan-50"
      : "border-rose-200/24 bg-rose-400/12 text-rose-50";

  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1.5 ${tone}`}>
      {agent.avatarUrl ? (
        <Image
          src={resolveHighlightAvatarUrl(agent.avatarUrl)}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full border border-white/18 object-cover"
          unoptimized
        />
      ) : (
        <div className="grid size-7 shrink-0 place-items-center rounded-full border border-white/18 bg-black/32 text-[11px] font-semibold">
          {agent.initials}
        </div>
      )}
      <div className="min-w-0 truncate text-sm font-semibold">{agent.name}</div>
    </div>
  );
}

function resolveHighlightAvatarUrl(avatarUrl: string): string {
  return avatarUrl.startsWith("/api/") ? resolveApiUrl(avatarUrl) : avatarUrl;
}
