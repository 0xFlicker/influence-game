import sharp from "sharp";
import { beforeEach, expect, test } from "bun:test";
import { providerImageStorage, PROVIDER_IMAGE_URL_TTL_SECONDS } from "../services/provider-images.js";
import { setPayloadObjectStoreForTests } from "../services/payload-storage.js";
import { setupTestDB } from "./test-utils.js";
import { testPayloadStore } from "./payload-test-store.js";
import { providerImageUri } from "@influence/engine/provider-images";

beforeEach(async () => { await setupTestDB(); });

test("provider image delivery validates saved metadata and signs without downloading bytes", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  const ref = await providerImageStorage.store(bytes, "image/png");
  expect(await providerImageStorage.store(bytes, "image/png")).toEqual(ref);
  expect(providerImageUri(ref)).not.toContain(bytes.toString("base64"));

  const base = "https://storage.example.test/private-images/";
  let selectedMime: "image/png" | "image/webp" = "image/png";
  setPayloadObjectStoreForTests({
    putIfAbsent: (key, body, type) => testPayloadStore.putIfAbsent(key, body, type),
    async get() { throw new Error("Provider signer attempted a download"); },
    async imageDelivery(payload, expiresIn) {
      if (payload.byteLength !== bytes.length) throw new Error("Frozen image metadata is missing or invalid");
      expect(payload.key).toBe(`payloads/v1/binary/${ref.sha256}`);
      expect(expiresIn).toBe(PROVIDER_IMAGE_URL_TTL_SECONDS);
      return { contentType: selectedMime, url: new URL(payload.key, base).href };
    },
  });
  try {
    expect(await providerImageStorage.sign(ref)).toBe(`${base}payloads/v1/binary/${ref.sha256}`);
    expect(PROVIDER_IMAGE_URL_TTL_SECONDS).toBeGreaterThan(300);
    await expect(providerImageStorage.sign({ ...ref, byteLength: bytes.length + 1 })).rejects.toThrow("metadata is missing or invalid");
    await expect(providerImageStorage.sign({ ...ref, sha256: "broken" })).rejects.toThrow("Invalid provider image reference");
    selectedMime = "image/webp";
    await expect(providerImageStorage.sign(ref)).rejects.toThrow("metadata disagrees");
  } finally { setPayloadObjectStoreForTests(testPayloadStore); }
});
