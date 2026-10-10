import { expect, test } from "bun:test";
import { authorizeCliSessionTarget, cliRequestWebOrigin } from "../app/auth/cli/target";

const query = { api: "https://api.house.example", callback: "http://127.0.0.1:42761/cli-session", state: "x".repeat(43) };
const config = { webOrigin: "https://house.example", publicApiUrl: query.api, backendAuthUrl: "http://127.0.0.1:3000/api/auth/me" };

test("CLI handoff accepts the current public API, same-origin proxy and exact configured local backend", () => {
  for (const api of [query.api, config.webOrigin, "http://127.0.0.1:3000"]) {
    expect(authorizeCliSessionTarget({ ...query, api }, config)).toEqual({ apiOrigin: api, callbackUrl: query.callback, state: query.state });
  }
  expect(authorizeCliSessionTarget({ ...query, api: "http://localhost:4100" }, {
    webOrigin: "http://localhost:4100", publicApiUrl: "", backendAuthUrl: "http://127.0.0.1:3200/api/auth/me",
  }).apiOrigin).toBe("http://localhost:4100");
  expect(authorizeCliSessionTarget({ ...query, api: `${query.api}/` }, config).apiOrigin).toBe(query.api);
});

test("CLI handoff refuses arbitrary targets, duplicate values, token URLs and unsafe callbacks before login", () => {
  const invalid = [
    { ...query, api: "https://unrelated.example" }, { ...query, api: "http://127.0.0.1:3999" },
    { ...query, api: "https://api.house.example/api" }, { ...query, api: [query.api, "https://unrelated.example"] },
    { ...query, token: "private-session" }, { ...query, state: "short" },
    { ...query, callback: "https://unrelated.example/cli-session" },
    { ...query, callback: "http://localhost:42761/cli-session" },
    { ...query, callback: `${query.callback}?token=private-session` },
    { ...query, callback: "http://127.0.0.1:42761/other" },
  ];
  for (const value of invalid) expect(() => authorizeCliSessionTarget(value, config)).toThrow();
});

test("Docker's internal HTTP backend does not block public or same-origin CLI login", () => {
  const docker = { ...config, backendAuthUrl: "http://api:3001/api/auth/me" };
  for (const api of [query.api, config.webOrigin]) {
    expect(authorizeCliSessionTarget({ ...query, api }, docker).apiOrigin).toBe(api);
  }
  expect(authorizeCliSessionTarget({ ...query, api: config.webOrigin }, { ...docker, publicApiUrl: "" }).apiOrigin).toBe(config.webOrigin);
  for (const api of ["http://api:3001", "http://another-internal-service:3001"]) {
    expect(() => authorizeCliSessionTarget({ ...query, api }, docker)).toThrow("HTTPS or loopback HTTP");
  }
  expect(() => authorizeCliSessionTarget({ ...query, api: "https://unrelated.example" }, docker)).toThrow("different API");
});

test("CLI target origins come from the configured web address or verified request host", () => {
  const requestHeaders = new Headers({ host: "house.example", "x-forwarded-proto": "https" });
  expect(cliRequestWebOrigin(requestHeaders)).toBe("https://house.example");
  expect(cliRequestWebOrigin(new Headers(), "https://configured.example/")).toBe("https://configured.example");
  expect(() => cliRequestWebOrigin(new Headers())).toThrow("could not be verified");
  expect(() => cliRequestWebOrigin(new Headers({ host: "house.example/other", "x-forwarded-proto": "https" }))).toThrow();
});
