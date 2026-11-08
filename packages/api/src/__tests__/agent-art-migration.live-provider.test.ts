/** Explicit two-image qualification. Run with development credentials and INFLUENCE_LIVE_IMAGE_PROBE=1. */
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  generateVisualImage,
  visualImageSettings,
  type VisualImageJournal,
  type VisualImageRequest,
} from "../services/visual-image-provider.js";
import { hasCharacterTransparency } from "../services/character-transparency.js";
import { visualReceiptCostMicrousd } from "../services/visual-pricing.js";
const enabled = process.env.INFLUENCE_LIVE_IMAGE_PROBE === "1";
test.skipIf(!enabled)(
  "Flare creates native alpha and Sunburst edits it at medium quality",
  async () => {
    const directory = new URL(
      "../../../../.renders/image-provider-migration/",
      import.meta.url,
    ).pathname;
    await mkdir(directory, { recursive: true });
    let source: Uint8Array | undefined;
    for (const operation of ["create", "edit"] as const) {
      const request: VisualImageRequest = {
        operation,
        background: "transparent",
        width: 1024,
        height: 1536,
        references: source ? [source] : [],
        prompt:
          operation === "create"
            ? "One photorealistic adult stage magician, wearing a fitted forest-green jacket and brass rings, full body including both shoes, neutral standing pose facing camera. Fine natural hair detail. Exactly one person. Transparent background with real alpha; no scenery, no floor, no glow, no text, no inset."
            : "Preserve the exact adult magician, pose, face, hair, jacket, rings and framing of the reference. Change only the jacket from forest green to deep burgundy. Preserve transparent background with real alpha. Full body including shoes. No scenery, floor, glow or text.",
      };
      const prefix = directory + operation;
      const journal: VisualImageJournal = {
        async begin(input) {
          await writeFile(
            prefix + "-request.json",
            JSON.stringify(
              {
                request: {
                  ...request,
                  references: request.references.map((bytes) =>
                    createHash("sha256").update(bytes).digest("hex"),
                  ),
                },
                settings: visualImageSettings(request),
                dispatch: input,
              },
              null,
              2,
            ),
          );
        },
        async finish(receipt, image) {
          if (image) await writeFile(prefix + ".png", image);
          await writeFile(
            prefix + "-receipt.json",
            JSON.stringify(
              { ...receipt, costMicrousd: visualReceiptCostMicrousd(receipt) },
              null,
              2,
            ),
          );
        },
      };
      const result = await generateVisualImage(
        request,
        journal,
        undefined,
        false,
      );
      expect(result.receipt.model).toBe(
        operation === "create"
          ? "gpt-image-2.6-flare"
          : "gpt-image-2.6-sunburst",
      );
      expect(await hasCharacterTransparency(result.image)).toBe(true);
      source = result.image;
    }
  },
  600_000,
);
