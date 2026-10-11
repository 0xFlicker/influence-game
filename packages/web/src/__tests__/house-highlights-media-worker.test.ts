import { createConnection, createServer } from "node:net";
import { renderExecutionConfig, type RenderExecution } from "@influence/engine/render-execution-config";
import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseHouseHighlightsTrailerManifest, type InfluenceTrailerManifest } from "@influence/engine";
import {
  createHouseHighlightsTrailerPlaybackMetadata,
  writeHouseHighlightsTrailerPlaybackMetadata,
  renderHouseHighlightsTrailerMediaBundle,
  type HouseHighlightsTrailerRenderer,
} from "../lib/house-highlights-trailer-media-bundle";
import {
  assertHouseHighlightsMediaWorkerSmokeResult,
  assertPreparedHouseHighlightsTrailerMusicMatrix,
  houseHighlightsMediaWorkerConfig,
  checkHouseHighlightsMediaWorkerHealth,
  HouseHighlightsMediaWorkerDrainController,
  initializeHouseHighlightsMediaWorkerControl,
  type HouseHighlightsMediaWorkerDrainAcknowledgement,
  heartbeatIntervalForLease,
  parseHouseHighlightsMediaWorkerArgs,
  readHouseHighlightsMediaWorkerStartupMode,
  readHouseHighlightsMediaWorkerAdmission,
  runHouseHighlightsMediaWorker,
  runHouseHighlightsMediaWorkerAttempt,
  runHouseHighlightsMediaWorkerOnce,
  writeHouseHighlightsMediaWorkerDrainAcknowledgement,
  withWorkerReachableAssetUrls,
} from "../scripts/render-house-highlights-media-worker";

