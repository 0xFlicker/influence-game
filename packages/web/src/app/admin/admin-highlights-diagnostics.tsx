"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAdminPostgameHighlightsDiagnostics,
  type AdminGameSummary,
  type AdminHouseHighlightSceneCard,
  type AdminHouseHighlightVisualBrief,
  type AdminHouseHighlightsDiagnosticsResponse,
  type HouseHighlightCategory,
  type HouseHighlightDeepLink,
  type HouseHighlightReceipt,
  type HouseHighlightsCandidateDiagnostic,
} from "@/lib/api";

function formatSnake(value: string | null | undefined): string {
  if (!value) return "None";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function categoryTone(category: HouseHighlightCategory): string {
  const tones: Partial<Record<HouseHighlightCategory, string>> = {
    betrayal: "border-red-400/30 bg-red-500/10 text-red-100",
    triumph: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
    chaos: "border-violet-400/30 bg-violet-500/10 text-violet-100",
    suspense: "border-amber-400/30 bg-amber-500/10 text-amber-100",
    revenge: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100",
    jury_judgment: "border-cyan-400/30 bg-cyan-500/10 text-cyan-100",
    unlikely_survival: "border-lime-400/30 bg-lime-500/10 text-lime-100",
  };
  return tones[category] ?? "border-white/15 bg-white/[0.05] text-white/70";
}

function evidenceHref(gameKey: string, link: HouseHighlightDeepLink): string {
  const base = `/games/${encodeURIComponent(gameKey)}/${link.surface}`;
  return link.anchor ? `${base}#${link.anchor}` : base;
}

function receiptSummary(receipts: readonly HouseHighlightReceipt[]): string {
  const tiers = [...new Set(receipts.map((receipt) => formatSnake(receipt.tier)))];
  return tiers.length > 0 ? tiers.join(" + ") : "No receipts";
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function CandidateMeta({
  candidate,
}: {
  candidate?: HouseHighlightsCandidateDiagnostic;
}) {
  if (!candidate) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/45">
      <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
        {candidate.source}
      </span>
      <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
        score {candidate.score}
      </span>
      <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
        selection confidence: {candidate.confidence}
      </span>
      <span className="rounded border border-cyan-300/20 bg-cyan-500/10 px-2 py-0.5 text-cyan-100">
        visual: {formatSnake(candidate.visualBrief.visualType)}
      </span>
      {candidate.reasons.map((reason) => (
        <span key={reason} className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5">
          {reason}
        </span>
      ))}
    </div>
  );
}

function SelectedSceneCard({
  scene,
  candidate,
  gameKey,
}: {
  scene: AdminHouseHighlightSceneCard;
  candidate?: HouseHighlightsCandidateDiagnostic;
  gameKey: string;
}) {
  return (
    <article className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${categoryTone(scene.category)}`}>
              {formatSnake(scene.category)}
            </span>
            <span className="text-[11px] text-white/35">{receiptSummary(scene.receipts)}</span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-white">{scene.title}</h3>
          <p className="mt-1 text-xs leading-5 text-white/50">{scene.houseHook}</p>
        </div>
        <a
          href={evidenceHref(gameKey, scene.deepLink)}
          className="rounded-md border border-cyan-300/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/15"
        >
          {scene.deepLink.label}
        </a>
      </div>
      <CandidateMeta candidate={candidate} />
      <VisualDiagnostics visualBrief={scene.visualBrief} />
    </article>
  );
}

function VisualDiagnostics({
  visualBrief,
}: {
  visualBrief: AdminHouseHighlightVisualBrief;
}) {
  return (
    <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-950/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100">
          {visualBrief.templateLabel}
        </span>
        <span className="text-[11px] text-white/40">
          backdrop: {formatSnake(visualBrief.backdrop.category)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visualBrief.factualSlots.map((slot) => (
          <span
            key={`${slot.key}:${slot.label}`}
            className={`rounded border px-2 py-0.5 text-[11px] ${
              slot.status === "filled"
                ? "border-emerald-300/20 bg-emerald-500/10 text-emerald-100"
                : "border-amber-300/20 bg-amber-500/10 text-amber-100"
            }`}
          >
            {slot.label}: {slot.status}
          </span>
        ))}
      </div>
      {visualBrief.diagnostics.forbiddenInventions.length > 0 ? (
        <div className="mt-2 text-[11px] leading-5 text-white/40">
          Forbidden: {visualBrief.diagnostics.forbiddenInventions.join(" ")}
        </div>
      ) : null}
      {visualBrief.diagnostics.rejectedBackdropCategories.length > 0 ? (
        <div className="mt-2 text-[11px] leading-5 text-amber-100/70">
          Rejected backdrop categories: {visualBrief.diagnostics.rejectedBackdropCategories.map(formatSnake).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function CandidateTable({
  candidates,
}: {
  candidates: readonly HouseHighlightsCandidateDiagnostic[];
}) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-md border border-white/10 p-4 text-sm text-white/35">
        No rejected or unused candidates.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-white/10">
      <table className="min-w-[44rem] w-full text-sm">
        <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-white/35">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Candidate</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-left font-medium">Visual</th>
            <th className="px-3 py-2 text-left font-medium">Source</th>
            <th className="px-3 py-2 text-right font-medium">Score</th>
            <th className="px-3 py-2 text-left font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={`${candidate.id}:${candidate.reasons.join("|")}`} className="border-t border-white/5">
              <td className="max-w-[16rem] px-3 py-2 text-white/75">
                <div className="truncate">{candidate.title}</div>
                <div className="truncate text-[11px] text-white/30">{candidate.id}</div>
              </td>
              <td className="px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${categoryTone(candidate.category)}`}>
                  {formatSnake(candidate.category)}
                </span>
              </td>
              <td className="max-w-[12rem] px-3 py-2 text-cyan-100/70">
                <div className="truncate">{formatSnake(candidate.visualBrief.visualType)}</div>
                {candidate.visualBrief.diagnostics.rejectedBackdropCategories.length > 0 ? (
                  <div className="mt-1 text-[11px] leading-4 text-amber-100/70">
                    Rejected backdrop: {candidate.visualBrief.diagnostics.rejectedBackdropCategories.map(formatSnake).join(", ")}
                  </div>
                ) : null}
                {candidate.visualBrief.factualSlots.some((slot) => slot.status === "missing") ? (
                  <div className="mt-1 text-[11px] leading-4 text-amber-100/70">
                    Missing slot: {candidate.visualBrief.factualSlots.filter((slot) => slot.status === "missing").map((slot) => slot.label).join(", ")}
                  </div>
                ) : null}
              </td>
              <td className="max-w-[11rem] truncate px-3 py-2 text-white/45">{candidate.source}</td>
              <td className="px-3 py-2 text-right text-white/60">{candidate.score}</td>
              <td className="max-w-[16rem] px-3 py-2 text-white/45">{candidate.reasons.join(", ") || "not_in_final_edit"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptInspector({
  scenes,
}: {
  scenes: readonly AdminHouseHighlightSceneCard[];
}) {
  if (scenes.length === 0) return null;
  return (
    <div className="space-y-2">
      {scenes.map((scene) => (
        <details key={scene.id} className="rounded-md border border-white/10 bg-white/[0.02] p-3">
          <summary className="cursor-pointer text-sm font-medium text-white/75">
            {scene.title}
          </summary>
          <div className="mt-3 space-y-3">
            {scene.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white/80">{receipt.label}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/45">
                    {formatSnake(receipt.tier)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/45">{receipt.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {receipt.factRefs.slice(0, 6).map((ref) => (
                    <code key={ref} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/45">
                      {ref}
                    </code>
                  ))}
                  {receipt.factRefs.length > 6 && (
                    <span className="text-[10px] text-white/30">+{receipt.factRefs.length - 6} more</span>
                  )}
                </div>
                {receipt.eventRefs?.length ? (
                  <p className="mt-2 text-[11px] text-white/35">
                    {receipt.eventRefs.length} event ref{receipt.eventRefs.length === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export function AdminHighlightsDiagnosticsContent({
  detail,
}: {
  detail: AdminHouseHighlightsDiagnosticsResponse;
}) {
  const highlights = detail.highlights;
  const gameKey = detail.game.slug ?? detail.game.id;
  const selectedById = new Map(highlights.diagnostics.selectedCandidates.map((candidate) => [candidate.id, candidate]));
  const allCandidates = [
    ...highlights.diagnostics.selectedCandidates,
    ...highlights.diagnostics.rejectedCandidates,
  ];
  const categoryMix = highlights.scenes.reduce<Record<string, number>>((counts, scene) => {
    counts[scene.category] = (counts[scene.category] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="space-y-5" data-testid="admin-highlights-diagnostics">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Artifact" value={formatSnake(highlights.state)} sub={highlights.cut?.kind ? formatSnake(highlights.cut.kind) : highlights.noCutReason ?? "no cut"} />
        <Metric label="Selected" value={String(highlights.scenes.length)} sub={`${allCandidates.length} candidates`} />
        <Metric label="Rejected" value={String(highlights.diagnostics.rejectedCandidates.length)} sub="unused or gated" />
        <Metric label="Receipts" value={String(highlights.eligibility.allianceReceiptCount)} sub="alliance receipts" />
      </div>

      <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/35">Why these cards?</p>
        <h3 className="mt-2 text-base font-semibold text-white">
          {highlights.thesis ?? "No main thesis"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-white/50">
          {highlights.noCutReason
            ? `The House declined a cut: ${formatSnake(highlights.noCutReason)}.`
            : "Selected cards are ordered by the editorial cut after evidence, category, duplicate, and cap gates."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(categoryMix).map(([category, count]) => (
            <span key={category} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/50">
              {formatSnake(category)} x{count}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Selected cards</h3>
        {highlights.scenes.length === 0 ? (
          <div className="rounded-md border border-white/10 p-4 text-sm text-white/35">
            No cards selected.
          </div>
        ) : (
          <div className="grid gap-3">
            {highlights.scenes.map((scene) => (
              <SelectedSceneCard
                key={scene.id}
                scene={scene}
                candidate={selectedById.get(scene.id)}
                gameKey={gameKey}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Rejected and unused candidates</h3>
        <CandidateTable candidates={highlights.diagnostics.rejectedCandidates} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Receipt inspector</h3>
        <ReceiptInspector scenes={highlights.scenes} />
      </section>

      {highlights.diagnostics.notes.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Diagnostics notes</h3>
          <div className="grid gap-2">
            {highlights.diagnostics.notes.map((note) => (
              <div key={note.code} className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-white/55">
                <span className="font-medium text-white/75">{note.code}</span>: {note.message}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function AdminHighlightsPill({
  game,
  onClick,
}: {
  game: AdminGameSummary;
  onClick: () => void;
}) {
  if (game.status !== "completed") {
    return <span className="text-xs text-white/20">-</span>;
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={`Open House Highlights diagnostics for game ${game.slug}`}
      className="min-h-8 rounded-md border border-cyan-700/40 bg-cyan-950/30 px-2.5 py-1 text-left text-xs font-medium text-cyan-100 transition-colors hover:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-500"
    >
      <span className="block leading-tight">Cards</span>
      <span className="block text-[10px] font-normal text-cyan-100/55">diagnostics</span>
    </button>
  );
}

export function AdminHighlightsDiagnosticsPanel({
  game,
  onClose,
}: {
  game: AdminGameSummary;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminHouseHighlightsDiagnosticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const requestDiagnostics = useCallback((requestId: number) => {
    getAdminPostgameHighlightsDiagnostics(game.slug)
      .then((next) => {
        if (requestIdRef.current !== requestId) return;
        setDetail(next);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "Failed to load House Highlights diagnostics.");
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [game.slug]);

  const loadDiagnostics = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    requestDiagnostics(requestId);
  }, [requestDiagnostics]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestDiagnostics(requestId);
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestDiagnostics]);

  const title = useMemo(() => game.slug, [game.slug]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-highlights-panel-title"
        className="h-full w-full max-w-4xl overflow-y-auto border-l border-white/10 bg-neutral-950 p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/35">House Highlights diagnostics</p>
            <h2 id="admin-highlights-panel-title" className="mt-1 text-xl font-semibold text-white">
              {title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-2 text-sm text-white/60 transition-colors hover:border-white/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="rounded-md border border-white/10 p-8 text-center text-sm text-white/40">
            Loading House Highlights diagnostics...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            <p>{error}</p>
            <button
              type="button"
              onClick={loadDiagnostics}
              className="mt-3 rounded-md border border-red-700/60 px-3 py-1.5 text-xs text-red-100 hover:border-red-400"
            >
              Retry
            </button>
          </div>
        ) : detail ? (
          <AdminHighlightsDiagnosticsContent detail={detail} />
        ) : null}
      </aside>
    </div>
  );
}
