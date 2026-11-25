import { providerImageUri, type ProviderImageReference, type ProviderImageStorage } from "@influence/engine/provider-images";
import { readImageDelivery, readPayload, storeImage, type StoredPayload } from "./payload-storage.js";

/** Longer than the maximum 300-second generation deadline; refreshed for each attempt. */
export const PROVIDER_IMAGE_URL_TTL_SECONDS = 15 * 60;

function binaryReference(ref: ProviderImageReference): StoredPayload {
  providerImageUri(ref);
  return { storage: "private-payload-v1", codec: "binary", key: `payloads/v1/binary/${ref.sha256}`,
    sha256: ref.sha256, byteLength: ref.byteLength, storedSha256: ref.sha256, storedByteLength: ref.byteLength };
}

export const providerImageStorage: ProviderImageStorage = {
  async store(bytes, mediaType) {
    const stored = await storeImage(bytes, mediaType);
    await readPayload(stored);
    return { sha256: stored.sha256, byteLength: stored.byteLength, mediaType };
  },
  async sign(ref) {
    const { contentType, url } = await readImageDelivery(binaryReference(ref), PROVIDER_IMAGE_URL_TTL_SECONDS);
    if (contentType !== ref.mediaType || !url) throw new Error("Provider image metadata disagrees with its reference");
    return url;
  },
};