describe("House Highlights media worker bundle", () => {
  const execution: RenderExecution = { ...renderExecutionConfig({}), mode: "remote", environment: "staging" };
  const remoteConfig = (env: Record<string, string | undefined>) => houseHighlightsMediaWorkerConfig(env, execution);
  const remoteEnv = {
    POSTGAME_MEDIA_API_URL: "https://api.test/",
    POSTGAME_MEDIA_WORKER_TOKEN: "worker-token",
    POSTGAME_MEDIA_RENDER_GENERATION: "release-42",
    POSTGAME_MEDIA_WORKER_DIGEST: `sha256:${"a".repeat(64)}`,
    POSTGAME_MEDIA_WORKER_INSTANCE_ID: "11111111-1111-4111-8111-111111111111",
    POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
  };

  it("defaults to local execution and rejects incomplete or unbounded remote configuration", () => {
    expect(houseHighlightsMediaWorkerConfig({ POSTGAME_MEDIA_API_URL: "http://api.test", POSTGAME_MEDIA_WORKER_TOKEN: "test" }).executionMode).toBe("local");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_WORKER_INSTANCE_ID: undefined })).toThrow("POSTGAME_MEDIA_WORKER_INSTANCE_ID");
    expect(houseHighlightsMediaWorkerConfig({ ...remoteEnv, POSTGAME_MEDIA_EXECUTION_MODE: "remote" }).executionMode).toBe("local");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_API_URL: "http://api.test" })).toThrow("must use HTTPS without URL credentials");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_API_URL: "https://user:secret@api.test" })).toThrow("must use HTTPS without URL credentials");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_MAX_JOBS: "101" })).toThrow("POSTGAME_MEDIA_MAX_JOBS");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_QUIET_INTERVAL_MS: "0" })).toThrow("POSTGAME_MEDIA_QUIET_INTERVAL_MS");
    expect(() => remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_QUIET_INTERVAL_MS: "120001" })).toThrow("POSTGAME_MEDIA_QUIET_INTERVAL_MS");
  });

  it("requires canonical tailnet TLS and routes API, health and Chromium through the sidecar", async () => {
    const tailnet = { ...execution, network: "tailnet" as const, apiOrigin: "https://influence-staging.tail8a79ed.ts.net" };
    const env = { ...remoteEnv, POSTGAME_MEDIA_API_URL: tailnet.apiOrigin, POSTGAME_MEDIA_HTTP_PROXY: "http://127.0.0.1:1055" };
    expect(() => houseHighlightsMediaWorkerConfig({ ...env, POSTGAME_MEDIA_HTTP_PROXY: undefined }, tailnet)).toThrow("requires POSTGAME_MEDIA_HTTP_PROXY");
    expect(() => houseHighlightsMediaWorkerConfig({ ...env, POSTGAME_MEDIA_API_URL: "https://100.1.2.3" }, tailnet)).toThrow("canonical tailnet HTTPS");
    const config = houseHighlightsMediaWorkerConfig(env, tailnet);
    expect(config.remotionOptions.browserExecutable).toBe("/usr/local/bin/chromium-tailnet");
    let calls = 0;
    const fetchImpl = (async (input, init) => {
      expect((init as RequestInit & { proxy?: string }).proxy).toBe(env.POSTGAME_MEDIA_HTTP_PROXY);
      expect(init?.redirect).toBe("error");
      calls += 1;
      return Response.json(String(input).endsWith("/control") ? { admitted: true, generation: "release-42", draining: false } : { claim: null });
    }) as typeof fetch;
    expect(await runHouseHighlightsMediaWorkerOnce(config, fetchImpl)).toBe("idle");
    expect(calls).toBe(2);
    const wrapper = await Bun.file(join(import.meta.dir, "../../../../deployment/chromium-tailnet")).text();
    expect(wrapper).toContain('--proxy-server="$POSTGAME_MEDIA_HTTP_PROXY"');
    expect(wrapper).not.toContain("ignore-certificate-errors");
  });

  it("tunnels real HTTPS API requests through a userspace HTTP proxy with hostname verification", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-proxy-tls-"));
    const key = join(root, "key.pem"), certificate = join(root, "cert.pem");
    const hostname = "influence-staging.tail8a79ed.ts.net";
    expect(Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate, "-days", "1", "-subj", `/CN=${hostname}`, "-addext", `subjectAltName=DNS:${hostname}`], { stdout: "ignore", stderr: "ignore" }).exitCode).toBe(0);
    const api = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { key: Bun.file(key), cert: Bun.file(certificate) }, fetch: request => {
      expect(request.headers.get("Authorization")).toBe("Bearer worker-token");
      return Response.json(new URL(request.url).pathname.endsWith("/control") ? { admitted: true, generation: "release-42", draining: false } : { claim: null });
    } });
    const connects: string[] = [];
    const proxy = createServer(socket => {
      let request = Buffer.alloc(0);
      const headers = (chunk: Buffer) => {
        request = Buffer.concat([request, chunk]);
        const boundary = request.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        socket.off("data", headers);
        connects.push(request.toString().split("\r\n")[0]!);
        const upstream = createConnection({ host: "127.0.0.1", port: api.port! }, () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (request.length > boundary + 4) upstream.write(request.subarray(boundary + 4));
          socket.pipe(upstream); upstream.pipe(socket);
        });
        socket.on("error", () => upstream.destroy());
        upstream.on("error", () => socket.destroy());
      };
      socket.on("data", headers);
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("Missing proxy fixture port");
    const workerModule = join(import.meta.dir, "../scripts/render-house-highlights-media-worker.ts");
    const child = Bun.spawn([process.execPath, "-e", `import {houseHighlightsMediaWorkerConfig, runHouseHighlightsMediaWorkerOnce} from ${JSON.stringify(workerModule)}; const config=houseHighlightsMediaWorkerConfig(process.env, ${JSON.stringify(execution)}); config.httpProxy=${JSON.stringify(`http://127.0.0.1:${address.port}`)}; if(await runHouseHighlightsMediaWorkerOnce(config)!=="idle")process.exit(1); process.exit(0);`], { env: { ...process.env, ...remoteEnv, POSTGAME_MEDIA_API_URL: `https://${hostname}`, POSTGAME_MEDIA_TEMP_DIR: root, NODE_EXTRA_CA_CERTS: certificate }, stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      expect(await child.exited).toBe(0);
      expect(connects.length).toBeGreaterThan(0);
      expect(connects.every(value => value === `CONNECT ${hostname}:443 HTTP/1.1`)).toBe(true);
    } finally { clearTimeout(timeout); child.kill(); proxy.close(); api.stop(true); await rm(root, { recursive: true, force: true }); }
  });

  it("sends exact remote identity to control and claim, and does not claim a draining generation", async () => {
    const config = remoteConfig(remoteEnv);
    const requests: Request[] = [];
    let draining = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.url.endsWith("/control")
        ? Response.json({ admitted: true, generation: "release-42", draining })
        : Response.json({ claim: null });
    }) as unknown as typeof fetch;
    expect(await runHouseHighlightsMediaWorkerOnce(config, fetchImpl)).toBe("idle");
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/internal/postgame-media/control", "/api/internal/postgame-media/claim"]);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBe("Bearer worker-token");
      expect(request.headers.get("x-render-generation")).toBe("release-42");
      expect(request.headers.get("x-render-worker-digest")).toBe(remoteEnv.POSTGAME_MEDIA_WORKER_DIGEST);
      expect(request.headers.get("x-render-worker-instance")).toBe(remoteEnv.POSTGAME_MEDIA_WORKER_INSTANCE_ID);
    }
    draining = true;
    expect(await runHouseHighlightsMediaWorkerOnce(config, fetchImpl)).toBe("drained");
    expect(requests.length).toBe(3);
  });

  it("fails closed for unavailable or malformed remote admission and refuses a different generation", async () => {
    const config = remoteConfig(remoteEnv);
    await expect(readHouseHighlightsMediaWorkerAdmission(config, (async () => Response.json({ admitted: true, generation: "old", draining: false })) as unknown as typeof fetch)).resolves.toBe(false);
    await expect(readHouseHighlightsMediaWorkerAdmission(config, (async () => Response.json({ admitted: false, generation: null, draining: false })) as unknown as typeof fetch)).resolves.toBe(false);
    await expect(readHouseHighlightsMediaWorkerAdmission(config, (async () => Response.json(null)) as unknown as typeof fetch)).rejects.toThrow("worker_api_invalid_control");
    await expect(readHouseHighlightsMediaWorkerAdmission(config, (async () => Response.json({ admitted: true, generation: null, draining: false })) as unknown as typeof fetch)).rejects.toThrow("worker_api_invalid_control");
    await expect(readHouseHighlightsMediaWorkerAdmission(config, (async () => Response.json({ admitted: "true", generation: "release-42", draining: false })) as unknown as typeof fetch)).rejects.toThrow("worker_api_invalid_control");
    let claims = 0;
    await expect(runHouseHighlightsMediaWorker(config, (async () => new Response("", { status: 503 })) as unknown as typeof fetch, {
      runOnceImpl: async () => { claims += 1; return "completed"; },
    })).rejects.toThrow("worker_api_503");
    expect(claims).toBe(0);
  });

  it("exits a remote worker after a bounded batch, counting terminal outcomes", async () => {
    const config = remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_MAX_JOBS: "2" });
    const outcomes = ["waiting_music", "failed", "completed"];
    let attempts = 0;
    const sleeps: number[] = [];
    await runHouseHighlightsMediaWorker(config, (async () => Response.json({ admitted: true, generation: "release-42", draining: false })) as unknown as typeof fetch, {
      runOnceImpl: async () => outcomes[attempts++],
      sleepImpl: async (ms) => { sleeps.push(ms); },
    });
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([0]);
  });

  it("requires a fresh quiet interval after work and then exits without an always-on poller", async () => {
    const config = remoteConfig({ ...remoteEnv, POSTGAME_MEDIA_QUIET_INTERVAL_MS: "1000", POSTGAME_MEDIA_POLL_INTERVAL_MS: "500" });
    let now = 0;
    let attempts = 0;
    const sleeps: number[] = [];
    await runHouseHighlightsMediaWorker(config, (async () => Response.json({ admitted: true, generation: "release-42", draining: false })) as unknown as typeof fetch, {
      runOnceImpl: async () => ++attempts === 2 ? "completed" : "idle",
      nowImpl: () => now,
      sleepImpl: async (ms) => { sleeps.push(ms); now += ms; },
    });
    expect(attempts).toBe(5);
    expect(sleeps).toEqual([500, 0, 500, 500]);
  });

  it("finishes a remote attempt before observing drain and never starts a second attempt", async () => {
    const config = remoteConfig(remoteEnv);
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let admitted = true;
    let attempts = 0;
    let finished = false;
    const worker = runHouseHighlightsMediaWorker(config, (async () => Response.json({ admitted, generation: "release-42", draining: !admitted })) as unknown as typeof fetch, {
      runOnceImpl: async () => { attempts += 1; started.resolve(); await release.promise; finished = true; return "completed"; },
      sleepImpl: async () => undefined,
    });
    await started.promise;
    admitted = false;
    expect(finished).toBe(false);
    release.resolve();
    await worker;
    expect(finished).toBe(true);
    expect(attempts).toBe(1);
  });

  it("transports an isolated child outcome so a remote parent can distinguish idle from work", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-attempt-result-"));
    const script = join(root, "result.ts");
    try {
      await writeFile(script, 'process.send?.({ type: "postgame-media-result", result: "idle" });\nprocess.exit(0);\n');
      expect(await runHouseHighlightsMediaWorkerAttempt(script)).toBe("idle");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exits a remote loop process after quiet without a host acknowledgement file", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-remote-cli-"));
    const key = join(root, "test-key.pem");
    const certificate = join(root, "test-cert.pem");
    const tlsFixture = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", certificate, "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdout: "ignore", stderr: "ignore" });
    expect(tlsFixture.exitCode).toBe(0);
    let claims = 0;
    const identities: string[] = [];
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { key: Bun.file(key), cert: Bun.file(certificate) }, fetch: (request) => {
      identities.push(request.headers.get("x-render-worker-instance") ?? "");
      if (new URL(request.url).pathname.endsWith("/control")) return Response.json({ admitted: true, generation: "release-42", draining: false });
      claims += 1;
      return Response.json({ claim: null });
    } });
    const workerModule = join(import.meta.dir, "../scripts/render-house-highlights-media-worker.ts");
    const child = Bun.spawn([process.execPath, "-e", `import { houseHighlightsMediaWorkerConfig, runHouseHighlightsMediaWorker } from ${JSON.stringify(workerModule)};
      await runHouseHighlightsMediaWorker(houseHighlightsMediaWorkerConfig(process.env, ${JSON.stringify(execution)}));
      process.exit(0);`], {
      env: { ...process.env, ...remoteEnv, POSTGAME_MEDIA_API_URL: `https://127.0.0.1:${server.port}`,
        NODE_EXTRA_CA_CERTS: certificate,
        POSTGAME_MEDIA_TEMP_DIR: root, POSTGAME_MEDIA_QUIET_INTERVAL_MS: "1000",
        POSTGAME_MEDIA_POLL_INTERVAL_MS: "500", POSTGAME_MEDIA_DRAIN_ACK_FILE: undefined,
        POSTGAME_MEDIA_STARTUP_MODE: "active" },
      stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      expect(await child.exited).toBe(0);
      expect(claims).toBeGreaterThanOrEqual(2);
      expect(identities.every((identity) => identity === remoteEnv.POSTGAME_MEDIA_WORKER_INSTANCE_ID)).toBe(true);
    } finally {
      clearTimeout(timeout);
      child.kill();
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a remote attempt without an explicit result instead of treating it as empty work", async () => {
    await expect(runHouseHighlightsMediaWorker(remoteConfig(remoteEnv),
      (async () => Response.json({ admitted: true, generation: "release-42", draining: false })) as unknown as typeof fetch,
      { runOnceImpl: async () => undefined },
    )).rejects.toThrow("worker_remote_attempt_result_missing");
  });

  it("defaults to active claims and validates the claim-disabled standby mode", () => {
    expect(readHouseHighlightsMediaWorkerStartupMode({})).toBe("active");
    expect(readHouseHighlightsMediaWorkerStartupMode({ POSTGAME_MEDIA_STARTUP_MODE: "standby" })).toBe("standby");
    expect(() => readHouseHighlightsMediaWorkerStartupMode({ POSTGAME_MEDIA_STARTUP_MODE: "paused" }))
      .toThrow("POSTGAME_MEDIA_STARTUP_MODE must be active or standby");
  });
  it("serializes visual rendering, poster rendering, and music composition", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-order-"));
    const musicDir = join(root, "music");
    const order: string[] = [];
    await mkdir(join(root, "tmp"), { recursive: true });
    await mkdir(musicDir, { recursive: true });
    await Bun.write(join(musicDir, "golden-verdict-0-cuts-6-players-28.8s.m4a"), "prepared score");

    await renderHouseHighlightsTrailerMediaBundle({
      manifest: manifestFixture(),
      outputDir: join(root, "out"),
      temporaryRoot: join(root, "tmp"),
      musicDir,
      renderer: {
        renderVisual: async ({ outputPath }) => {
          order.push("visual:start");
          await Promise.resolve();
          order.push("visual:end");
          await Bun.write(outputPath, "visual");
        },
        renderPoster: async ({ outputPath }) => {
          order.push("poster");
          await Bun.write(outputPath, "poster");
        },
        mux: async ({ outputPath }) => {
          order.push("mux");
          await Bun.write(outputPath, "muxed with audio");
        },
      },
    });

    expect(order).toEqual(["visual:start", "visual:end", "poster", "mux"]);
  });

  it("renders a stored snapshot without live game endpoints and cleans temporary output", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-test-"));
    const musicDir = join(root, "music");
    await mkdir(join(root, "tmp"), { recursive: true });
    await mkdir(musicDir, { recursive: true });
    await Bun.write(join(musicDir, "golden-verdict-0-cuts-6-players-28.8s.m4a"), "prepared score");
    const manifest = parseHouseHighlightsTrailerManifest(JSON.stringify(manifestFixture()));
    const bundle = await renderHouseHighlightsTrailerMediaBundle({
      manifest,
      outputDir: join(root, "out"),
      temporaryRoot: join(root, "tmp"),
      musicDir,
      renderer: fakeRenderer(),
    });

    if (manifest.kind !== "influence") throw new Error("Expected Influence fixture");
    expect(bundle.music.behavior).toBe("trim_and_fade");
    expect(bundle.posterFrame).toBeGreaterThan(manifest.cueSheet.segments[0]!.startFrame);
    expect(bundle.posterFrame).toBeLessThan(manifest.cueSheet.segments[0]!.endFrame);
    expect(bundle.posterFrame).toBeLessThan(manifest.cueSheet.markers.finalVoteRevealSeconds * manifest.frameRate);
    expect(bundle.captions).toContain("The room: Alice, Bob, Cara, Dax.");
    expect(bundle.captions).toContain("Final vote. 2-0.");
    expect(bundle.captions).toContain("Winner: Alice.");
    expect(bundle.captions).toContain("Runner-up");
    expect(bundle.captions.toLowerCase()).not.toContain("receipt");
    expect(bundle.captions.toLowerCase()).not.toContain("proof");
    expect(bundle.artifacts.video.byteLength).toBe(16);
    expect(bundle.artifacts.video.sha256).toBe("sha256:6e0e372e3ce6a41548d958e3f6a0339228a4b0624c1af7ad4c15eacf768f3fb6");
    expect(bundle.artifacts.poster.byteLength).toBe(6);
    expect(bundle.artifacts.poster.sha256).toBe("sha256:293b9207228b7854bc3ccb2959ebea1583e066d41983124a5b381d6fdf6575f8");
    const metadata = createHouseHighlightsTrailerPlaybackMetadata({
      preview: { title: "House Highlights", description: "A completed Influence game, told through the House." },
      durationMs: bundle.durationMs,
      dimensions: bundle.dimensions,
      renderVersion: "rv_fixture",
      urls: { videoUrl: "https://media.example.test/trailer.mp4", posterUrl: "https://media.example.test/poster.png", captionsUrl: "https://media.example.test/captions.vtt" },
      contentHashes: { video: bundle.artifacts.video.sha256, poster: bundle.artifacts.poster.sha256, captions: bundle.artifacts.captions.sha256 },
    });
    expect(Object.keys(metadata).sort()).toEqual(["captionsUrl", "contentHashes", "description", "dimensions", "durationMs", "posterUrl", "renderVersion", "schema", "title", "version", "videoUrl"]);
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("winner");
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("final vote");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("cleans temporary output after a mux failure without creating a final video", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-failure-"));
    const musicDir = join(root, "music");
    await mkdir(join(root, "tmp"), { recursive: true });
    await mkdir(musicDir, { recursive: true });
    await Bun.write(join(musicDir, "golden-verdict-0-cuts-6-players-28.8s.m4a"), "prepared score");
    const renderer = fakeRenderer({ mux: async () => { throw new Error("simulated mux failure"); } });
    await expect(renderHouseHighlightsTrailerMediaBundle({
      manifest: manifestFixture(), outputDir: join(root, "out"), temporaryRoot: join(root, "tmp"), musicDir, renderer,
    })).rejects.toThrow("simulated mux failure");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("uses env-only worker auth and does not include the token in API failures", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
    });
    const requests: Request[] = [];
    const result = await runHouseHighlightsMediaWorkerOnce(config, (async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ claim: null });
    }) as typeof fetch);
    expect(result).toBe("idle");
    expect(config.remotionOptions).toEqual({
      concurrency: 1,
      disallowParallelEncoding: true,
    });
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret-worker-token");
    expect(requests[0]?.headers.has("x-render-generation")).toBe(false);
    expect(() => houseHighlightsMediaWorkerConfig({ POSTGAME_MEDIA_API_URL: "http://api.test" }))
      .toThrow("POSTGAME_MEDIA_WORKER_TOKEN");
    expect(parseHouseHighlightsMediaWorkerArgs(["--once"])).toBe("once");
    expect(parseHouseHighlightsMediaWorkerArgs(["--smoke"])).toBe("smoke");
    expect(parseHouseHighlightsMediaWorkerArgs(["--health"])).toBe("health");
  });

  it("bounds worker API requests with the configured HTTP timeout", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
      POSTGAME_MEDIA_HTTP_TIMEOUT_MS: "1",
      POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
    });
    await expect(runHouseHighlightsMediaWorkerOnce(config, ((_, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")));
    })) as typeof fetch)).rejects.toThrow("worker_api_timeout");
    expect(config.uploadTimeoutMs).toBe(5 * 60_000);
  });

  it("keeps polling after a transient claim failure with bounded backoff", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
      POSTGAME_MEDIA_POLL_INTERVAL_MS: "10",
      POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
    });
    let requests = 0;
    const sleeps: number[] = [];
    const errors: string[] = [];
    await runHouseHighlightsMediaWorker(config, (async () => {
      requests += 1;
      if (requests === 1) throw new Error("temporary network failure containing https://secret.example");
      return Response.json({ claim: null });
    }) as unknown as typeof fetch, {
      maxIterations: 2,
      random: () => 0,
      sleepImpl: async (ms) => { sleeps.push(ms); },
      onError: (code) => { errors.push(code); },
    });

    expect(requests).toBe(2);
    expect(sleeps).toEqual([10]);
    expect(errors).toEqual(["poll_failed:worker_api_request_failed"]);
    expect(errors.join(" ")).not.toContain("secret.example");
  });

  it("isolates renderer signal handlers from parent drain and waits for attempt exit", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-signal-isolation-"));
    const childScript = join(root, "attempt.ts");
    const readyFile = join(root, "ready");
    const releaseFile = join(root, "release");
    await writeFile(childScript, `
      process.on("SIGTERM", () => process.exit(42));
      await Bun.write(${JSON.stringify(readyFile)}, "ready");
      while (!await Bun.file(${JSON.stringify(releaseFile)}).exists()) await Bun.sleep(10);
      process.exit(0);
    `);
    const drainController = new HouseHighlightsMediaWorkerDrainController();
    let attempts = 0;
    let completed = false;
    const loop = runHouseHighlightsMediaWorker(houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://unused", POSTGAME_MEDIA_WORKER_TOKEN: "test",
    }), fetch, {
      drainController,
      runOnceImpl: async () => {
        attempts += 1;
        await runHouseHighlightsMediaWorkerAttempt(childScript);
      },
    }).then(() => { completed = true; });
    try {
      const deadline = Date.now() + 5_000;
      while (!await Bun.file(readyFile).exists()) {
        if (Date.now() > deadline) throw new Error("render child did not start");
        await Bun.sleep(10);
      }
      // Same entry point used by the parent's SIGTERM listener. The renderer
      // lives in another process, so its destructive listener is not invoked.
      drainController.requestDrain("SIGTERM");
      expect(completed).toBe(false);
      await Bun.write(releaseFile, "finish");
      await loop;
      expect(completed).toBe(true);
      expect(attempts).toBe(1);
    } finally {
      drainController.requestDrain("SIGTERM");
      await Bun.write(releaseFile, "finish");
      await loop;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports an attempt process failure instead of treating it as a completed job", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-attempt-failed-"));
    const script = join(root, "failed.ts");
    try {
      await writeFile(script, "process.exit(23);\n");
      await expect(runHouseHighlightsMediaWorkerAttempt(script)).rejects.toThrow("render_attempt_exit_23");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drains the poll CLI on SIGTERM while waiting for its active child", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-cli-drain-"));
    const acknowledgement = join(root, "drain-ack.json");
    const release = Promise.withResolvers<void>();
    let requests = 0;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async () => {
      requests += 1;
      await release.promise;
      return Response.json({ claim: null });
    } });
    const parent = Bun.spawn([process.execPath,
      join(import.meta.dir, "../scripts/render-house-highlights-media-worker.ts")], {
      env: { ...process.env, POSTGAME_MEDIA_API_URL: `http://127.0.0.1:${server.port}`,
        POSTGAME_MEDIA_WORKER_TOKEN: "test", POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
        POSTGAME_MEDIA_TEMP_DIR: root, POSTGAME_MEDIA_DRAIN_ACK_FILE: acknowledgement,
        POSTGAME_MEDIA_STARTUP_MODE: "active" },
      stdout: "pipe", stderr: "pipe",
    });
    const deadline = Date.now() + 3_000;
    const timeout = setTimeout(() => parent.kill("SIGKILL"), 3_500);
    try {
      while (requests === 0) {
        if (Date.now() > deadline) throw new Error("render child did not claim");
        await Bun.sleep(10);
      }
      parent.kill("SIGTERM");
      while (!await Bun.file(acknowledgement).exists()) {
        if (Date.now() > deadline) throw new Error("parent did not acknowledge SIGTERM");
        await Bun.sleep(10);
      }
      expect(await Bun.file(acknowledgement).json()).toMatchObject({ signal: "SIGTERM", claimInFlight: true });
      expect(parent.exitCode).toBeNull();
      release.resolve();
      expect(await parent.exited).toBe(0);
      expect(requests).toBe(1);
    } finally {
      release.resolve();
      clearTimeout(timeout);
      parent.kill();
      await parent.exited;
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exits the once CLI after cleanup even with a retained renderer handle", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-cli-exit-"));
    const preload = join(root, "retained-handle.ts");
    await writeFile(preload, "setInterval(() => {}, 1000);\n");
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ claim: null }) });
    const child = Bun.spawn([process.execPath, "--preload", preload,
      join(import.meta.dir, "../scripts/render-house-highlights-media-worker.ts"), "--once"], {
      env: { ...process.env, POSTGAME_MEDIA_API_URL: `http://127.0.0.1:${server.port}`,
        POSTGAME_MEDIA_WORKER_TOKEN: "test", POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
        POSTGAME_MEDIA_TEMP_DIR: root },
      stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
    try {
      expect(await child.exited).toBe(0);
    } finally {
      clearTimeout(timeout);
      child.kill();
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("acknowledges an idle drain and exits without another claim", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
      POSTGAME_MEDIA_POLL_INTERVAL_MS: "10",
      POSTGAME_MEDIA_MIN_FREE_BYTES: "1",
    });
    const acknowledgements: HouseHighlightsMediaWorkerDrainAcknowledgement[] = [];
    const workerInstanceId = "11111111-1111-4111-8111-111111111111";
    const drainController = new HouseHighlightsMediaWorkerDrainController((acknowledgement) => {
      acknowledgements.push(acknowledgement);
    }, workerInstanceId);
    let claims = 0;

    await runHouseHighlightsMediaWorker(config, (async () => {
      claims += 1;
      return Response.json({ claim: null });
    }) as unknown as typeof fetch, {
      maxIterations: 3,
      drainController,
      sleepImpl: async () => { drainController.requestDrain("SIGTERM"); },
    });

    expect(claims).toBe(1);
    expect(acknowledgements).toEqual([{ schemaVersion: 2, workerInstanceId, claimDisabled: true, claimInFlight: false, signal: "SIGTERM", acknowledgedAt: expect.any(String) }]);
    expect(drainController.pendingPollWaiterCount).toBe(0);
  });

  it("acknowledges an active claim and lets it finish before exiting", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
    });
    const acknowledgements: HouseHighlightsMediaWorkerDrainAcknowledgement[] = [];
    const workerInstanceId = "22222222-2222-4222-8222-222222222222";
    const drainController = new HouseHighlightsMediaWorkerDrainController((acknowledgement) => {
      acknowledgements.push(acknowledgement);
    }, workerInstanceId);
    let finishClaim!: () => void;
    let calls = 0;
    const claimFinished = new Promise<void>((resolve) => { finishClaim = resolve; });
    const worker = runHouseHighlightsMediaWorker(config, fetch, {
      maxIterations: 2,
      drainController,
      runOnceImpl: async () => {
        calls += 1;
        await claimFinished;
        return "completed";
      },
    });
    await Promise.resolve();

    drainController.requestDrain("SIGTERM", new Date("2026-08-15T00:00:00.000Z"));
    expect(acknowledgements).toEqual([{ schemaVersion: 2, workerInstanceId, claimDisabled: true, claimInFlight: true, signal: "SIGTERM", acknowledgedAt: "2026-08-15T00:00:00.000Z" }]);
    expect(calls).toBe(1);
    finishClaim();
    await worker;
    expect(calls).toBe(1);
  });

  it("writes an atomic non-secret drain acknowledgement for the host", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-drain-"));
    const file = join(root, "control", "drain-ack.json");
    await writeHouseHighlightsMediaWorkerDrainAcknowledgement(file, {
      schemaVersion: 2,
      workerInstanceId: "33333333-3333-4333-8333-333333333333",
      claimDisabled: true,
      claimInFlight: true,
      signal: "SIGTERM",
      acknowledgedAt: "2026-08-15T00:00:00.000Z",
    });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      schemaVersion: 2,
      workerInstanceId: "33333333-3333-4333-8333-333333333333",
      claimDisabled: true,
      claimInFlight: true,
      signal: "SIGTERM",
      acknowledgedAt: "2026-08-15T00:00:00.000Z",
    });
  });

  it("publishes a fresh worker instance before claims and removes stale acknowledgement state", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-instance-"));
    const acknowledgementFile = join(root, "control", "drain-ack.json");
    const workerInstanceId = "44444444-4444-4444-8444-444444444444";
    await mkdir(join(root, "control"), { recursive: true });
    await writeFile(acknowledgementFile, "stale\n");

    const identityFile = await initializeHouseHighlightsMediaWorkerControl(
      acknowledgementFile,
      workerInstanceId,
      new Date("2026-08-15T01:02:03.000Z"),
    );

    expect(await Bun.file(acknowledgementFile).exists()).toBeFalse();
    expect(JSON.parse(await readFile(identityFile, "utf8"))).toEqual({
      schemaVersion: 1,
      workerInstanceId,
      startedAt: "2026-08-15T01:02:03.000Z",
    });
  });

  it("removes every completed poll waiter", async () => {
    const drainController = new HouseHighlightsMediaWorkerDrainController();

    for (let cycle = 0; cycle < 20; cycle += 1) {
      await drainController.waitForPollDelay(1, async () => undefined);
      expect(drainController.pendingPollWaiterCount).toBe(0);
    }
  });

  it("heartbeats well before the minimum API lease expires", () => {
    const now = Date.parse("2026-07-09T00:00:00.000Z");
    expect(heartbeatIntervalForLease("2026-07-09T00:01:00.000Z", now)).toBe(20_000);
    expect(heartbeatIntervalForLease("2026-07-09T00:10:00.000Z", now)).toBe(60_000);
  });

  it("rewrites persisted loopback avatar URLs for a container API host", () => {
    const manifest = manifestFixture();
    manifest.cast[0]!.avatarUrl = "http://127.0.0.1:3000/api/uploads/local?key=alice.png";
    manifest.finalVote.winner = {
      ...manifest.finalVote.winner,
      avatarUrl: "http://localhost:3000/api/uploads/local?key=alice.png",
    };
    manifest.cast[1]!.avatarUrl = "/api/uploads/local?key=pfp%2Fbob.png";

    const rewritten = withWorkerReachableAssetUrls(manifest, "http://host.docker.internal:3002");

    expect(rewritten.cast[0]!.avatarUrl).toBe("http://host.docker.internal:3002/api/uploads/local?key=alice.png");
    if (rewritten.kind !== "influence") throw new Error("Expected Influence fixture");
    expect(rewritten.finalVote.winner.avatarUrl).toBe("http://host.docker.internal:3002/api/uploads/local?key=alice.png");
    expect(rewritten.cast[1]!.avatarUrl).toBe("http://host.docker.internal:3002/api/uploads/local?key=pfp%2Fbob.png");
    expect(manifest.cast[0]!.avatarUrl).toStartWith("http://127.0.0.1:3000/");
    const native = withWorkerReachableAssetUrls(manifest, "http://127.0.0.1:3002");
    expect(native.cast[0]!.avatarUrl).toBe(manifest.cast[0]!.avatarUrl);
    expect(native.cast[1]!.avatarUrl).toBe("http://127.0.0.1:3002/api/uploads/local?key=pfp%2Fbob.png");
  });

  it("rewrites Influence and Werewolf internal assets to the exact HTTPS origin without changing public assets", async () => {
    const origin = "https://influence-staging.tail8a79ed.ts.net";
    const influence = manifestFixture();
    influence.cast[0]!.avatarUrl = "http://localhost:3000/api/uploads/local?key=alice.png";
    influence.scenelets.push({ id: "scene", title: "Scene", visualType: "council", backgroundImage: "http://localhost:3000/api/uploads/local?key=background.png", backdropCategory: "council", primaryAgents: [{ ...influence.cast[0]!, avatarUrl: "http://127.0.0.1:3002/api/uploads/local?key=scene.png" }], secondaryAgents: [], outcome: "A vote", facts: [] });
    influence.cast[1]!.avatarUrl = "https://public.example.test/bob.png";
    const output = withWorkerReachableAssetUrls(influence, origin);
    expect(output.cast[0]!.avatarUrl).toBe(`${origin}/api/uploads/local?key=alice.png`);
    expect(output.cast[1]!.avatarUrl).toBe("https://public.example.test/bob.png");
    if (output.kind !== "influence") throw new Error("Expected Influence");
    expect(output.scenelets[0]!.backgroundImage).toBe(`${origin}/api/uploads/local?key=background.png`);
    expect(output.scenelets[0]!.primaryAgents[0]!.avatarUrl).toBe(`${origin}/api/uploads/local?key=scene.png`);
    const { buildWerewolfTrailerManifest } = await import("@influence/engine/postgame-media/werewolf-trailer-manifest");
    const { werewolfResultsFixture } = await import("@influence/engine/fixtures/werewolf-results");
    const events = await werewolfResultsFixture("village");
    const werewolf = buildWerewolfTrailerManifest({ events, slug: "werewolf", episode: { title: "Lanterns", description: "A village gathers." }, cuts: { game: { id: events[0]!.gameId, slug: "werewolf", kind: "werewolf" }, audience: "mystery", status: "failed", publication: null } });
    werewolf.cast[0]!.avatarUrl = "http://localhost:3000/api/uploads/local?key=alice.png";
    expect(withWorkerReachableAssetUrls(werewolf, origin).cast[0]!.avatarUrl).toBe(`${origin}/api/uploads/local?key=alice.png`);
  });

  it("requires every prepared score while tolerating unrelated extra music", async () => {
    const musicDir = await mkdtemp(join(tmpdir(), "house-highlights-music-matrix-"));
    for (const houseCuts of [0, 1, 2, 3, 4, 5]) {
      for (const players of [6, 8, 10, 12]) {
        await Bun.write(join(musicDir, `golden-verdict-${houseCuts}-cuts-${players}-players-1.0s.m4a`), "score");
      }
    }
    await Bun.write(join(musicDir, "producer-alt.m4a"), "extra score");

    await expect(assertPreparedHouseHighlightsTrailerMusicMatrix(musicDir)).resolves.toBeUndefined();
  });

  it("runs non-mutating health checks without sending worker credentials", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
      REMOTION_BROWSER_EXECUTABLE: "/usr/bin/chromium",
    });
    const commands: Array<{ command: string; args: readonly string[] }> = [];
    const healthRequests: Request[] = [];
    await checkHouseHighlightsMediaWorkerHealth(config, {
      fetchImpl: (async (input, init) => {
        healthRequests.push(new Request(input, init));
        return Response.json({ status: "ok" });
      }) as typeof fetch,
      runCommand: async (command, args) => { commands.push({ command, args }); },
      verifyMusic: async () => undefined,
      verifyTemporarySpace: async () => undefined,
    });
    expect(commands).toEqual([
      { command: "ffmpeg", args: ["-version"] },
      { command: "/usr/bin/chromium", args: ["--version"] },
    ]);
    expect(healthRequests[0]?.url).toBe("http://api.test/api/health");
    expect(healthRequests[0]?.headers.has("Authorization")).toBeFalse();
  });

  it("rejects an idle or failed claim as a smoke result", () => {
    expect(() => assertHouseHighlightsMediaWorkerSmokeResult("completed")).not.toThrow();
    expect(() => assertHouseHighlightsMediaWorkerSmokeResult("idle")).toThrow("Smoke requires a queued completed-game render job");
    expect(() => assertHouseHighlightsMediaWorkerSmokeResult("waiting_music")).toThrow("Smoke requires a queued completed-game render job");
  });
});

