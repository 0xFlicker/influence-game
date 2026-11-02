import { planCutDiscovery, type CutProposalBatch, type DiscoveryReport } from "./editorial";
import { validateCutSelection } from "./selection";
import type { CutSource } from "./source";
export interface PublishedHouseCut {
  id: string; title: string; context: string; angle: string; payoff: string | null;
  quotes: Array<{ name: string; text: string; sourceRef?: string }>;
  participants: Array<{ id: string; name: string }>;
  sourceRefs: string[]; replayHref: string | null;
}
export interface HouseCutsPublication {
  version: string; audience: CutSource["audience"]; cuts: PublishedHouseCut[];
}
export interface HouseCutsResponse {
  game: CutSource["game"]; audience: CutSource["audience"];
  status: "not_prepared" | "pending" | "ready" | "failed"; publication: HouseCutsPublication | null;
}
export function publishCutSelection(report: DiscoveryReport, selection: CutProposalBatch, version: string): HouseCutsPublication {
  const plan = planCutDiscovery(report.source, { maxCalls: 40, maxInputBytesPerCall: 32000, maxOutputTokensPerCall: 4000 });
  // Final cards bind directly to frozen source, never cached candidate context or URLs.
  const batch = validateCutSelection(selection, report);
  return { version, audience: report.source.audience, cuts: batch.candidates.map((c, i) => {
    const entries = report.source.evidence.filter(e => c.sourceRefs.includes(e.id));
    const ids = new Set(entries.flatMap(e => e.participantIds));
    const context = new Set(plan.windows.filter(w => w.evidence.some(e => c.sourceRefs.includes(e.id))).flatMap(w => w.evidence.map(e => e.id)));
    const replay = report.source.audience === "mystery" ? report.source.evidence.filter(e => context.has(e.id)).at(-1) : entries[0];
    return { id: `${version}-${i + 1}`, title: c.title, context: c.context, angle: c.angle,
      payoff: c.payoff, participants: report.source.cast.filter(p => ids.has(p.id)), sourceRefs: c.sourceRefs,
      replayHref: replay?.replayHref ?? null,
      quotes: c.quotes.map(q => {
        const source = entries.find(e => e.id === q.sourceRef)!;
        if (source.content.kind !== "dialogue") throw new Error("Invalid excerpt provenance");
        const speakerId = source.content.speakerId;
        const speaker = report.source.cast.find(p => p.id === speakerId);
        if (!speaker) throw new Error("Missing canonical Cut speaker");
        return { name: speaker.name, text: q.excerpt, sourceRef: q.sourceRef };
      }) };
  }) };
}
