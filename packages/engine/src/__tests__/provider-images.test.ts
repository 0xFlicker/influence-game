import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import OpenAI, { APIConnectionTimeoutError } from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { ProviderImageAttachments, ProviderImageStorageError, providerImageUri, type ProviderImageStorage } from "../provider-images";
import { classifyProviderError, createProviderEvidenceFetch, ProviderExecutionCoordinator, sanitizeProviderEvidence, type ProviderAttemptRecord, type ProviderLogicalCallCoordinate } from "../provider-execution";
import { providerDeadlineSignal, requestDeadlineError } from "../provider-deadline";
import { Phase } from "../types";

const bytes = Buffer.from("exact image bytes");
const base64 = bytes.toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;
const reference = { sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, mediaType: "image/png" };
const uri = providerImageUri(reference);
const coordinate: ProviderLogicalCallCoordinate = { gameId: "image-game", actor: { id: "actor", name: "Actor", role: "player" }, action: "lobby", phase: Phase.LOBBY,
  semantic: { version: 1, kind: "phase_call", phase: Phase.LOBBY, round: 1, canonicalEventSequence: 1, callSlot: 1 } };
const request = { model: "test", input: [{ role: "user" as const, content: [{ type: "input_image" as const, image_url: dataUrl, detail: "high" as const }] }] } satisfies ResponseCreateParamsNonStreaming;

function storage() {
  let stores = 0;
  let signs = 0;
  const adapter: ProviderImageStorage = {
    async store(value, mediaType) { expect(Buffer.from(value)).toEqual(bytes); expect(mediaType).toBe("image/png"); stores++; return reference; },
    async sign(ref) { expect(ref).toEqual(reference); return `https://private.example/image?X-Amz-Signature=secret-${++signs}`; },
  };
  return { adapter, counts: () => ({ stores, signs }) };
}

describe("provider image attachments", () => {
  test("deduplicates bytes and resolves only typed image fields, refreshing URLs each attempt", async () => {
    const s = storage();
    const first = new ProviderImageAttachments(s.adapter);
    const evidence = await first.evidence({ prepared: request, raw: request, opaqueReasoning: base64 });
    expect(JSON.stringify(evidence)).not.toContain(dataUrl);
    expect(evidence.opaqueReasoning).toBe(base64);
    expect(s.counts().stores).toBe(1);
    const wire = await first.request({ ...request, text: uri });
    expect(JSON.stringify(wire)).toContain("secret-1");
    expect(JSON.stringify(wire)).toContain(`"text":"${uri}"`);
    expect(JSON.stringify(await first.evidence(wire))).not.toContain("secret-1");
    const second = new ProviderImageAttachments(s.adapter);
    expect(JSON.stringify(await second.request(await first.evidence(request)))).toContain("secret-2");
    expect(await first.evidence(request)).toEqual(await second.evidence(request));
  });

  test("handles Anthropic base64 and URL sources without changing native reasoning", async () => {
    const attachments = new ProviderImageAttachments(storage().adapter);
    const body = { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } };
    const evidence = await attachments.evidence(body);
    expect(evidence.source.data).toBe(uri);
    expect(await attachments.request(evidence)).toEqual({ type: "image", source: { type: "url", url: expect.stringContaining("https://") } });
  });

  test("SDK transport sends signed URL; reservation and success evidence contain only durable image references", async () => {
    const s = storage();
    const records: ProviderAttemptRecord[] = [];
    let reservation = "";
    const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: createProviderEvidenceFetch(async input => {
      const body = await (input as Request).json();
      expect(JSON.stringify(body)).not.toContain(base64);
      expect(JSON.stringify(body)).toContain("secret-1");
      return Response.json({ id: "response", output: [] });
    }, [], 300_000) });
    const call = new ProviderExecutionCoordinator({ hooks: { images: s.adapter,
      onReserve: intent => { reservation = JSON.stringify(intent); }, onTerminal: record => { records.push(record); } } }).startCall(coordinate);
    await call.execute({ preparedRequest: { transport: "xai.responses", providerProfileId: "xai", model: "test", body: request }, maxAttempts: 1,
      dispatch: ({ requestOptions }) => client.responses.create(request, requestOptions), validate: () => ({ status: "usable", value: "accepted" }) });
    expect(reservation).toContain(uri);
    expect(reservation).not.toContain(base64);
    expect(JSON.stringify(records)).toContain(uri);
    expect(JSON.stringify(records)).not.toContain(base64);
    expect(JSON.stringify(records)).not.toContain("secret-1");
    expect(records[0]?.transportTiming?.timeoutMs).toBe(300_000);
  });

  test("signing failure survives SDK wrapping and never dispatches or retries", async () => {
    const s = storage(); let dispatched = 0; let signed = 0;
    s.adapter.sign = async () => { signed++; throw new Error("private storage unavailable"); };
    const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: createProviderEvidenceFetch(async () => { dispatched++; return Response.json({}); }) });
    const call = new ProviderExecutionCoordinator({ hooks: { images: s.adapter } }).startCall(coordinate);
    await expect(call.execute({ preparedRequest: { transport: "xai.responses", providerProfileId: "xai", model: "test", body: request }, maxAttempts: 3,
      dispatch: ({ requestOptions }) => client.responses.create(request, requestOptions), validate: () => ({ status: "usable", value: "accepted" }) })).rejects.toBeInstanceOf(ProviderImageStorageError);
    expect(dispatched).toBe(0); expect(signed).toBe(1);
  });

  test("image persistence failure prevents reservation", async () => {
    const s = storage(); let reserved = false;
    s.adapter.store = async () => { throw new Error("upload failed"); };
    const call = new ProviderExecutionCoordinator({ hooks: { images: s.adapter, onReserve: () => { reserved = true; } } }).startCall(coordinate);
    await expect(call.execute({ preparedRequest: { transport: "xai.responses", providerProfileId: "xai", model: "test", body: request }, maxAttempts: 1,
      dispatch: async () => "unexpected", validate: () => ({ status: "usable", value: "accepted" }) })).rejects.toBeInstanceOf(ProviderImageStorageError);
    expect(reserved).toBe(false);
  });
});