function fakeRenderer(overrides: Partial<HouseHighlightsTrailerRenderer> = {}): HouseHighlightsTrailerRenderer {
  return {
    renderVisual: async ({ outputPath }) => { await Bun.write(outputPath, "visual"); },
    renderPoster: async ({ outputPath }) => { await Bun.write(outputPath, "poster"); },
    mux: async ({ outputPath }) => { await Bun.write(outputPath, "muxed with audio"); },
    ...overrides,
  };
}

function manifestFixture(): InfluenceTrailerManifest {
  const agent = (id: string, name: string, placement: number, status: "winner" | "finalist" | "eliminated") => ({ id, name, initials: name[0]!, avatarUrl: `/avatars/${id}.png`, placement, status });
  const alice = agent("alice", "Alice", 1, "winner");
  const bob = agent("bob", "Bob", 2, "finalist");
  const cara = agent("cara", "Cara", 3, "eliminated");
  const dax = agent("dax", "Dax", 4, "eliminated");
  return {
    schemaVersion: 2, kind: "influence", mediaType: "house_highlights_trailer", timingContractVersion: "house-highlights-trailer-timing-v1",
    game: { id: "fixture", slug: "fixture", status: "completed" }, frameRate: 30, width: 1920, height: 1080,
    cast: [alice, bob, cara, dax], scenelets: [],
    finalVote: { finalists: [alice, bob], groups: [{ finalist: alice, votes: 2, jurors: [cara, dax] }, { finalist: bob, votes: 0, jurors: [] }], voteLabel: "2-0", winner: alice },
    playerResults: [{ agent: dax, placementLabel: "4th", tags: ["Eliminated in round 2"] }, { agent: cara, placementLabel: "3rd", tags: ["Juror"] }, { agent: bob, placementLabel: "2nd", tags: ["Runner-up", "Reached final"] }, { agent: alice, placementLabel: "1st", tags: ["Winner", "Won final vote 2-0"] }],
    cueSheet: {
      schemaVersion: 1, timingContractVersion: "house-highlights-trailer-timing-v1", frameRate: 30, totalFrames: 648, totalDurationSeconds: 21.6,
      segments: [cue("cast_roster", "cast_roster", "Cast roster", 0, 150), cue("final_vote", "final_vote", "Final vote", 150, 300), cue("winner", "winner", "Winner reveal", 300, 420), cue("player_result:dax", "player_result", "Dax", 420, 474), cue("player_result:cara", "player_result", "Cara", 474, 528), cue("player_result:bob", "player_result", "Bob", 528, 582), cue("player_result:alice", "player_result", "Alice", 582, 648)],
      markers: { finalVoteRevealSeconds: 5, winnerRevealSeconds: 10 },
    },
  };
}

