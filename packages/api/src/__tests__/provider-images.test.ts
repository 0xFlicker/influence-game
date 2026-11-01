import { beforeEach, expect, test } from "bun:test";
import { providerImageStorage, PROVIDER_IMAGE_URL_TTL_SECONDS } from "../services/provider-images.js";
import { setupTestDB } from "./test-utils.js";
import { providerImageUri } from "@influence/engine/provider-images";

beforeEach(async () => { await setupTestDB(); });

test("binary evidence round-trips and signs exact objects with a deadline-safe lifetime", async () => {
  const names = ["LINODE_PRIVATE_CONTENT_BUCKET", "LINODE_PRIVATE_CONTENT_ENDPOINT", "LINODE_PRIVATE_CONTENT_ACCESS_KEY", "LINODE_PRIVATE_CONTENT_SECRET_KEY"];
  const previous = names.map(name => process.env[name]);
  try {
    Object.assign(process.env, { LINODE_PRIVATE_CONTENT_BUCKET: "private-images", LINODE_PRIVATE_CONTENT_ENDPOINT: "https://storage.example.test",
      LINODE_PRIVATE_CONTENT_ACCESS_KEY: "test-key", LINODE_PRIVATE_CONTENT_SECRET_KEY: "test-secret" });
    const bytes = Buffer.from("unchanged image payload");
    const ref = await providerImageStorage.store(bytes, "image/png");
    expect(await providerImageStorage.store(bytes, "image/png")).toEqual(ref);
    expect(providerImageUri(ref)).not.toContain(bytes.toString("base64"));
    const signed = new URL(await providerImageStorage.sign(ref));
    expect(signed.pathname).toBe(`/private-images/payloads/v1/binary/${ref.sha256}`);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe(String(PROVIDER_IMAGE_URL_TTL_SECONDS));
    expect(signed.searchParams.get("response-content-type")).toBe("image/png");
    expect(PROVIDER_IMAGE_URL_TTL_SECONDS).toBeGreaterThan(300);
    await expect(providerImageStorage.sign({ ...ref, byteLength: bytes.length + 1 })).rejects.toThrow("integrity mismatch");
    await expect(providerImageStorage.sign({ ...ref, sha256: "a".repeat(64) })).rejects.toThrow();
  } finally {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
});