describe("timeout attribution", () => {
  test("the real SDK deadline records its effective limit and keeps the remote outcome unknown", async () => {
    const records: ProviderAttemptRecord[] = [];
    const timeoutMs = 10;
    const client = new OpenAI({ apiKey: "test", timeout: timeoutMs, maxRetries: 0, fetch: createProviderEvidenceFetch(async input => {
      const signal = (input as Request).signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    }, [], timeoutMs) });
    const call = new ProviderExecutionCoordinator({ hooks: { onTerminal: record => { records.push(record); } } }).startCall(coordinate);
    await expect(call.execute({ preparedRequest: { transport: "xai.responses", providerProfileId: "xai", model: "test", body: request }, maxAttempts: 1,
      dispatch: ({ requestOptions }) => client.responses.create(request, requestOptions), validate: () => ({ status: "usable", value: "accepted" }) })).rejects.toThrow();
    expect(records[0]?.outcome).toMatchObject({ timeoutSource: "client_deadline", timeoutMs, message: "Our 0.01-second deadline expired; provider completion unknown" });
    expect(records[0]?.transportTiming?.timeoutMs).toBe(timeoutMs);
    expect(records[0]?.rawResponse?.status).toBeUndefined();
  });

  test("response body failures retain received headers and transport timing", async () => {
    const records: ProviderAttemptRecord[] = [];
    const client = new OpenAI({ apiKey: "test", maxRetries: 0, fetch: createProviderEvidenceFetch(async () =>
      new Response(new ReadableStream({ start(controller) { controller.error(new Error("body disconnected")); } }),
        { status: 200, headers: { "x-request-id": "received-headers" } }), [], 300_000) });
    const call = new ProviderExecutionCoordinator({ hooks: { onTerminal: record => { records.push(record); } } }).startCall(coordinate);
    await expect(call.execute({ preparedRequest: { transport: "xai.responses", providerProfileId: "xai", model: "test", body: request }, maxAttempts: 1,
      dispatch: ({ requestOptions }) => client.responses.create(request, requestOptions), validate: () => ({ status: "usable", value: "accepted" }) })).rejects.toThrow();
    expect(records[0]?.rawResponse).toMatchObject({ status: 200, headers: { "x-request-id": "received-headers" }, body: null });
    expect(records[0]?.transportTiming).toMatchObject({ responseHeadersAt: expect.any(String), completedAt: expect.any(String), timeoutMs: 300_000 });
  });

  test("SDK deadline, remote timeout, network timeout, unknown and cancellation stay distinct", async () => {
    expect(classifyProviderError(new APIConnectionTimeoutError())).toMatchObject({ timeoutSource: "client_deadline" });
    for (const status of [408, 504]) expect(classifyProviderError({ status, message: "timeout" })).toMatchObject({ timeoutSource: "provider", httpStatus: status });
    expect(classifyProviderError(new TypeError("fetch failed", { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }))).toMatchObject({ timeoutSource: "transport" });
    expect(classifyProviderError(new Error("Request timed out"))).toMatchObject({ timeoutSource: "unknown" });
    const signal = providerDeadlineSignal(1);
    await Bun.sleep(5);
    expect(classifyProviderError(requestDeadlineError(signal, new Error()))).toMatchObject({ timeoutSource: "client_deadline", timeoutMs: 1 });
    expect(classifyProviderError(new APIConnectionTimeoutError(), AbortSignal.abort())).toMatchObject({ kind: "cancellation" });
  });

  test("S3 URL signatures and credentials never survive sanitization", () => {
    const sanitized = JSON.stringify(sanitizeProviderEvidence({ url: "https://bucket/image?X-Amz-Signature=signature-secret&X-Amz-Credential=credential-secret&X-Amz-Security-Token=token-secret" }));
    for (const secret of ["signature-secret", "credential-secret", "token-secret"]) expect(sanitized).not.toContain(secret);
  });
});
