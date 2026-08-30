import { describe, expect, test } from "bun:test";
import {
  assertDevelopmentDatabaseUrl,
  assertDevelopmentDopplerEnvironment,
  assertFixtureIsolation,
  assertRecordedFixture,
  assertRehearsalHealth,
  readRehearsalAdminAddress,
} from "../packages/api/src/scripts/local-game-worker-rehearsal";

describe("local game-worker rehearsal guards", () => {
  const devEnvironment = {
    DOPPLER_PROJECT: "social-strategy-agent",
    DOPPLER_CONFIG: "dev",
    DATABASE_URL: "postgresql://influence:influence@127.0.0.1:54320/influence_dev",
    ADMIN_ADDRESS: "0x1234567890123456789012345678901234567890",
  };

  test("accepts only the configured loopback development database", () => {
    expect(assertDevelopmentDatabaseUrl(devEnvironment.DATABASE_URL).pathname).toBe("/influence_dev");
  });
  test.each(["postgresql://influence:influence@127.0.0.1:54320/influence_test", "postgresql://influence:influence@localhost:54320/influence_dev", "postgresql://influence:influence@127.0.0.1:54320/postgres"]) ("rejects unsafe database %s", (url) => expect(() => assertDevelopmentDatabaseUrl(url)).toThrow());

  test("requires Doppler's configured development project and non-secret admin identity", () => {
    expect(assertDevelopmentDopplerEnvironment(devEnvironment)).toMatchObject({ project: "social-strategy-agent", config: "dev", database: "influence_dev" });
    expect(readRehearsalAdminAddress(devEnvironment)).toBe(devEnvironment.ADMIN_ADDRESS);
    expect(() => assertDevelopmentDopplerEnvironment({ ...devEnvironment, DOPPLER_CONFIG: "stg" })).toThrow("config dev");
    expect(() => readRehearsalAdminAddress({ ...devEnvironment, ADMIN_ADDRESS: undefined })).toThrow("ADMIN_ADDRESS");
  });

  test("refuses unrelated runnable work and permits only the recorded fixture", () => {
    const unrelated = [{ gameId: "other-game", slug: "other-game", status: "in_progress", activeOwnerProcessId: null }];
    expect(() => assertFixtureIsolation(unrelated, undefined)).toThrow("unrelated runnable games");
    expect(() => assertFixtureIsolation(unrelated, "fixture-game")).toThrow("unrelated runnable games");
    expect(() => assertFixtureIsolation([{ ...unrelated[0]!, gameId: "fixture-game" }], "fixture-game")).not.toThrow();
    const marker = "local-worker-rehearsal-123";
    expect(() => assertRecordedFixture({ id: "fixture-game", createdById: marker }, marker)).not.toThrow();
    expect(() => assertRecordedFixture({ id: "fixture-game", createdById: "someone-else" }, marker)).toThrow("Recorded rehearsal fixture");
    expect(() => assertRecordedFixture({ id: "fixture-game", createdById: marker }, undefined)).toThrow("REHEARSAL_FIXTURE_MARKER");
  });

  test("proves the API runtimeRole rather than an invented role field", () => {
    expect(() => assertRehearsalHealth({ runtimeRole: "gateway" }, "gateway")).not.toThrow();
    expect(() => assertRehearsalHealth({ role: "gateway" }, "gateway")).toThrow();
  });

});
