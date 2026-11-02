import { expect, test } from "bun:test";
import { cutFixtureReports } from "../house-cuts/fixtures";
import { validateCutSelection } from "../house-cuts/selection";
import { publishCutSelection } from "../house-cuts/publication";
const reports = await cutFixtureReports();
const selection = (report: typeof reports[number]) => ({ sourceHash: report.source.hash, windowId: "selection", candidates: [structuredClone(report.candidates[0]!.proposal)] });
test("House can rewrite, combine, overlap and explicitly select zero", () => {
  const report = reports[2]!;
  const value = selection(report);
  value.candidates[0]!.title = "A fresh editorial angle";
  value.candidates[0]!.quotes[0]!.excerpt = "An entertaining paraphrase.";
  value.candidates.push({ ...value.candidates[0]!, id: "another-angle" });
  expect(validateCutSelection(value, report).candidates).toHaveLength(2);
  expect(validateCutSelection({ ...value, candidates: [] }, report).candidates).toHaveLength(0);
  value.candidates.push({ ...value.candidates[0]!, id: "bad", sourceRefs: ["foreign-audience"] });
  expect(validateCutSelection(value, report).candidates).toHaveLength(2);
  expect(() => validateCutSelection({ ...value, candidates: [value.candidates[2]] }, report)).toThrow("No usable");
});
test("publication derives attribution and replay from frozen source, allowing paraphrases", () => {
  for (const report of reports.slice(0, 3)) {
    const value = selection(report);
    value.candidates[0]!.quotes[0]!.excerpt = "A polished exchange.";
    const publication = publishCutSelection(report, value, "version");
    expect(publication.cuts[0]!.quotes[0]!.text).toBe("A polished exchange.");
    expect(publication.cuts[0]!.quotes[0]!.name).toBeTruthy();
    expect(JSON.stringify(publication)).not.toMatch(/rationale|PRIVATE_|attempts|rejected|sourceHash/);
    const tampered = structuredClone(report);
    tampered.candidates[0]!.context = [];
    tampered.candidates[0]!.replayHref = "https://evil.test";
    expect(publishCutSelection(tampered, value, "version")).toEqual(publication);
    value.candidates[0]!.sourceRefs = ["foreign-audience"];
    expect(() => publishCutSelection(report, value, "version")).toThrow();
  }
});
