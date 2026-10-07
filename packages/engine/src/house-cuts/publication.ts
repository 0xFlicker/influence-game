import { planCutDiscovery, validateCutProposals, type DiscoveryReport } from "./editorial";
import { validateCutSelection } from "./selection";
import type { CutSource } from "./source";
export interface PublishedHouseCut {
  id: string; title: string; context: string; angle: string; payoff: string | null;
  quotes: Array<{ name: string; text: string }>;
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
export function publishCutSelection(report: DiscoveryReport, selectedKeys: string[], version: string): HouseCutsPublication {
  validateCutSelection({ selectedKeys }, report);
  const plan = planCutDiscovery(report.source, { maxCalls: 40, maxInputBytesPerCall: 32000, maxOutputTokensPerCall: 4000 });
  return { version, audience: report.source.audience, cuts: selectedKeys.map((key, i) => {
    const c = report.candidates.find(c => c.key === key)!;
    const window = plan.windows.find(w => w.id === c.windowId);
    if (!window || key !== `${window.id}/${c.proposal.id}`) throw new Error("Invalid publication window");
    validateCutProposals({ sourceHash: report.source.hash, windowId: window.id, candidates: [c.proposal] }, window);
    const cast = (id: string) => {
      const p = report.source.cast.find(p => p.id === id);
      if (!p) throw new Error("Missing canonical Cut participant");
      return { id: p.id, name: p.name };
    };
    return { id: `${version}-${i + 1}`, title: c.proposal.title, context: c.proposal.context, angle: c.proposal.angle,
      payoff: c.proposal.payoff, participants: c.proposal.participantIds.map(cast), sourceRefs: [...c.proposal.sourceRefs],
      replayHref: report.source.audience === "mystery" ? window.evidence.at(-1)?.replayHref ?? null : window.evidence.find(e => e.id === c.proposal.sourceRefs[0])?.replayHref ?? null,
      quotes: c.proposal.quotes.map(q => {
        const source = window.evidence.find(e => e.id === q.sourceRef);
        if (!source || source.content.kind !== "dialogue" || !source.content.text.includes(q.excerpt)) throw new Error("Invalid Cut quote");
        return { name: cast(source.content.speakerId).name, text: q.excerpt };
      }) };
  }) };
}