function cue(id: string, kind: InfluenceTrailerManifest["cueSheet"]["segments"][number]["kind"], label: string, startFrame: number, endFrame: number) {
  return { id, kind, label, startFrame, endFrame, startSeconds: startFrame / 30, endSeconds: endFrame / 30, durationSeconds: (endFrame - startFrame) / 30 };
}

it("Werewolf playback metadata freezes the same episode copy submitted for publication", async () => {
  const {buildWerewolfTrailerManifest} = await import("@influence/engine/postgame-media/werewolf-trailer-manifest");
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const events = await werewolfResultsFixture("village");
  const root = await mkdtemp(join(tmpdir(), "wolf-metadata-"));
  try {
    for (const episode of [undefined, {title:"Lanterns and Lies",description:"Six strangers gather by candlelight."}]) {
      const manifest = buildWerewolfTrailerManifest({events,slug:"hazy-ruby-sand",episode,cuts:{game:{id:events[0]!.gameId,slug:"hazy-ruby-sand",kind:"werewolf"},audience:"mystery",status:"failed",publication:null}});
      const artifact = {name:"video" as const,path:"unused",contentType:"video/mp4",byteLength:1,sha256:"sha256:fixture"};
      const outputPath = join(root,"metadata.json");
      await writeHouseHighlightsTrailerPlaybackMetadata({bundle:{manifest,music:{path:"unused",filename:"unused",variantHouseCuts:0,variantPlayers:8,variantDurationSeconds:9,trailerDurationSeconds:9,behavior:"trim_and_fade"},timeline:{},durationMs:9000,dimensions:{width:1920,height:1080},posterFrame:0,captions:"",artifacts:{video:artifact,poster:{...artifact,name:"poster"},captions:{...artifact,name:"captions"},timeline:{...artifact,name:"timeline"}}},outputPath,renderVersion:"frozen-v1",urls:{videoUrl:"https://example.test/video",posterUrl:"https://example.test/poster",captionsUrl:"https://example.test/captions"}});
      const metadata = JSON.parse(await readFile(outputPath,"utf8"));
      expect(metadata.title).toBe(manifest.story.title);
      expect(metadata.description).toBe(manifest.story.description);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
