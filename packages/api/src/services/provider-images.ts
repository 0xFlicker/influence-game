import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { providerImageUri, type ProviderImageReference, type ProviderImageStorage } from "@influence/engine/provider-images";
import { readPayload, storeBinary, type StoredPayload } from "./payload-storage.js";
import { getPrivateTraceBucket, getPrivateTraceS3Client } from "./private-trace-storage.js";

/** Longer than the maximum 300-second generation deadline; refreshed for each attempt. */
export const PROVIDER_IMAGE_URL_TTL_SECONDS = 15 * 60;

function binaryReference(ref: ProviderImageReference): StoredPayload {
  providerImageUri(ref);
  return { storage: "private-payload-v1", codec: "binary", key: `payloads/v1/binary/${ref.sha256}`,
    sha256: ref.sha256, byteLength: ref.byteLength, storedSha256: ref.sha256, storedByteLength: ref.byteLength };
}

export const providerImageStorage: ProviderImageStorage = {
  async store(bytes, mediaType) {
    const stored = await storeBinary(bytes);
    await readPayload(stored);
    return { sha256: stored.sha256, byteLength: stored.byteLength, mediaType };
  },
  async sign(ref) {
    const stored = binaryReference(ref);
    // Do not sign missing/corrupt objects or replace the exact historical image.
    await readPayload(stored);
    return getSignedUrl(getPrivateTraceS3Client(), new GetObjectCommand({
      Bucket: getPrivateTraceBucket(), Key: stored.key, ResponseContentType: ref.mediaType,
    }), { expiresIn: PROVIDER_IMAGE_URL_TTL_SECONDS });
  },
};
