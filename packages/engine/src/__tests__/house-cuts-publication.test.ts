import { expect, test } from "bun:test";
import { cutFixtureReports } from "../house-cuts/fixtures";
import { validateCutSelection } from "../house-cuts/selection";
import { publishCutSelection } from "../house-cuts/publication";
const reports = await cutFixtureReports();
test("selection accepts zero or two without a quota, rejecting unknown/duplicate/overlapping keys", () => {
  const report = reports[2]!;
  const keys = report.candidates.slice(0, 2).map(c => c.key);
  expect(validateCutSelection({ selectedKeys: [] }, report)).toEqual([]);
  expect(validateCutSelection({ selectedKeys: keys }, report)).toEqual(keys);
  for (const value of [null, {}, "{}", { selectedKeys: keys, extra: true }, { selectedKeys: ["invented"] }, { selectedKeys: [keys[0], keys[0]] }]) {
    expect(() => validateCutSelection(value, report)).toThrow();
  }
  const original = report.candidates[0]!;
  const duplicate = { ...original, key: "duplicate" };
  expect(() => validateCutSelection({ selectedKeys: [original.key, duplicate.key] }, { ...report, candidates: [...report.candidates, duplicate] })).toThrow("overlapping");
});
test("publication revalidates against canonical context and excludes internal diagnostics", () => {
  for (const report of reports.slice(0, 3)) {
    const selected = report.candidates[0]!;
    const publication = publishCutSelection(report, [selected.key], "version");
    expect(publication.audience).toBe(report.source.audience);
    expect(publication.cuts[0]!.quotes[0]!.name).toBeTruthy();
    expect(JSON.stringify(publication)).not.toMatch(/rationale|PRIVATE_|attempts|rejected|sourceHash/);
    const tampered = structuredClone(report);
    tampered.candidates[0]!.context = [];
    tampered.candidates[0]!.replayHref = "https://evil.test";
    expect(publishCutSelection(tampered, [selected.key], "version")).toEqual(publication);
    tampered.candidates[0]!.proposal.quotes[0]!.excerpt = "invented speech";
    expect(() => publishCutSelection(tampered, [selected.key], "version")).toThrow();
  }
});
