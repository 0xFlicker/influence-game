import { expect, test } from "bun:test";
import { evidenceDatabaseError, retryEvidenceTransaction, safeEvidenceError } from "./evidence-errors.js";

test("reports nested SQLSTATE and constraint without private SQL parameters", () => {
  const cause = Object.assign(new Error("private detail"), { code: "23503", constraint_name: "game_evidence_owner_epoch_fk", detail: "secret" });
  const error = new Error("Failed query: private payload and credentials", { cause });
  expect(safeEvidenceError(error)).toBe("PostgreSQL 23503 (game_evidence_owner_epoch_fk)");
  expect(safeEvidenceError(new Error("Failed query: secret"))).toBe("Evidence manifest persistence failed");
  expect(safeEvidenceError({ code: "23505", constraint: "secret\nvalue" })).toBe("PostgreSQL 23505");
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  expect(evidenceDatabaseError(cyclic)).toEqual({});
});

test("retries known-aborted transient transactions and bounds persistent failure", async () => {
  let attempts = 0;
  expect(await retryEvidenceTransaction(async () => {
    attempts++;
    if (attempts < 3) throw new Error("query", { cause: { code: attempts === 1 ? "40P01" : "40001" } });
    return "stored";
  })).toBe("stored");
  expect(attempts).toBe(3);
  attempts = 0;
  await expect(retryEvidenceTransaction(async () => { attempts++; throw { code: "40P01" }; })).rejects.toEqual({ code: "40P01" });
  expect(attempts).toBe(3);
  for (const code of ["23503", "08006", "57014"]) {
    attempts = 0;
    await expect(retryEvidenceTransaction(async () => { attempts++; throw { code }; })).rejects.toEqual({ code });
    expect(attempts).toBe(1);
  }
});
