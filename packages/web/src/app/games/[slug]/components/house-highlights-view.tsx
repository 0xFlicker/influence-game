import Link from "next/link";
import type { HouseHighlightsResponse } from "@/lib/api";
import { completedGameModeHref } from "@/lib/game-links";
import {
  buildHouseHighlightsViewModel,
  type HouseHighlightsSceneModel,
} from "./house-highlights-model";

export function HouseHighlightsView({
  response,
  gameSlug,
}: {
  response: HouseHighlightsResponse;
  gameSlug: string;
}) {
  const model = buildHouseHighlightsViewModel(response, gameSlug);

  return (
    <section className="space-y-8" data-testid="house-highlights-view">
      <header className="relative overflow-hidden rounded-lg border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(239,68,68,0.16),rgba(255,255,255,0.06)_38%,rgba(34,211,238,0.12))]" />
        <div className="relative max-w-3xl">
          <div className="inline-flex rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase text-white/60">
            {model.badge}
          </div>
          <h1 className="mt-5 max-w-4xl text-3xl font-semibold leading-tight text-white sm:text-5xl">
            {model.title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/58">
            {model.subtitle}
          </p>
        </div>
      </header>

      {model.showNoCutState ? (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5" data-testid="house-highlights-no-cut">
          <div className="text-xs font-semibold uppercase text-white/35">Editorial decision</div>
          <h2 className="mt-2 text-xl font-semibold text-white">{model.noCutTitle}</h2>
          {model.noCutMessage ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{model.noCutMessage}</p>
          ) : null}
          <ProofLinks links={model.fallbackLinks} />
        </section>
      ) : (
        <section className="grid gap-4" data-testid="house-highlights-scenes">
          {model.scenes.map((scene, index) => (
            <SceneCard key={scene.id} scene={scene} index={index} />
          ))}
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        {!model.showNoCutState ? (
          <p className="max-w-2xl text-sm leading-6 text-white/45">
            {model.shareCaption}
          </p>
        ) : <span />}
        <div className="flex flex-wrap gap-2">
          <Link
            href={completedGameModeHref(gameSlug, "results")}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
          >
            Results
          </Link>
          <Link
            href={completedGameModeHref(gameSlug, "replay")}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
          >
            Replay
          </Link>
        </div>
      </footer>
    </section>
  );
}

function SceneCard({
  scene,
  index,
}: {
  scene: HouseHighlightsSceneModel;
  index: number;
}) {
  return (
    <article className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:p-5">
      <div className="min-h-48 rounded-md border border-white/10 bg-black/30 p-4">
        <div className="text-xs font-semibold uppercase text-white/30">
          Scene {index + 1}
        </div>
        <h2 className="mt-3 text-2xl font-semibold leading-tight text-white">
          {scene.title}
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs ${scene.categoryTone}`}>
            {scene.categoryLabel}
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-white/65">{scene.hook}</p>
        <p className="mt-4 text-xs leading-5 text-white/35">{scene.posterDirection}</p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase text-white/30">Involved</div>
          <div className="mt-1 text-sm text-white/72">{scene.agentsLabel}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SceneBeat label="Setup" value={scene.setup} />
          <SceneBeat label="Conflict" value={scene.conflict} />
          <SceneBeat label="Payoff" value={scene.payoff} />
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-white/30">
            Receipts
          </div>
          <div className="mt-1 text-sm text-white/65">{scene.receiptSummary}</div>
          <div className="mt-3 grid gap-2">
            {scene.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-md border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white/80">{receipt.label}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/45">
                    {receipt.tierLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/45">{receipt.description}</p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href={scene.proofLink.href}
          className="inline-flex rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition-colors hover:bg-cyan-500/15"
        >
          {scene.proofLink.label}
        </Link>
      </div>
    </article>
  );
}

function SceneBeat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] font-semibold uppercase text-white/30">{label}</div>
      <p className="mt-1 text-xs leading-5 text-white/58">{value}</p>
    </div>
  );
}

function ProofLinks({
  links,
}: {
  links: Array<{ label: string; href: string; surface: "results" | "replay" }>;
}) {
  if (links.length === 0) return null;
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={`${link.surface}:${link.href}`}
          href={link.href}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
