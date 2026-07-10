import { createHash } from "node:crypto";
import {
  serializeHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "./house-highlights-trailer-manifest";

export function hashHouseHighlightsTrailerManifest(
  manifest: HouseHighlightsTrailerManifest,
): string {
  return `sha256:${createHash("sha256")
    .update(serializeHouseHighlightsTrailerManifest(manifest))
    .digest("hex")}`;
}
